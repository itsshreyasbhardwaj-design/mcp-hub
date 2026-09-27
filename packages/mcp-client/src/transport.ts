import type { JsonRpcMessage } from './protocol.js';

export interface TransportEvents {
  onMessage: (message: JsonRpcMessage) => void;
  onError: (error: Error) => void;
  onClose: (info: { code?: number | null; reason?: string }) => void;
}

/**
 * A duplex channel carrying JSON-RPC messages to one MCP server.
 * Implementations are responsible for their own framing and for enforcing the
 * byte and time limits they were constructed with.
 */
export interface McpTransport {
  readonly kind: 'stdio' | 'streamable-http';
  start(events: TransportEvents): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
  /** Diagnostics surfaced in compatibility test evidence. */
  describe(): Record<string, unknown>;
}

export class TransportClosedError extends Error {
  constructor(message = 'The transport closed before the request completed.') {
    super(message);
    this.name = 'TransportClosedError';
  }
}
