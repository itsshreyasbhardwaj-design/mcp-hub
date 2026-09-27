import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Id } from '@mcp-hub/core';
import type { SqlDriver } from '../driver.js';
import { createTestDatabase, uniq } from '../testkit.js';
import { IdentityRepository } from '../repositories/identity.js';
import { RegistryRepository } from '../repositories/registry.js';
import { GovernanceRepository } from '../repositories/governance.js';
import { AnalyticsRepository } from '../repositories/analytics.js';
import { SearchRepository } from '../repositories/search.js';
import { JobRepository } from '../repositories/jobs.js';

let db: SqlDriver;
let identity: IdentityRepository;
let registry: RegistryRepository;
let governance: GovernanceRepository;
let analytics: AnalyticsRepository;
let search: SearchRepository;
let jobs: JobRepository;

let orgA: Id<'organization'>;
let orgB: Id<'organization'>;
let user: Id<'user'>;

beforeAll(async () => {
  db = await createTestDatabase();
  identity = new IdentityRepository(db);
  registry = new RegistryRepository(db);
  governance = new GovernanceRepository(db);
  analytics = new AnalyticsRepository(db);
  search = new SearchRepository(db);
  jobs = new JobRepository(db);

  const a = await identity.createOrganization({ name: 'Acme', slug: uniq('acme') });
  const b = await identity.createOrganization({ name: 'Globex', slug: uniq('globex') });
  orgA = a.id;
  orgB = b.id;
  const u = await identity.upsertUser({ externalId: uniq('ext'), email: `${uniq('u')}@example.com` });
  user = u.id;
  await identity.addMember(orgA, user, 'owner');
});

afterAll(async () => {
  await db.close();
});

describe('migrations', () => {
  it('creates every expected table', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = new Set(rows.map((r) => r.table_name));
    for (const expected of [
      'organizations',
      'users',
      'organization_members',
      'servers',
      'server_versions',
      'server_tools',
      'server_resources',
      'server_prompts',
      'validation_runs',
      'compatibility_runs',
      'health_checks',
      'incidents',
      'permission_rules',
      'approvals',
      'tool_invocations',
      'audit_logs',
      'api_keys',
      'analytics_events',
      'search_documents',
      'jobs',
    ]) {
      expect(names.has(expected), `missing table ${expected}`).toBe(true);
    }
  });

  it('is idempotent', async () => {
    const { runMigrations } = await import('../migrate.js');
    const result = await runMigrations(db);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});

describe('registry repository', () => {
  it('creates, reads and updates servers', async () => {
    const slug = uniq('srv');
    const created = await registry.createServer({
      organizationId: orgA,
      slug,
      name: 'Filesystem Server',
      description: 'Reads and writes files',
      tags: ['files', 'local'],
      createdBy: user,
    });
    expect(created.slug).toBe(slug);
    expect(created.tags).toEqual(['files', 'local']);

    const updated = await registry.updateServer(orgA, created.id, {
      status: 'active',
      description: 'Updated',
    });
    expect(updated.status).toBe('active');
    expect(updated.description).toBe('Updated');

    const resolved = await registry.resolveServer(orgA, slug);
    expect(resolved.id).toBe(created.id);
  });

  it('rejects duplicate slugs within an organization', async () => {
    const slug = uniq('dup');
    await registry.createServer({ organizationId: orgA, slug, name: 'One' });
    await expect(
      registry.createServer({ organizationId: orgA, slug, name: 'Two' }),
    ).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
  });

  it('allows the same slug in a different organization', async () => {
    const slug = uniq('shared');
    await registry.createServer({ organizationId: orgA, slug, name: 'A' });
    const other = await registry.createServer({ organizationId: orgB, slug, name: 'B' });
    expect(other.organizationId).toBe(orgB);
  });

  it('never returns another organization’s server', async () => {
    const created = await registry.createServer({
      organizationId: orgA,
      slug: uniq('private'),
      name: 'Private',
    });
    expect(await registry.findServerById(orgB, created.id)).toBeNull();
    await expect(registry.resolveServer(orgB, created.id)).rejects.toMatchObject({
      code: 'SERVER_NOT_FOUND',
    });
    const deleted = await registry.deleteServer(orgB, created.id);
    expect(deleted).toBe(false);
    expect(await registry.findServerById(orgA, created.id)).not.toBeNull();
  });

  it('stores discovered capabilities and enforces version immutability', async () => {
    const server = await registry.createServer({
      organizationId: orgA,
      slug: uniq('caps'),
      name: 'Caps',
    });
    const version = await registry.createVersion({
      organizationId: orgA,
      serverId: server.id,
      version: '1.0.0',
      transport: { kind: 'stdio', command: 'node', args: ['server.js'], envKeys: [] },
    });

    await registry.replaceCapabilities(orgA, version, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'caps', version: '1.0.0' },
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          riskClass: 'READ',
          riskReason: 'test',
        },
      ],
      resources: [{ uri: 'file:///README.md', name: 'readme' }],
      prompts: [{ name: 'summarize' }],
    });

    const tools = await registry.listTools(orgA, version.id);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('read_file');
    expect(await registry.listResources(orgA, version.id)).toHaveLength(1);
    expect(await registry.listPrompts(orgA, version.id)).toHaveLength(1);

    const published = await registry.publishVersion(orgA, version.id);
    expect(published.published).toBe(true);
    await expect(
      registry.replaceCapabilities(orgA, published, {
        protocolVersion: null,
        capabilities: null,
        serverInfo: null,
        tools: [],
        resources: [],
        prompts: [],
      }),
    ).rejects.toMatchObject({ code: 'VERSION_IMMUTABLE' });
  });

  it('paginates servers with a stable cursor', async () => {
    const localOrg = await identity.createOrganization({ name: 'Paging', slug: uniq('paging') });
    for (let i = 0; i < 7; i += 1) {
      await registry.createServer({
        organizationId: localOrg.id,
        slug: `page-${i}`,
        name: `Page ${i}`,
      });
    }
    const first = await registry.listServers(localOrg.id, {}, { limit: 3 });
    expect(first.data).toHaveLength(3);
    expect(first.total).toBe(7);
    expect(first.nextCursor).not.toBeNull();

    const second = await registry.listServers(
      localOrg.id,
      {},
      { limit: 3, cursor: first.nextCursor ?? undefined },
    );
    expect(second.data).toHaveLength(3);
    const ids = new Set([...first.data, ...second.data].map((s) => s.id));
    expect(ids.size).toBe(6);
  });
});

describe('governance repository', () => {
  it('records validation runs with findings', async () => {
    const server = await registry.createServer({
      organizationId: orgA,
      slug: uniq('val'),
      name: 'Val',
    });
    const run = await governance.recordValidationRun({
      organizationId: orgA,
      serverId: server.id,
      versionId: null,
      outcome: 'warning',
      durationMs: 12,
      triggeredBy: user,
      findings: [
        {
          id: 'vfnd_1',
          severity: 'warning',
          rule: 'tool.schema.missing-description',
          location: 'tools[0]',
          message: 'No description',
          suggestion: 'Add one',
        },
      ],
    });
    expect(run.warningCount).toBe(1);
    const fetched = await governance.findValidationRun(orgA, run.id);
    expect(fetched?.findings).toHaveLength(1);
    expect(await governance.findValidationRun(orgB, run.id)).toBeNull();
  });

  it('deduplicates open incidents per server and kind', async () => {
    const server = await registry.createServer({
      organizationId: orgA,
      slug: uniq('inc'),
      name: 'Inc',
    });
    const first = await governance.openIncident({
      organizationId: orgA,
      serverId: server.id,
      kind: 'repeated_failures',
      title: 'Failures',
      evidence: [
        { label: 'failures', value: '5', source: 'health_checks', observedAt: new Date() },
      ],
    });
    const second = await governance.openIncident({
      organizationId: orgA,
      serverId: server.id,
      kind: 'repeated_failures',
      title: 'Failures (updated)',
      evidence: [
        { label: 'failures', value: '9', source: 'health_checks', observedAt: new Date() },
      ],
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Failures (updated)');
    expect(await governance.countOpenIncidents(orgA)).toBeGreaterThan(0);

    await governance.resolveIncident(orgA, first.id);
    const reopened = await governance.openIncident({
      organizationId: orgA,
      serverId: server.id,
      kind: 'repeated_failures',
      title: 'Failures again',
      evidence: [],
    });
    expect(reopened.id).not.toBe(first.id);
  });

  it('computes a health summary from stored checks', async () => {
    const server = await registry.createServer({
      organizationId: orgA,
      slug: uniq('health'),
      name: 'Health',
    });
    for (const [status, latency] of [
      ['healthy', 100],
      ['healthy', 200],
      ['failing', 5000],
    ] as const) {
      await governance.recordHealthCheck({
        organizationId: orgA,
        serverId: server.id,
        versionId: null,
        status,
        latencyMs: latency,
        toolCount: 3,
        initialized: status === 'healthy',
        timedOut: false,
        errorCode: null,
        errorMessage: null,
      });
    }
    const summary = await governance.healthSummary(
      orgA,
      server.id,
      new Date(Date.now() - 60_000),
    );
    expect(summary.checks).toBe(3);
    expect(summary.uptimePercent).toBeCloseTo(66.67, 1);
    expect(summary.p95LatencyMs).toBeGreaterThan(0);
  });
});

describe('analytics repository', () => {
  it('aggregates invocations into a time series', async () => {
    const server = await registry.createServer({
      organizationId: orgA,
      slug: uniq('metrics'),
      name: 'Metrics',
    });
    const version = await registry.createVersion({
      organizationId: orgA,
      serverId: server.id,
      version: '1.0.0',
      transport: { kind: 'stdio', command: 'node', args: [], envKeys: [] },
    });
    for (const status of ['success', 'success', 'error'] as const) {
      await governance.recordInvocation({
        organizationId: orgA,
        serverId: server.id,
        versionId: version.id,
        environmentId: null,
        toolName: 'do_thing',
        riskClass: 'READ',
        status,
        durationMs: status === 'success' ? 120 : 900,
        errorCode: status === 'error' ? 'UPSTREAM_ERROR' : null,
        errorMessage: null,
        requestBytes: 10,
        responseBytes: 20,
        approvalId: null,
        actorUserId: user,
        actorApiKeyId: null,
        requestId: 'req_test',
      });
    }
    const window = {
      from: new Date(Date.now() - 3_600_000),
      to: new Date(Date.now() + 1000),
      bucketSeconds: 300,
    };
    const totals = await analytics.invocationTotals(orgA, window);
    expect(totals.total).toBe(3);
    expect(totals.succeeded).toBe(2);
    expect(totals.failed).toBe(1);

    const series = await analytics.invocationSeries(orgA, window);
    expect(series['total']?.length).toBeGreaterThan(0);

    const top = await analytics.topTools(orgA, window, 5);
    expect(top[0]?.toolName).toBe('do_thing');
    expect(top[0]?.errorRate).toBeCloseTo(33.33, 1);

    // Another tenant sees none of it.
    expect((await analytics.invocationTotals(orgB, window)).total).toBe(0);
  });
});

describe('search repository', () => {
  it('finds documents by exact, prefix and full-text match', async () => {
    const server = await registry.createServer({
      organizationId: orgA,
      slug: uniq('searchable'),
      name: 'Postgres Server',
    });
    await search.upsert({
      organizationId: orgA,
      docType: 'server',
      entityId: server.id,
      serverId: server.id,
      versionId: null,
      visibility: 'organization',
      title: 'Postgres Server',
      subtitle: 'database access',
      body: 'Query and inspect PostgreSQL databases over MCP',
      tags: ['database', 'sql'],
      riskClass: null,
    });

    const exact = await search.search({
      organizationId: orgA,
      query: 'Postgres Server',
      includePublic: false,
      limit: 10,
      offset: 0,
      trigram: db.capabilities.trigram,
    });
    expect(exact.hits[0]?.matchKind).toBe('exact');

    const fulltext = await search.search({
      organizationId: orgA,
      query: 'inspect databases',
      includePublic: false,
      limit: 10,
      offset: 0,
      trigram: db.capabilities.trigram,
    });
    expect(fulltext.hits.length).toBeGreaterThan(0);

    const other = await search.search({
      organizationId: orgB,
      query: 'Postgres',
      includePublic: false,
      limit: 10,
      offset: 0,
      trigram: db.capabilities.trigram,
    });
    expect(other.hits).toHaveLength(0);
  });
});

describe('job queue', () => {
  it('claims jobs exactly once across workers', async () => {
    await jobs.enqueue({ kind: 'health.check', payload: { serverId: 'srv_x' } });
    await jobs.enqueue({ kind: 'health.check', payload: { serverId: 'srv_y' } });

    const workerA = await jobs.claim('worker-a', 10, 30_000);
    const workerB = await jobs.claim('worker-b', 10, 30_000);
    expect(workerA.length).toBeGreaterThanOrEqual(2);
    expect(workerB).toHaveLength(0);

    const job = workerA[0];
    if (!job) throw new Error('expected a claimed job');
    await jobs.complete(job.id, { ok: true });
    const stats = await jobs.stats();
    expect(stats.succeeded).toBeGreaterThanOrEqual(1);
  });

  it('honours the dedupe key', async () => {
    const first = await jobs.enqueue({ kind: 'index.rebuild', dedupeKey: 'index:orgA' });
    const second = await jobs.enqueue({ kind: 'index.rebuild', dedupeKey: 'index:orgA' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
