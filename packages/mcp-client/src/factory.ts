import { type TransportConfig, HubError } from '@mcp-hub/core';
import { getConfig } from '@mcp-hub/config';
import { assertTransportAllowed, type SsrfPolicy } from '@mcp-hub/security';
import { McpClient } from './client.js';
import type { McpTransport } from './transport.js';
import { StdioTransport } from './transports/stdio.js';
import { StreamableHttpTransport } from './transports/http.js';

export interface ConnectOptions {
  transport: TransportConfig;
  /** Decrypted credential values, keyed by env-var or header name. */
  secrets?: Record<string, string>;
  requestTimeoutMs?: number;
  maxPayloadBytes?: number;
  /** Overrides the process SSRF policy; used by tests. */
  ssrfPolicy?: SsrfPolicy;
  allowStdio?: boolean;
  clientInfo?: { name: string; version: string };
}

export function buildTransport(options: ConnectOptions): McpTransport {
  const config = getConfig();
  const timeout = options.requestTimeoutMs ?? config.security.outboundTimeoutMs;
  const maxBytes = options.maxPayloadBytes ?? config.security.maxToolPayloadBytes;
  const ssrf: SsrfPolicy = options.ssrfPolicy ?? {
    allowPrivateNetwork: config.security.allowPrivateNetwork,
  };

  if (options.transport.kind === 'stdio') {
    const env: Record<string, string> = {};
    for (const key of options.transport.envKeys) {
      const value = options.secrets?.[key] ?? process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return new StdioTransport({
      config: options.transport,
      env,
      maxBufferBytes: maxBytes,
    });
  }

  const headers: Record<string, string> = {};
  for (const key of options.transport.headerKeys) {
    const value = options.secrets?.[key];
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }
  return new StreamableHttpTransport({
    config: options.transport,
    headers,
    ssrf,
    requestTimeoutMs: timeout,
    maxResponseBytes: maxBytes,
  });
}

/**
 * Validates the transport against policy, opens a session and completes the
 * handshake. Every code path that talks to an MCP server goes through here, so
 * there is exactly one place where transport policy can be enforced.
 */
export async function connectToServer(options: ConnectOptions): Promise<McpClient> {
  const config = getConfig();
  await assertTransportAllowed(options.transport, {
    allowStdio: options.allowStdio ?? config.security.allowStdioTransport,
    stdioAllowedCommands: config.security.stdioAllowedCommands,
    ssrf: options.ssrfPolicy ?? { allowPrivateNetwork: config.security.allowPrivateNetwork },
  });

  const client = new McpClient({
    transport: buildTransport(options),
    requestTimeoutMs: options.requestTimeoutMs ?? config.security.outboundTimeoutMs,
    ...(options.clientInfo ? { clientInfo: options.clientInfo } : {}),
  });

  try {
    await client.connect();
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err instanceof HubError
      ? err
      : new HubError('UPSTREAM_ERROR', 'Failed to connect to the MCP server.', { cause: err });
  }
  return client;
}

/** Runs `fn` against a session and always tears the session down. */
export async function withMcpSession<T>(
  options: ConnectOptions,
  fn: (client: McpClient) => Promise<T>,
): Promise<T> {
  const client = await connectToServer(options);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
