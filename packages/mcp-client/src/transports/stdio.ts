import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { HubError, type StdioTransportConfig } from '@mcp-hub/core';
import type { JsonRpcMessage } from '../protocol.js';
import { type McpTransport, type TransportEvents, TransportClosedError } from '../transport.js';

export interface StdioTransportOptions {
  config: StdioTransportConfig;
  /** Resolved values for the variables named in `config.envKeys`. */
  env: Record<string, string>;
  /** Hard cap on buffered stdout, defending against a runaway child. */
  maxBufferBytes: number;
  cwd?: string | undefined;
}

/**
 * MCP over stdio: newline-delimited JSON-RPC on the child's stdin/stdout.
 *
 * The child is spawned without a shell and receives a minimal environment —
 * only PATH, HOME and the variables the server version explicitly declared.
 * Inheriting the parent environment would hand every MCP server the Hub's own
 * database URL and encryption key.
 */
export class StdioTransport implements McpTransport {
  readonly kind = 'stdio' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private bufferedBytes = 0;
  private stderrTail = '';
  private events: TransportEvents | null = null;
  private closed = false;

  constructor(private readonly options: StdioTransportOptions) {}

  async start(events: TransportEvents): Promise<void> {
    this.events = events;
    const { config } = this.options;

    const child = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      cwd: this.options.cwd ?? config.cwd ?? undefined,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        ...this.options.env,
      },
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // stderr is the server's log channel in MCP; keep a tail for diagnostics.
      this.stderrTail = (this.stderrTail + chunk).slice(-4000);
    });

    child.on('error', (err) => {
      events.onError(
        new HubError('UPSTREAM_ERROR', `Failed to launch MCP server: ${err.message}`, {
          cause: err,
        }),
      );
    });
    child.on('close', (code) => {
      this.closed = true;
      events.onClose({ code, reason: this.stderrTail.slice(-500) });
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        child.off('spawn', onSpawn);
        child.off('error', onError);
      };
      function onSpawn(): void {
        cleanup();
        resolve();
      }
      function onError(err: Error): void {
        cleanup();
        reject(
          new HubError('UPSTREAM_ERROR', `Failed to launch MCP server: ${err.message}`, {
            cause: err,
          }),
        );
      }
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  private consume(chunk: string): void {
    this.bufferedBytes += Buffer.byteLength(chunk, 'utf8');
    if (this.bufferedBytes > this.options.maxBufferBytes) {
      this.events?.onError(
        new HubError(
          'PAYLOAD_TOO_LARGE',
          `MCP server wrote more than ${this.options.maxBufferBytes} bytes without a complete message.`,
        ),
      );
      void this.close();
      return;
    }

    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.bufferedBytes = Buffer.byteLength(this.buffer, 'utf8');
      if (line.length > 0) this.emitLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private emitLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Servers occasionally print banners to stdout. Reporting and skipping
      // an unparsable line is more useful than failing the whole session.
      this.events?.onError(
        new HubError('UPSTREAM_ERROR', 'MCP server wrote a non-JSON line to stdout.', {
          details: { excerpt: line.slice(0, 200) },
        }),
      );
      return;
    }
    this.events?.onMessage(parsed as JsonRpcMessage);
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const child = this.child;
    if (!child || this.closed) throw new TransportClosedError();
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(line, 'utf8', (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || this.closed) return;
    this.closed = true;
    child.stdin.end();
    // Give the server a moment to exit cleanly, then stop waiting.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  describe(): Record<string, unknown> {
    return {
      kind: 'stdio',
      command: this.options.config.command,
      args: this.options.config.args,
      envKeys: this.options.config.envKeys,
      stderrTail: this.stderrTail.slice(-500) || null,
    };
  }
}
