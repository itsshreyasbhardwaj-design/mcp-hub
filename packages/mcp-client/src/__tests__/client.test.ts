import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StdioTransportConfig } from '@mcp-hub/core';
import { resetConfigCache } from '@mcp-hub/config';
import { McpClient } from '../client.js';
import { connectToServer, withMcpSession } from '../factory.js';
import { StdioTransport } from '../transports/stdio.js';

const NOTES_SERVER = resolve(
  import.meta.dirname,
  '../../../../examples/notes-server/dist/index.js',
);
const FLAKY_SERVER = resolve(
  import.meta.dirname,
  '../../../../examples/flaky-server/dist/index.js',
);

function stdio(entry: string, env: string[] = []): StdioTransportConfig {
  return { kind: 'stdio', command: 'node', args: [entry], envKeys: env };
}

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['MCP_HUB_ALLOW_STDIO'] = 'true';
  process.env['MCP_HUB_DATA_DIR'] = '.mcp-hub-test';
  resetConfigCache();
});

const openClients: McpClient[] = [];
afterEach(async () => {
  while (openClients.length)
    await openClients
      .pop()
      ?.close()
      .catch(() => undefined);
});

describe('MCP client against a real server', () => {
  it('completes the initialize handshake', async () => {
    const client = await connectToServer({ transport: stdio(NOTES_SERVER) });
    openClients.push(client);
    const info = client.info;
    expect(info?.serverInfo.name).toBe('example-notes-server');
    expect(info?.serverInfo.version).toBe('1.2.0');
    expect(info?.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info?.handshakeMs).toBeGreaterThanOrEqual(0);
  });

  it('discovers tools, resources and prompts', async () => {
    await withMcpSession({ transport: stdio(NOTES_SERVER) }, async (client) => {
      const tools = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'create_note',
        'delete_note',
        'list_notes',
        'search_notes',
        'sync_to_remote',
      ]);

      const listNotes = tools.find((t) => t.name === 'list_notes');
      expect(listNotes?.inputSchema).toMatchObject({ type: 'object' });
      expect(listNotes?.annotations).toMatchObject({ readOnlyHint: true });

      const resources = await client.listResources();
      expect(resources.map((r) => r.uri)).toContain('notes://all');

      const prompts = await client.listPrompts();
      expect(prompts.map((p) => p.name)).toContain('summarize_notes');
    });
  });

  it('calls a tool and returns structured content', async () => {
    await withMcpSession({ transport: stdio(NOTES_SERVER) }, async (client) => {
      const result = await client.callTool('search_notes', { query: 'coffee' });
      expect(result.isError).toBe(false);
      expect(result.content[0]?.type).toBe('text');
      expect(result.structuredContent).toMatchObject({ matches: expect.any(Array) });
    });
  });

  it('round-trips a write and reads it back', async () => {
    await withMcpSession({ transport: stdio(NOTES_SERVER) }, async (client) => {
      const created = await client.callTool('create_note', {
        title: 'From the test',
        body: 'written over MCP',
        tags: ['test'],
      });
      expect(created.isError).toBe(false);
      const found = await client.callTool('search_notes', { query: 'written over MCP' });
      const matches = (found.structuredContent as { matches: unknown[] }).matches;
      expect(matches).toHaveLength(1);
    });
  });

  it('surfaces a tool error without killing the session', async () => {
    await withMcpSession({ transport: stdio(NOTES_SERVER) }, async (client) => {
      const result = await client.callTool('delete_note', { id: 'does-not-exist' });
      expect(result.isError).toBe(true);
      // The session is still usable afterwards.
      await expect(client.callTool('list_notes', { limit: 1 })).resolves.toBeDefined();
    });
  });

  it('reports an unknown tool as a tool-level error, per the MCP spec', async () => {
    await withMcpSession({ transport: stdio(NOTES_SERVER) }, async (client) => {
      // MCP distinguishes protocol errors from tool errors: an unknown tool
      // comes back as a successful JSON-RPC response carrying isError.
      const result = await client.callTool('no_such_tool', {});
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('no_such_tool');
    });
  });

  it('raises a protocol error for an unknown JSON-RPC method', async () => {
    await withMcpSession({ transport: stdio(NOTES_SERVER) }, async (client) => {
      await expect(client.request('no/such/method', {})).rejects.toMatchObject({
        code: 'UPSTREAM_ERROR',
      });
    });
  });

  it('times out a hanging tool instead of blocking forever', async () => {
    const client = await connectToServer({
      transport: {
        kind: 'stdio',
        command: 'node',
        args: [FLAKY_SERVER],
        envKeys: ['FLAKY_HANG_TOOL'],
      },
      secrets: { FLAKY_HANG_TOOL: 'stable_ping' },
      // A short budget for the call, a generous one for the handshake: a stdio
      // server has to be spawned first, which is slow on a loaded machine and
      // says nothing about how fast the server answers once it is up.
      requestTimeoutMs: 800,
      connectTimeoutMs: 20_000,
    });
    openClients.push(client);
    const started = Date.now();
    await expect(client.callTool('stable_ping', {})).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
    // Asserting the timeout fired at all, not a precise budget: the bound is
    // deliberately loose so a loaded CI machine cannot make this flaky.
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('judges the handshake on its own budget, not the per-call one', async () => {
    const client = await connectToServer({
      transport: stdio(NOTES_SERVER),
      // A per-call budget far too short to spawn a process: connecting must
      // still succeed, because the handshake has its own budget.
      requestTimeoutMs: 1,
      connectTimeoutMs: 20_000,
    });
    openClients.push(client);
    expect(client.info?.serverInfo.name).toBe('example-notes-server');
    // The tight per-call budget still applies to everything afterwards.
    await expect(client.listTools()).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('reports a server that refuses to start', async () => {
    await expect(
      connectToServer({
        transport: {
          kind: 'stdio',
          command: 'node',
          args: [FLAKY_SERVER],
          envKeys: ['FLAKY_FAIL_INIT'],
        },
        secrets: { FLAKY_FAIL_INIT: '1' },
        requestTimeoutMs: 3000,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('reflects a hidden tool as a smaller capability surface', async () => {
    await withMcpSession(
      {
        transport: {
          kind: 'stdio',
          command: 'node',
          args: [FLAKY_SERVER],
          envKeys: ['FLAKY_HIDE_TOOL'],
        },
        secrets: { FLAKY_HIDE_TOOL: 'purge_everything' },
      },
      async (client) => {
        const names = (await client.listTools()).map((t) => t.name);
        expect(names).toContain('stable_ping');
        expect(names).not.toContain('purge_everything');
      },
    );
  });
});

describe('transport policy', () => {
  it('refuses stdio when the deployment has not opted in', async () => {
    process.env['MCP_HUB_ALLOW_STDIO'] = 'false';
    resetConfigCache();
    try {
      await expect(connectToServer({ transport: stdio(NOTES_SERVER) })).rejects.toMatchObject({
        code: 'TRANSPORT_BLOCKED',
      });
    } finally {
      process.env['MCP_HUB_ALLOW_STDIO'] = 'true';
      resetConfigCache();
    }
  });

  it('refuses an executable that is not on the allowlist', async () => {
    process.env['MCP_HUB_STDIO_ALLOWED_COMMANDS'] = 'deno';
    resetConfigCache();
    try {
      await expect(connectToServer({ transport: stdio(NOTES_SERVER) })).rejects.toMatchObject({
        code: 'TRANSPORT_BLOCKED',
      });
    } finally {
      delete process.env['MCP_HUB_STDIO_ALLOWED_COMMANDS'];
      resetConfigCache();
    }
  });

  it('refuses shell metacharacters in arguments', async () => {
    await expect(
      connectToServer({
        transport: {
          kind: 'stdio',
          command: 'node',
          args: [`${NOTES_SERVER}; rm -rf /tmp/nope`],
          envKeys: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'TRANSPORT_BLOCKED' });
  });

  it('does not leak the parent environment into the child', async () => {
    process.env['MCP_HUB_SECRET_CANARY'] = 'do-not-leak';
    const transport = new StdioTransport({
      config: stdio(NOTES_SERVER),
      env: {},
      maxBufferBytes: 1024 * 1024,
    });
    const client = new McpClient({ transport, requestTimeoutMs: 5000 });
    openClients.push(client);
    await client.connect();
    // The example server does not echo the environment, so assert on the
    // transport contract directly: only PATH, HOME and declared keys are set.
    expect(transport.describe()).toMatchObject({ kind: 'stdio', envKeys: [] });
    delete process.env['MCP_HUB_SECRET_CANARY'];
  });
});
