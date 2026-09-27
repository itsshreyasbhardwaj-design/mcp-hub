import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@mcp-hub/config';
import { createTestDatabase, type SqlDriver } from '@mcp-hub/database';
import { apiRouter, buildContext, fromWebRequest, seed, type AppContext } from '@mcp-hub/api';
import { generateApiKey } from '@mcp-hub/security';
import { withMcpSession } from '@mcp-hub/mcp-client';

/**
 * Drives MCP Hub's own MCP server the way an agent would: the real binary,
 * over stdio, speaking real MCP, against a real HTTP API backed by a real
 * database. Nothing here is mocked.
 */

let db: SqlDriver;
let app: AppContext;
let http: Server;
let baseUrl: string;
let apiKey: string;

const BIN = resolve(import.meta.dirname, '../../dist/bin.js');

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['LOG_LEVEL'] = 'error';
  process.env['MCP_HUB_ALLOW_STDIO'] = 'true';
  process.env['MCP_HUB_RATE_MAX_REQUESTS'] = '100000';
  resetConfigCache();

  db = await createTestDatabase();
  app = buildContext(db);
  await seed(app);

  const organization = await app.repositories.identity.findOrganizationBySlug('acme-robotics');
  if (!organization) throw new Error('seed did not create the organization');
  const generated = generateApiKey();
  await app.repositories.apiKeys.create({
    organizationId: organization.id,
    name: 'mcp-server test key',
    prefix: generated.prefix,
    hash: generated.hash,
    scopes: ['servers:read', 'tools:read', 'health:read', 'analytics:read', 'validation:run'],
    createdBy: null,
    expiresAt: null,
  });
  apiKey = generated.plaintext;

  http = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      const method = req.method ?? 'GET';
      const request = new Request(url, {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
      });
      const response = await apiRouter.handle(await fromWebRequest(request), app);
      res.writeHead(response.status, response.headers);
      res.end(response.body === null ? undefined : JSON.stringify(response.body));
    })().catch(() => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":{"code":"INTERNAL","message":"test harness failure"}}');
    });
  });

  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const address = http.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((done) => http.close(() => done()));
  await db.close();
});

function session<T>(fn: Parameters<typeof withMcpSession<T>>[1]): Promise<T> {
  return withMcpSession(
    {
      transport: {
        kind: 'stdio',
        command: 'node',
        args: [BIN],
        envKeys: ['MCP_HUB_API_KEY', 'MCP_HUB_URL', 'MCP_HUB_ALLOW_PRIVATE_NETWORK'],
      },
      secrets: {
        MCP_HUB_API_KEY: apiKey,
        MCP_HUB_URL: baseUrl,
        MCP_HUB_ALLOW_PRIVATE_NETWORK: 'true',
      },
      requestTimeoutMs: 20_000,
    },
    fn,
  );
}

describe('MCP Hub over MCP', () => {
  it('advertises itself and its read-only tool set', async () => {
    await session(async (client) => {
      expect(client.info?.serverInfo.name).toBe('mcp-hub');
      const tools = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'get_server',
        'get_server_health',
        'get_tool_schema',
        'get_version_changes',
        'list_tools',
        'search_servers',
        'search_tools',
        'validate_server',
      ]);
      // Every tool must declare itself read-only: this server is not an
      // administrative back door.
      for (const tool of tools) {
        expect(tool.annotations?.['readOnlyHint'], tool.name).toBe(true);
      }
    });
  }, 60_000);

  it('searches the registry', async () => {
    await session(async (client) => {
      const result = await client.callTool('search_servers', { query: 'warehouse' });
      expect(result.isError).toBeFalsy();
      const payload = result.structuredContent as { results: Array<{ title: string }> };
      expect(payload.results.length).toBeGreaterThan(0);
      expect(payload.results[0]?.title).toContain('Warehouse');
    });
  }, 60_000);

  it('returns a tool schema an agent could build a call from', async () => {
    await session(async (client) => {
      const result = await client.callTool('get_tool_schema', {
        server: 'demo-warehouse',
        tool: 'run_query',
      });
      const payload = result.structuredContent as {
        name: string;
        inputSchema: { properties: Record<string, unknown>; required: string[] };
        riskClass: string;
      };
      expect(payload.name).toBe('run_query');
      expect(Object.keys(payload.inputSchema.properties)).toContain('sql');
      expect(payload.inputSchema.required).toContain('sql');
      expect(payload.riskClass).toBeTruthy();
    });
  }, 60_000);

  it('reports risk classifications alongside tools', async () => {
    await session(async (client) => {
      const result = await client.callTool('list_tools', { server: 'demo-warehouse' });
      const payload = result.structuredContent as {
        tools: Array<{ name: string; riskClass: string }>;
      };
      const byName = Object.fromEntries(payload.tools.map((t) => [t.name, t.riskClass]));
      expect(byName['drop_table']).toBe('DESTRUCTIVE');
      expect(byName['list_tables']).toBe('READ');
    });
  }, 60_000);

  it('diffs two versions with breaking-change reasoning', async () => {
    const detail = await app.repositories.registry.findServerBySlug(
      (await app.repositories.identity.findOrganizationBySlug('acme-robotics'))!.id,
      'demo-source-control',
    );
    if (!detail) throw new Error('missing demo server');
    const versions = await app.repositories.registry.listVersions(
      detail.organizationId,
      detail.id,
    );
    const from = versions.find((v) => v.version === '1.3.0');
    const to = versions.find((v) => v.version === '1.4.0');
    if (!from || !to) throw new Error('missing demo versions');

    await session(async (client) => {
      const result = await client.callTool('get_version_changes', {
        from_version_id: from.id,
        to_version_id: to.id,
      });
      const payload = result.structuredContent as {
        summary: { toolsAdded: number; breakingChanges: number };
        changes: Array<{ rule: string; breaking: boolean; detail: string }>;
      };
      expect(payload.summary.toolsAdded).toBe(1);
      // delete_branch gained a required `force` parameter between the versions.
      expect(payload.summary.breakingChanges).toBeGreaterThan(0);
      const breaking = payload.changes.find((c) => c.breaking);
      expect(breaking?.rule).toBeTruthy();
      expect(breaking?.detail.length).toBeGreaterThan(10);
    });
  }, 60_000);

  it('surfaces an API error as a tool error rather than crashing', async () => {
    await session(async (client) => {
      const result = await client.callTool('get_server', { server: 'no-such-server' });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('SERVER_NOT_FOUND');
    });
  }, 60_000);

  it('cannot exceed the scopes of the key it was given', async () => {
    // The key carries no tools:execute scope, and the MCP server exposes no
    // execution tool at all — two independent reasons an agent cannot act.
    await session(async (client) => {
      const names = (await client.listTools()).map((t) => t.name);
      expect(names).not.toContain('execute_tool');
      expect(names).not.toContain('register_server');
      expect(names).not.toContain('delete_server');
    });
  }, 60_000);
});
