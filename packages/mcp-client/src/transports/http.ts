import { HubError, type HttpTransportConfig } from '@mcp-hub/core';
import { assertUrlAllowed, type SsrfPolicy } from '@mcp-hub/security';
import {
  type JsonRpcMessage,
  isJsonRpcResponse,
  SUPPORTED_PROTOCOL_VERSION,
} from '../protocol.js';
import { type McpTransport, type TransportEvents, TransportClosedError } from '../transport.js';

export interface HttpTransportOptions {
  config: HttpTransportConfig;
  /** Resolved values for the header names declared on the version. */
  headers: Record<string, string>;
  ssrf: SsrfPolicy;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

/**
 * MCP over Streamable HTTP.
 *
 * Each outbound JSON-RPC message is a POST. The server answers with either a
 * single JSON body or an SSE stream; both are handled, and the SSE stream is
 * parsed incrementally so a response is surfaced as soon as it arrives rather
 * than after the stream closes.
 *
 * Security posture:
 *  - the URL is re-validated against the SSRF policy on every request;
 *  - redirects are refused outright rather than followed, because a redirect
 *    is the classic way to pivot a validated URL onto an internal address;
 *  - the response body is byte-capped and the whole exchange is time-bounded.
 */
export class StreamableHttpTransport implements McpTransport {
  readonly kind = 'streamable-http' as const;
  private events: TransportEvents | null = null;
  private sessionId: string | null = null;
  private negotiatedProtocol: string | null = null;
  private closed = false;
  private readonly inflight = new Set<AbortController>();

  constructor(private readonly options: HttpTransportOptions) {}

  async start(events: TransportEvents): Promise<void> {
    this.events = events;
    await assertUrlAllowed(this.options.config.url, this.options.ssrf);
  }

  /** Records the protocol version so later requests can advertise it. */
  setNegotiatedProtocol(version: string): void {
    this.negotiatedProtocol = version;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new TransportClosedError();
    await assertUrlAllowed(this.options.config.url, this.options.ssrf);

    const controller = new AbortController();
    this.inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);

    try {
      const response = await globalThis.fetch(this.options.config.url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': this.negotiatedProtocol ?? SUPPORTED_PROTOCOL_VERSION,
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
          ...this.options.headers,
        },
        body: JSON.stringify(message),
      });

      const returnedSession = response.headers.get('mcp-session-id');
      if (returnedSession) this.sessionId = returnedSession;

      if (response.status === 202 || response.status === 204) {
        // Accepted notification; no body is expected.
        return;
      }

      if (!response.ok) {
        const detail = await this.readCapped(response);
        throw new HubError(
          'UPSTREAM_ERROR',
          `MCP server responded ${response.status}.`,
          { details: { status: response.status, body: detail.slice(0, 500) } },
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        await this.consumeEventStream(response);
        return;
      }

      const body = await this.readCapped(response);
      if (body.trim().length === 0) return;
      this.dispatchJson(body);
    } catch (err) {
      if (err instanceof HubError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new HubError(
          'UPSTREAM_TIMEOUT',
          `MCP server did not respond within ${this.options.requestTimeoutMs}ms.`,
        );
      }
      throw new HubError('UPSTREAM_ERROR', 'The MCP request failed.', { cause: err });
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }

  private dispatchJson(body: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new HubError('UPSTREAM_ERROR', 'MCP server returned a body that is not valid JSON.', {
        details: { excerpt: body.slice(0, 200) },
      });
    }
    // A server may batch responses into an array.
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      this.events?.onMessage(item as JsonRpcMessage);
    }
  }

  /** Parses `data:` frames out of an SSE body, emitting each JSON-RPC message. */
  private async consumeEventStream(response: Response): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    let sawResponse = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > this.options.maxResponseBytes) {
          throw new HubError(
            'PAYLOAD_TOO_LARGE',
            `MCP server streamed more than ${this.options.maxResponseBytes} bytes.`,
          );
        }
        buffer += decoder.decode(value, { stream: true });

        let separator = buffer.indexOf('\n\n');
        while (separator !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const payload = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (payload) {
            try {
              const parsed: unknown = JSON.parse(payload);
              if (isJsonRpcResponse(parsed)) sawResponse = true;
              this.events?.onMessage(parsed as JsonRpcMessage);
            } catch {
              this.events?.onError(
                new HubError('UPSTREAM_ERROR', 'MCP server sent an SSE frame that is not JSON.'),
              );
            }
          }
          separator = buffer.indexOf('\n\n');
        }

        // The stream may stay open for server-initiated traffic; once the
        // response to our request has arrived there is nothing more to wait for.
        if (sawResponse) break;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private async readCapped(response: Response): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > this.options.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HubError(
          'PAYLOAD_TOO_LARGE',
          `MCP server returned more than ${this.options.maxResponseBytes} bytes.`,
        );
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.inflight) controller.abort();
    this.inflight.clear();

    // Politely release the session if the server issued one.
    if (this.sessionId) {
      try {
        await globalThis.fetch(this.options.config.url, {
          method: 'DELETE',
          redirect: 'error',
          headers: { 'mcp-session-id': this.sessionId, ...this.options.headers },
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        // Session teardown is best-effort; servers may not implement DELETE.
      }
    }
    this.events?.onClose({ reason: 'client closed' });
  }

  describe(): Record<string, unknown> {
    const url = new URL(this.options.config.url);
    return {
      kind: 'streamable-http',
      origin: url.origin,
      path: url.pathname,
      headerKeys: this.options.config.headerKeys,
      sessionId: this.sessionId ? 'present' : null,
    };
  }
}
