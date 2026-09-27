import { HubError, withTimeout } from '@mcp-hub/core';
import { contextLogger } from '@mcp-hub/observability';
import {
  type CallToolResult,
  type InitializeResult,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpPromptDefinition,
  type McpResourceDefinition,
  type McpResourceTemplateDefinition,
  type McpToolDefinition,
  COMPATIBLE_PROTOCOL_VERSIONS,
  JSONRPC_VERSION,
  SUPPORTED_PROTOCOL_VERSION,
  isJsonRpcResponse,
} from './protocol.js';
import type { McpTransport } from './transport.js';
import { StreamableHttpTransport } from './transports/http.js';

export interface McpClientOptions {
  transport: McpTransport;
  /** Per-request timeout. Every call is bounded; none can hang a worker. */
  requestTimeoutMs: number;
  clientInfo?: { name: string; version: string };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export interface ConnectionInfo {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string; title?: string };
  instructions?: string | undefined;
  /** Milliseconds for the initialize round trip. */
  handshakeMs: number;
}

/**
 * A single MCP session.
 *
 * Responsibilities kept deliberately narrow: framing correlation, timeouts and
 * turning protocol errors into `HubError`s. It does no persistence, no risk
 * classification and no policy evaluation — those belong to callers, which is
 * what lets the same client serve discovery, health checks, compatibility
 * tests and the playground without any of them special-casing the others.
 */
export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private started = false;
  private closed = false;
  private connection: ConnectionInfo | null = null;
  private lastError: Error | null = null;

  constructor(private readonly options: McpClientOptions) {}

  get info(): ConnectionInfo | null {
    return this.connection;
  }

  /** Performs the MCP initialize handshake. Must be called before anything else. */
  async connect(): Promise<ConnectionInfo> {
    if (this.started) {
      if (!this.connection) throw HubError.internal('Client started without a connection.');
      return this.connection;
    }
    this.started = true;

    await this.options.transport.start({
      onMessage: (message) => this.handleMessage(message),
      onError: (error) => this.handleTransportError(error),
      onClose: (info) => this.handleClose(info),
    });

    const startedAt = performance.now();
    const result = (await this.request('initialize', {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false }, sampling: {} },
      clientInfo: this.options.clientInfo ?? { name: 'mcp-hub', version: '0.1.0' },
    })) as InitializeResult;

    if (!result || typeof result.protocolVersion !== 'string') {
      throw new HubError('UPSTREAM_ERROR', 'MCP server returned a malformed initialize result.');
    }
    if (!COMPATIBLE_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
      // Not fatal: the connection continues and the compatibility suite
      // reports it, so operators see the mismatch instead of a silent failure.
      contextLogger().warn('MCP server negotiated an unrecognised protocol version', {
        protocolVersion: result.protocolVersion,
      });
    }
    if (this.options.transport instanceof StreamableHttpTransport) {
      this.options.transport.setNegotiatedProtocol(result.protocolVersion);
    }

    await this.notify('notifications/initialized', {});

    this.connection = {
      protocolVersion: result.protocolVersion,
      capabilities: result.capabilities ?? {},
      serverInfo: result.serverInfo ?? { name: 'unknown', version: '0.0.0' },
      instructions: result.instructions,
      handshakeMs: Math.round(performance.now() - startedAt),
    };
    return this.connection;
  }

  private supports(capability: string): boolean {
    return Boolean(this.connection?.capabilities?.[capability]);
  }

  /** Lists tools, following `nextCursor` pagination to completion. */
  async listTools(maxPages = 20): Promise<McpToolDefinition[]> {
    if (!this.supports('tools')) return [];
    return this.paginate<McpToolDefinition>('tools/list', 'tools', maxPages);
  }

  async listResources(maxPages = 20): Promise<McpResourceDefinition[]> {
    if (!this.supports('resources')) return [];
    return this.paginate<McpResourceDefinition>('resources/list', 'resources', maxPages);
  }

  async listResourceTemplates(maxPages = 5): Promise<McpResourceTemplateDefinition[]> {
    if (!this.supports('resources')) return [];
    try {
      return await this.paginate<McpResourceTemplateDefinition>(
        'resources/templates/list',
        'resourceTemplates',
        maxPages,
      );
    } catch (err) {
      // Templates are optional even when `resources` is advertised.
      if (err instanceof HubError && err.details?.['rpcCode'] === -32601) return [];
      throw err;
    }
  }

  async listPrompts(maxPages = 20): Promise<McpPromptDefinition[]> {
    if (!this.supports('prompts')) return [];
    return this.paginate<McpPromptDefinition>('prompts/list', 'prompts', maxPages);
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const result = (await this.request('tools/call', {
      name,
      arguments: args ?? {},
    })) as CallToolResult;
    return {
      content: Array.isArray(result?.content) ? result.content : [],
      structuredContent: result?.structuredContent,
      isError: Boolean(result?.isError),
    };
  }

  async readResource(uri: string): Promise<{ contents: unknown[] }> {
    const result = (await this.request('resources/read', { uri })) as { contents?: unknown[] };
    return { contents: Array.isArray(result?.contents) ? result.contents : [] };
  }

  async ping(): Promise<void> {
    await this.request('ping', {});
  }

  private async paginate<T>(method: string, key: string, maxPages: number): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = (await this.request(method, cursor ? { cursor } : {})) as Record<string, unknown>;
      const batch = result?.[key];
      if (Array.isArray(batch)) items.push(...(batch as T[]));
      const next = result?.['nextCursor'];
      if (typeof next !== 'string' || next.length === 0) return items;
      cursor = next;
    }
    contextLogger().warn('MCP pagination stopped at the page limit', { method, maxPages });
    return items;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) throw new HubError('UPSTREAM_ERROR', 'The MCP session is closed.');
    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: JSONRPC_VERSION, id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });

    try {
      await this.options.transport.send(message);
    } catch (err) {
      this.pending.delete(id);
      throw err instanceof HubError
        ? err
        : new HubError('UPSTREAM_ERROR', `Failed to send ${method}.`, { cause: err });
    }

    try {
      return await withTimeout(promise, this.options.requestTimeoutMs, `MCP ${method}`);
    } catch (err) {
      this.pending.delete(id);
      if (err instanceof HubError) throw err;
      const message_ = err instanceof Error ? err.message : String(err);
      if (message_.includes('timed out')) {
        throw new HubError(
          'UPSTREAM_TIMEOUT',
          `MCP server did not answer ${method} within ${this.options.requestTimeoutMs}ms.`,
        );
      }
      throw new HubError('UPSTREAM_ERROR', message_, { cause: err });
    }
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.options.transport.send({ jsonrpc: JSONRPC_VERSION, method, params });
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (!isJsonRpcResponse(message)) {
      // Server-initiated requests and notifications are acknowledged but not
      // acted on: MCP Hub never lets a server drive behaviour in the Hub.
      return;
    }
    const response = message as JsonRpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(
        new HubError('UPSTREAM_ERROR', `MCP server rejected ${pending.method}: ${response.error.message}`, {
          details: { rpcCode: response.error.code, method: pending.method },
        }),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private handleTransportError(error: Error): void {
    this.lastError = error;
    contextLogger().debug('MCP transport error', { error: error.message });
  }

  private handleClose(info: { code?: number | null; reason?: string }): void {
    this.closed = true;
    const reason = info.reason?.trim();
    const error = new HubError(
      'UPSTREAM_ERROR',
      `The MCP server closed the connection${info.code != null ? ` (exit ${info.code})` : ''}.`,
      { details: reason ? { stderr: reason.slice(0, 500) } : undefined },
    );
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  get transportDiagnostics(): Record<string, unknown> {
    return {
      ...this.options.transport.describe(),
      lastError: this.lastError?.message ?? null,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.options.transport.close();
  }
}
