import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@mcp-hub/config';
import { createTestDatabase, type SqlDriver } from '@mcp-hub/database';
import { buildContext, type AppContext } from '../context.js';
import { Router } from '../http/router.js';
import { routes } from '../http/routes.js';
import { authRoutes } from '../http/auth-routes.js';
import type { HttpMethod, HubRequest, HubResponse } from '../http/types.js';
import { seed } from '../seed.js';

const NOTES_SERVER = resolve(
  import.meta.dirname,
  '../../../../examples/notes-server/dist/index.js',
);

let db: SqlDriver;
let app: AppContext;
let router: Router;
const sessions = new Map<string, string>();

function request(
  method: HttpMethod,
  path: string,
  options: { body?: unknown; as?: string; headers?: Record<string, string> } = {},
): HubRequest {
  const headers = new Headers({ 'content-type': 'application/json', ...options.headers });
  const cookies = new Map<string, string>();
  if (options.as) {
    const token = sessions.get(options.as);
    if (!token) throw new Error(`No session for ${options.as}`);
    cookies.set('mcp_hub_session', token);
  }
  return {
    method,
    url: new URL(`http://localhost:3000${path}`),
    headers,
    cookies,
    body: options.body,
    rawBody: options.body === undefined ? '' : JSON.stringify(options.body),
    params: {},
    ip: '127.0.0.1',
  };
}

async function call(
  method: HttpMethod,
  path: string,
  options: { body?: unknown; as?: string; headers?: Record<string, string> } = {},
): Promise<HubResponse> {
  return router.handle(request(method, path, options), app);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bodyOf<T = any>(response: HubResponse): T {
  return response.body as T;
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['MCP_HUB_ALLOW_STDIO'] = 'true';
  process.env['MCP_HUB_RATE_MAX_REQUESTS'] = '100000';
  process.env['MCP_HUB_RATE_MAX_TOOL_EXECUTIONS'] = '100000';
  process.env['LOG_LEVEL'] = 'error';
  resetConfigCache();

  db = await createTestDatabase();
  app = buildContext(db);
  router = new Router([...authRoutes, ...routes]);
  await seed(app);

  for (const email of [
    'owner@example.com',
    'admin@example.com',
    'dev@example.com',
    'viewer@example.com',
  ]) {
    const user = await app.repositories.identity.findUserByEmail(email);
    if (!user) throw new Error(`seed did not create ${email}`);
    const session = await app.repositories.sessions.create(user.id, 3_600_000);
    sessions.set(email, session.token);
  }
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('health and metadata', () => {
  it('serves an unauthenticated health probe', async () => {
    const response = await call('GET', '/api/v1/health');
    expect(response.status).toBe(200);
    expect(bodyOf(response).status).toBe('ok');
    expect(bodyOf(response).database.driver).toBe('pglite');
  });

  it('publishes the validation rule catalogue', async () => {
    const response = await call('GET', '/api/v1/meta/rules', { as: 'dev@example.com' });
    expect(response.status).toBe(200);
    expect(bodyOf(response).rules.length).toBeGreaterThan(10);
  });

  it('stamps every response with a request id', async () => {
    const response = await call('GET', '/api/v1/health');
    expect(response.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('authentication and authorization', () => {
  it('rejects unauthenticated access to a protected route', async () => {
    const response = await call('GET', '/api/v1/servers');
    expect(response.status).toBe(401);
    expect(bodyOf(response).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an invalid API key', async () => {
    const response = await call('GET', '/api/v1/servers', {
      headers: { authorization: 'Bearer mch_not_a_real_key' },
    });
    expect(response.status).toBe(401);
  });

  it('refuses a viewer trying to register a server', async () => {
    const response = await call('POST', '/api/v1/servers', {
      as: 'viewer@example.com',
      body: { name: 'Should not exist' },
    });
    expect(response.status).toBe(403);
    expect(bodyOf(response).error.code).toBe('FORBIDDEN');
  });

  it('refuses a developer trying to delete a server', async () => {
    const list = bodyOf(await call('GET', '/api/v1/servers', { as: 'dev@example.com' }));
    const target = list.data[0];
    const response = await call('DELETE', `/api/v1/servers/${target.id}`, {
      as: 'dev@example.com',
    });
    expect(response.status).toBe(403);
  });

  it('returns 404 for a method that exists on no route', async () => {
    const response = await call('GET', '/api/v1/nope', { as: 'dev@example.com' });
    expect(response.status).toBe(404);
  });
});

describe('request validation', () => {
  it('rejects a malformed body with field-level detail', async () => {
    const response = await call('POST', '/api/v1/servers', {
      as: 'dev@example.com',
      body: { name: '', repositoryUrl: 'not-a-url' },
    });
    expect(response.status).toBe(422);
    expect(bodyOf(response).error.code).toBe('VALIDATION_FAILED');
    expect(bodyOf(response).error.details.issues.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported transport kind', async () => {
    const response = await call('POST', '/api/v1/servers', {
      as: 'dev@example.com',
      body: {
        name: 'Bad transport',
        version: { version: '1.0.0', transport: { kind: 'carrier-pigeon', url: 'https://x.test' } },
      },
    });
    expect(response.status).toBe(422);
  });
});

describe('the full registration lifecycle against a live MCP server', () => {
  let serverId: string;
  let versionId: string;

  it('registers a server', async () => {
    const response = await call('POST', '/api/v1/servers', {
      as: 'dev@example.com',
      body: {
        name: 'Lifecycle Notes',
        slug: 'lifecycle-notes',
        description: 'Registered by the integration test against the real example server.',
        tags: ['test', 'notes'],
        status: 'active',
        version: {
          version: '1.0.0',
          transport: { kind: 'stdio', command: 'node', args: [NOTES_SERVER], envKeys: [] },
        },
      },
    });
    expect(response.status).toBe(201);
    serverId = bodyOf(response).server.id;
    versionId = bodyOf(response).versionId;
    expect(serverId).toMatch(/^srv_/);
    expect(versionId).toMatch(/^ver_/);
  });

  it('discovers the real capability surface', async () => {
    const response = await call('POST', `/api/v1/versions/${versionId}/discover`, {
      as: 'dev@example.com',
      body: {},
    });
    expect(response.status).toBe(200);
    const result = bodyOf(response);
    expect(result.serverInfo.name).toBe('example-notes-server');
    expect(result.toolCount).toBe(5);
    expect(result.resourceCount).toBeGreaterThanOrEqual(1);
    expect(result.promptCount).toBe(1);
  }, 30_000);

  it('classifies the discovered tools by risk', async () => {
    const response = await call(`GET`, `/api/v1/servers/${serverId}/tools`, {
      as: 'dev@example.com',
    });
    const tools: Array<{ name: string; riskClass: string }> = bodyOf(response).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.riskClass]));
    expect(byName['list_notes']).toBe('READ');
    expect(byName['create_note']).toBe('WRITE');
    expect(byName['delete_note']).toBe('DESTRUCTIVE');
    // sync_to_remote takes both a URL and an api_key. CREDENTIAL outranks
    // NETWORK in the severity order, and the more dangerous class wins.
    expect(byName['sync_to_remote']).toBe('CREDENTIAL');
  });

  it('validates the server and reports rule-level findings', async () => {
    const response = await call('POST', `/api/v1/servers/${serverId}/validate`, {
      as: 'dev@example.com',
    });
    expect(response.status).toBe(200);
    const run = bodyOf(response);
    expect(['pass', 'warning', 'error']).toContain(run.outcome);
    expect(Array.isArray(run.findings)).toBe(true);
    for (const finding of run.findings) {
      expect(finding.rule).toBeTruthy();
      expect(finding.location).toBeTruthy();
    }
  });

  it('runs compatibility tests against the live server', async () => {
    const response = await call('POST', `/api/v1/servers/${serverId}/test`, {
      as: 'dev@example.com',
      body: { versionId },
    });
    expect(response.status).toBe(200);
    const run = bodyOf(response);
    expect(run.total).toBeGreaterThan(10);
    expect(run.passed).toBeGreaterThan(5);
    const initialize = run.cases.find((c: { key: string }) => c.key === 'connection.initialize');
    expect(initialize.outcome).toBe('passed');
  }, 60_000);

  it('executes a READ tool and records the invocation', async () => {
    const response = await call('POST', '/api/v1/tools/execute', {
      as: 'dev@example.com',
      body: { versionId, toolName: 'search_notes', arguments: { query: 'coffee' } },
    });
    expect(response.status).toBe(200);
    const result = bodyOf(response);
    expect(result.status).toBe('success');
    expect(result.decision.effect).toBe('allow');
    expect(result.invocationId).toMatch(/^inv_/);

    const invocations = bodyOf(
      await call('GET', `/api/v1/invocations?serverId=${serverId}`, { as: 'dev@example.com' }),
    );
    expect(invocations.data.length).toBeGreaterThan(0);
  }, 30_000);

  it('blocks a DESTRUCTIVE tool until the risk is acknowledged', async () => {
    const response = await call('POST', '/api/v1/tools/execute', {
      as: 'admin@example.com',
      body: { versionId, toolName: 'delete_note', arguments: { id: 'note-1' } },
    });
    // The seeded policy requires approval for DESTRUCTIVE tools, and the
    // acknowledgement gate fires before the approval lookup.
    expect([403, 428]).toContain(response.status);
    expect(['CONFIRMATION_REQUIRED', 'APPROVAL_REQUIRED']).toContain(bodyOf(response).error.code);
  });

  it('still refuses a DESTRUCTIVE tool with acknowledgement but no approval', async () => {
    const response = await call('POST', '/api/v1/tools/execute', {
      as: 'admin@example.com',
      body: {
        versionId,
        toolName: 'delete_note',
        arguments: { id: 'note-1' },
        acknowledgeRisk: true,
      },
    });
    expect(response.status).toBe(403);
    expect(bodyOf(response).error.code).toBe('APPROVAL_REQUIRED');
  });

  it('executes a DESTRUCTIVE tool only after a second person approves it', async () => {
    const args = { id: 'note-2' };
    const requested = await call('POST', '/api/v1/approvals', {
      as: 'dev@example.com',
      body: { versionId, toolName: 'delete_note', arguments: args, reason: 'cleanup' },
    });
    expect(requested.status).toBe(201);
    const approvalId = bodyOf(requested).id;

    // The requester cannot approve their own request.
    const selfApproval = await call(`POST`, `/api/v1/approvals/${approvalId}/decision`, {
      as: 'dev@example.com',
      body: { decision: 'approved' },
    });
    expect(selfApproval.status).toBe(403);

    const decided = await call('POST', `/api/v1/approvals/${approvalId}/decision`, {
      as: 'admin@example.com',
      body: { decision: 'approved', reason: 'reviewed' },
    });
    expect(decided.status).toBe(200);
    expect(bodyOf(decided).status).toBe('approved');

    const executed = await call('POST', '/api/v1/tools/execute', {
      as: 'dev@example.com',
      body: { versionId, toolName: 'delete_note', arguments: args, acknowledgeRisk: true },
    });
    expect(executed.status).toBe(200);
    expect(bodyOf(executed).status).toBe('success');

    // The approval is single-use: the identical call now fails.
    const replay = await call('POST', '/api/v1/tools/execute', {
      as: 'dev@example.com',
      body: { versionId, toolName: 'delete_note', arguments: args, acknowledgeRisk: true },
    });
    expect(replay.status).toBe(403);
    expect(bodyOf(replay).error.code).toBe('APPROVAL_REQUIRED');
  }, 40_000);

  it('does not let an approval authorise different arguments', async () => {
    const requested = await call('POST', '/api/v1/approvals', {
      as: 'dev@example.com',
      body: { versionId, toolName: 'delete_note', arguments: { id: 'safe-note' } },
    });
    const approvalId = bodyOf(requested).id;
    await call('POST', `/api/v1/approvals/${approvalId}/decision`, {
      as: 'admin@example.com',
      body: { decision: 'approved' },
    });

    const hijacked = await call('POST', '/api/v1/tools/execute', {
      as: 'dev@example.com',
      body: {
        versionId,
        toolName: 'delete_note',
        arguments: { id: 'production-note' },
        acknowledgeRisk: true,
        approvalId,
      },
    });
    expect(hijacked.status).toBe(403);
    expect(bodyOf(hijacked).error.message).toMatch(/different arguments/i);
  });

  it('publishes the version and freezes its surface', async () => {
    const response = await call('POST', `/api/v1/versions/${versionId}/publish`, {
      as: 'dev@example.com',
      body: {},
    });
    expect(response.status).toBe(200);
    expect(bodyOf(response).version.published).toBe(true);

    const rediscover = await call('POST', `/api/v1/versions/${versionId}/discover`, {
      as: 'dev@example.com',
      body: {},
    });
    expect(rediscover.status).toBe(409);
    expect(bodyOf(rediscover).error.code).toBe('VERSION_IMMUTABLE');
  });

  it('compares two versions and reports breaking changes', async () => {
    const created = await call('POST', `/api/v1/servers/${serverId}/versions`, {
      as: 'dev@example.com',
      body: {
        version: '2.0.0',
        transport: {
          kind: 'stdio',
          command: 'node',
          args: [resolve(import.meta.dirname, '../../../../examples/flaky-server/dist/index.js')],
          envKeys: [],
        },
      },
    });
    const v2 = bodyOf(created).id;
    await call('POST', `/api/v1/versions/${v2}/discover`, { as: 'dev@example.com', body: {} });

    const diff = bodyOf(
      await call('GET', `/api/v1/versions/${versionId}/compare/${v2}`, { as: 'dev@example.com' }),
    );
    expect(diff.toolsRemoved).toBeGreaterThan(0);
    expect(diff.toolsAdded).toBeGreaterThan(0);
    expect(diff.breakingChanges).toBeGreaterThan(0);
    const removal = diff.changes.find((c: { kind: string }) => c.kind === 'tool_removed');
    expect(removal.breaking).toBe(true);
    expect(removal.rule).toBe('tool.removed');
  }, 60_000);

  it('generates client configuration with credential placeholders only', async () => {
    const response = await call('POST', `/api/v1/servers/${serverId}/config`, {
      as: 'dev@example.com',
      body: { versionId, format: 'claude-desktop' },
    });
    expect(response.status).toBe(200);
    const config = bodyOf(response);
    expect(config.content).toContain('mcpServers');
    expect(config.content).not.toMatch(/sk-|password|Bearer [A-Za-z0-9]/);
  });

  it('records the whole lifecycle in the audit log', async () => {
    const activity = bodyOf(
      await call('GET', '/api/v1/activity?limit=100', { as: 'admin@example.com' }),
    );
    const actions = new Set(activity.data.map((row: { action: string }) => row.action));
    for (const expected of [
      'server.registered',
      'capabilities.discovered',
      'validation.run',
      'compatibility.run',
      'tool.invoked',
      'tool.denied',
      'approval.requested',
      'approval.decided',
      'version.published',
    ]) {
      expect(actions.has(expected), `missing audit action ${expected}`).toBe(true);
    }
  });
});

describe('search and discovery', () => {
  it('finds a tool by its description', async () => {
    const response = await call('GET', '/api/v1/search?q=notebook&type=tool', {
      as: 'dev@example.com',
    });
    expect(response.status).toBe(200);
    expect(bodyOf(response).provider).toBe('postgres');
  });

  it('finds servers by name prefix', async () => {
    const response = await call('GET', '/api/v1/search?q=Warehouse', { as: 'dev@example.com' });
    const hits = bodyOf(response).data;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toContain('Warehouse');
  });

  it('lists tools across every server', async () => {
    const response = await call('GET', '/api/v1/tools?q=delete', { as: 'dev@example.com' });
    const rows = bodyOf(response).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: { riskClass: string }) => row.riskClass)).toBe(true);
  });
});

describe('analytics', () => {
  it('reports metrics derived from stored events', async () => {
    const response = await call('GET', '/api/v1/analytics?range=7d', { as: 'admin@example.com' });
    expect(response.status).toBe(200);
    const data = bodyOf(response);
    expect(data.metrics.servers.total).toBeGreaterThan(0);
    expect(data.metrics.invocations.total).toBeGreaterThan(0);
    expect(data.series.requests.total.length).toBeGreaterThan(0);
    expect(data.isEmpty).toBe(false);
  });

  it('rejects an invalid time range', async () => {
    const response = await call('GET', '/api/v1/analytics?range=all-time', {
      as: 'admin@example.com',
    });
    expect(response.status).toBe(400);
  });
});

describe('assistant', () => {
  it('answers from recorded evidence', async () => {
    const response = await call('POST', '/api/v1/assistant', {
      as: 'admin@example.com',
      body: { question: 'How many tool calls were there in the last week?' },
    });
    expect(response.status).toBe(200);
    const answer = bodyOf(response);
    expect(answer.intent).toBe('usage_stats');
    expect(answer.evidence.length).toBeGreaterThan(0);
    expect(answer.deterministic).toBe(true);
  });

  it('says so when there is no evidence', async () => {
    const response = await call('POST', '/api/v1/assistant', {
      as: 'admin@example.com',
      body: { question: 'Why is the "nonexistent-server-xyz" failing?' },
    });
    expect(bodyOf(response).insufficientEvidence).toBe(true);
    expect(bodyOf(response).answer).toMatch(/insufficient evidence/i);
  });
});

describe('API keys', () => {
  it('issues a key once and authenticates with it', async () => {
    const created = await call('POST', '/api/v1/api-keys', {
      as: 'admin@example.com',
      body: { name: 'CI', scopes: ['servers:read', 'tools:read'] },
    });
    expect(created.status).toBe(201);
    const plaintext: string = bodyOf(created).plaintext;
    expect(plaintext.startsWith('mch_')).toBe(true);

    const listed = bodyOf(await call('GET', '/api/v1/api-keys', { as: 'admin@example.com' }));
    expect(listed.keys.every((key: { hash?: string }) => key.hash === undefined)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(plaintext);

    const withKey = await call('GET', '/api/v1/servers', {
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(withKey.status).toBe(200);

    // The key lacks tools:execute, so execution is refused.
    const execution = await call('POST', '/api/v1/tools/execute', {
      headers: { authorization: `Bearer ${plaintext}` },
      body: { versionId: 'ver_none', toolName: 'x', arguments: {} },
    });
    expect(execution.status).toBe(403);

    const keyId = bodyOf(created).key.id;
    expect(
      (await call('DELETE', `/api/v1/api-keys/${keyId}`, { as: 'admin@example.com' })).status,
    ).toBe(204);
    expect(
      (await call('GET', '/api/v1/servers', { headers: { authorization: `Bearer ${plaintext}` } }))
        .status,
    ).toBe(401);
  });
});
