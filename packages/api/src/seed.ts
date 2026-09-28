import { resolve } from 'node:path';
import { type Id, type JsonSchema, type OrgRole, type RiskClass, newId } from '@mcp-hub/core';
import { deriveHealthStatus } from '@mcp-hub/analytics';
import { classifyTool } from '@mcp-hub/security';
import type { AppContext } from './context.js';
import { reindexServer } from './services/indexing.js';

/**
 * Seeds a working demo environment.
 *
 * Two kinds of server are created and they are never mixed up:
 *
 *  - **Demo servers** (`is_demo = true`) are fictional. They exist so the
 *    dashboard, analytics and incident views have something to render. Every
 *    row generated for them is tagged `demo: true` in its metadata and the UI
 *    labels them DEMO DATA. They are excluded from health-check scheduling so
 *    the worker never tries to dial a server that does not exist.
 *
 *  - **Local example servers** are real: they point at the MCP servers in
 *    `examples/`, so discovery, compatibility testing and the playground can
 *    be exercised against live protocol traffic on a laptop.
 */
export interface SeedResult {
  organizationId: Id<'organization'>;
  users: Array<{ email: string; role: OrgRole }>;
  demoServers: number;
  localServers: number;
  events: number;
}

const DEMO_USERS: Array<{ email: string; name: string; role: OrgRole }> = [
  { email: 'owner@example.com', name: 'Ada Okafor', role: 'owner' },
  { email: 'admin@example.com', name: 'Rafael Mendes', role: 'admin' },
  { email: 'dev@example.com', name: 'Priya Raman', role: 'developer' },
  { email: 'viewer@example.com', name: 'Jonas Weber', role: 'viewer' },
];

interface DemoTool {
  name: string;
  description: string;
  schema: JsonSchema;
}

interface DemoServer {
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  repositoryUrl: string;
  license: string;
  maintainer: string;
  versions: Array<{
    version: string;
    tools: DemoTool[];
    published: boolean;
    recommended?: boolean;
  }>;
  health: 'healthy' | 'degraded' | 'failing';
}

function obj(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}
const str = (description: string): JsonSchema => ({ type: 'string', description });
const num = (description: string): JsonSchema => ({ type: 'number', description });
const bool = (description: string): JsonSchema => ({ type: 'boolean', description });

const DEMO_SERVERS: DemoServer[] = [
  {
    slug: 'demo-source-control',
    name: 'DEMO Source Control',
    description:
      'Fictional source-control MCP server used to populate the demo dashboard. It does not exist and cannot be connected to.',
    category: 'Developer tools',
    tags: ['git', 'code-review', 'demo'],
    repositoryUrl: 'https://example.com/demo/source-control',
    license: 'MIT',
    maintainer: 'MCP Hub demo data',
    health: 'healthy',
    versions: [
      {
        version: '1.3.0',
        published: true,
        tools: [
          {
            name: 'search_code',
            description: 'Searches the codebase for a string.',
            schema: obj({ query: str('Text to search for'), path: str('Restrict to a subtree') }, [
              'query',
            ]),
          },
          {
            name: 'get_file',
            description: 'Reads a file at a revision.',
            schema: obj({ path: str('Repository path'), ref: str('Git ref') }, ['path']),
          },
          {
            name: 'create_pull_request',
            description: 'Opens a pull request.',
            schema: obj(
              { title: str('PR title'), head: str('Source branch'), base: str('Target branch') },
              ['title', 'head', 'base'],
            ),
          },
          {
            name: 'delete_branch',
            description: 'Permanently deletes a branch. This cannot be undone.',
            schema: obj({ branch: str('Branch to delete') }, ['branch']),
          },
        ],
      },
      {
        version: '1.4.0',
        published: true,
        recommended: true,
        tools: [
          {
            name: 'search_code',
            description: 'Searches the codebase for a string or regular expression.',
            schema: obj(
              {
                query: str('Text or pattern to search for'),
                path: str('Restrict to a subtree'),
                regex: bool('Treat the query as a regular expression'),
              },
              ['query'],
            ),
          },
          {
            name: 'get_file',
            description: 'Reads a file at a revision.',
            schema: obj({ path: str('Repository path'), ref: str('Git ref') }, ['path']),
          },
          {
            name: 'create_pull_request',
            description: 'Opens a pull request.',
            schema: obj(
              {
                title: str('PR title'),
                head: str('Source branch'),
                base: str('Target branch'),
                draft: bool('Open as a draft'),
              },
              ['title', 'head', 'base'],
            ),
          },
          {
            name: 'delete_branch',
            description: 'Permanently deletes a branch. This cannot be undone.',
            schema: obj(
              { branch: str('Branch to delete'), force: bool('Delete even when unmerged') },
              ['branch', 'force'],
            ),
          },
          {
            name: 'list_reviewers',
            description: 'Lists suggested reviewers for a pull request.',
            schema: obj({ pull_request: num('Pull request number') }, ['pull_request']),
          },
        ],
      },
    ],
  },
  {
    slug: 'demo-warehouse',
    name: 'DEMO Warehouse',
    description:
      'Fictional analytical database MCP server used to populate the demo dashboard. It does not exist and cannot be connected to.',
    category: 'Data',
    tags: ['database', 'sql', 'analytics', 'demo'],
    repositoryUrl: 'https://example.com/demo/warehouse',
    license: 'Apache-2.0',
    maintainer: 'MCP Hub demo data',
    health: 'degraded',
    versions: [
      {
        version: '2.1.4',
        published: true,
        recommended: true,
        tools: [
          {
            name: 'run_query',
            description: 'Runs a read-only SQL query against the warehouse.',
            schema: obj(
              { sql: str('SQL SELECT statement'), limit: num('Maximum rows to return') },
              ['sql'],
            ),
          },
          {
            name: 'describe_table',
            description: 'Returns the schema of a table.',
            schema: obj({ table: str('Fully-qualified table name') }, ['table']),
          },
          {
            name: 'list_tables',
            description: 'Lists tables in a schema.',
            schema: obj({ schema: str('Schema name') }),
          },
          {
            name: 'drop_table',
            description: 'Drops a table permanently. Irreversible.',
            schema: obj(
              {
                table: str('Fully-qualified table name'),
                cascade: bool('Drop dependent objects too'),
              },
              ['table'],
            ),
          },
          {
            name: 'rotate_credentials',
            description: 'Rotates the warehouse access key.',
            schema: obj({ api_key: str('Current access key') }, ['api_key']),
          },
        ],
      },
    ],
  },
  {
    slug: 'demo-web-fetch',
    name: 'DEMO Web Fetch',
    description:
      'Fictional web-retrieval MCP server used to populate the demo dashboard. It does not exist and cannot be connected to.',
    category: 'Web',
    tags: ['http', 'scraping', 'demo'],
    repositoryUrl: 'https://example.com/demo/web-fetch',
    license: 'MIT',
    maintainer: 'MCP Hub demo data',
    health: 'failing',
    versions: [
      {
        version: '0.9.2',
        published: true,
        recommended: true,
        tools: [
          {
            name: 'fetch_url',
            description: 'Performs an HTTP GET against an arbitrary URL and returns the body.',
            schema: obj({ url: str('Absolute URL to fetch'), timeout_ms: num('Request timeout') }, [
              'url',
            ]),
          },
          {
            name: 'extract_text',
            description: 'Extracts readable text from HTML.',
            schema: obj({ html: str('HTML document') }, ['html']),
          },
          {
            name: 'post_webhook',
            description: 'Sends a JSON payload to a webhook endpoint.',
            schema: obj(
              {
                url: str('Webhook endpoint'),
                payload: { type: 'object', description: 'JSON body' },
              },
              ['url', 'payload'],
            ),
          },
        ],
      },
    ],
  },
];

export async function seed(context: AppContext): Promise<SeedResult> {
  const { identity, registry, governance, analytics } = context.repositories;

  const organization =
    (await identity.findOrganizationBySlug('acme-robotics')) ??
    (await identity.createOrganization({ name: 'Acme Robotics', slug: 'acme-robotics' }));

  const users: Array<{ email: string; role: OrgRole }> = [];
  for (const demoUser of DEMO_USERS) {
    const user = await identity.upsertUser({
      externalId: `dev|${demoUser.email}`,
      email: demoUser.email,
      name: demoUser.name,
    });
    await identity.addMember(organization.id, user.id, demoUser.role);
    users.push({ email: demoUser.email, role: demoUser.role });
  }
  const owner = await identity.findUserByEmail('owner@example.com');
  const admin = await identity.findUserByEmail('admin@example.com');

  let events = 0;
  let demoServers = 0;

  for (const spec of DEMO_SERVERS) {
    const existing = await registry.findServerBySlug(organization.id, spec.slug);
    if (existing) {
      demoServers += 1;
      continue;
    }
    const server = await registry.createServer({
      organizationId: organization.id,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      category: spec.category,
      tags: spec.tags,
      repositoryUrl: spec.repositoryUrl,
      documentationUrl: `${spec.repositoryUrl}#readme`,
      license: spec.license,
      maintainer: spec.maintainer,
      visibility: 'organization',
      status: 'active',
      // Demo servers are never health-checked: there is nothing to dial.
      healthIntervalSeconds: null,
      isDemo: true,
      createdBy: owner?.id ?? null,
    });
    demoServers += 1;

    let recommendedVersionId: Id<'version'> | null = null;
    for (const versionSpec of spec.versions) {
      const version = await registry.createVersion({
        organizationId: organization.id,
        serverId: server.id,
        version: versionSpec.version,
        transport: {
          kind: 'streamable-http',
          url: `https://demo.invalid/${spec.slug}/mcp`,
          headerKeys: ['Authorization'],
        },
        environment: [
          {
            key: 'Authorization',
            description: 'Bearer token for the demo endpoint',
            required: true,
            secret: true,
          },
        ],
        supportedPlatforms: ['linux', 'darwin', 'win32'],
        releaseNotes: `DEMO DATA — fictional release notes for ${versionSpec.version}.`,
        published: false,
        createdBy: owner?.id ?? null,
      });

      await registry.replaceCapabilities(organization.id, version, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: spec.slug, version: versionSpec.version },
        tools: versionSpec.tools.map((tool) => {
          const assessment = classifyTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.schema,
          });
          return {
            name: tool.name,
            title: null,
            description: tool.description,
            inputSchema: tool.schema,
            outputSchema: null,
            annotations: null,
            riskClass: assessment.riskClass as RiskClass,
            riskReason: assessment.reason,
          };
        }),
        resources: [
          {
            uri: `${spec.slug}://index`,
            name: 'Index',
            description: 'DEMO DATA resource',
            mimeType: 'application/json',
            isTemplate: false,
          },
        ],
        prompts: [],
      });

      if (versionSpec.published) await registry.publishVersion(organization.id, version.id);
      if (versionSpec.recommended) {
        await registry.setVersionFlags(organization.id, version.id, { recommended: true });
        recommendedVersionId = version.id;
      }
    }

    if (recommendedVersionId) {
      await registry.setLatestVersion(organization.id, server.id, recommendedVersionId);
      events += await seedTelemetry(context, {
        organizationId: organization.id,
        serverId: server.id,
        versionId: recommendedVersionId,
        health: spec.health,
        actorUserId: admin?.id ?? null,
      });
    }

    await reindexServer(context, organization.id, server.id);
  }

  // --- real, locally runnable servers --------------------------------------
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const localSpecs = [
    {
      slug: 'local-notes-server',
      name: 'Notes (local example)',
      description:
        'The example MCP server in examples/notes-server. Run `pnpm build` once, then use Discover to read its real capability surface.',
      entry: resolve(repoRoot, 'examples/notes-server/dist/index.js'),
      tags: ['example', 'local', 'notes'],
    },
    {
      slug: 'local-flaky-server',
      name: 'Flaky (local example)',
      description:
        'The deliberately unreliable server in examples/flaky-server. Use it to see health monitoring and incident detection react to real failures.',
      entry: resolve(repoRoot, 'examples/flaky-server/dist/index.js'),
      tags: ['example', 'local', 'testing'],
    },
  ];

  let localServers = 0;
  for (const spec of localSpecs) {
    if (await registry.findServerBySlug(organization.id, spec.slug)) {
      localServers += 1;
      continue;
    }
    const server = await registry.createServer({
      organizationId: organization.id,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      category: 'Examples',
      tags: spec.tags,
      repositoryUrl: 'https://github.com/itsshreyasbhardwaj-design/mcp-hub',
      license: 'MIT',
      maintainer: 'MCP Hub',
      visibility: 'organization',
      status: 'active',
      healthIntervalSeconds: 900,
      isDemo: false,
      createdBy: owner?.id ?? null,
    });
    const version = await registry.createVersion({
      organizationId: organization.id,
      serverId: server.id,
      version: '1.0.0',
      transport: { kind: 'stdio', command: 'node', args: [spec.entry], envKeys: [] },
      environment: [],
      supportedPlatforms: ['linux', 'darwin', 'win32'],
      releaseNotes: 'Local example server. Run Discover to populate its tools.',
      createdBy: owner?.id ?? null,
    });
    await registry.setLatestVersion(organization.id, server.id, version.id);
    await reindexServer(context, organization.id, server.id);
    localServers += 1;
  }

  // --- a starting permission posture ---------------------------------------
  const existingRules = await governance.listPermissionRules(organization.id);
  if (existingRules.length === 0 && admin) {
    await governance.createPermissionRule({
      organizationId: organization.id,
      effect: 'deny',
      subjectUserId: null,
      subjectRole: 'viewer',
      serverId: null,
      versionId: null,
      toolName: null,
      riskClass: null,
      environmentId: null,
      priority: 100,
      description: 'Viewers may not execute tools.',
      createdBy: admin.id,
    });
    await governance.createPermissionRule({
      organizationId: organization.id,
      effect: 'require_approval',
      subjectUserId: null,
      subjectRole: null,
      serverId: null,
      versionId: null,
      toolName: null,
      riskClass: 'DESTRUCTIVE',
      environmentId: null,
      priority: 50,
      description: 'Destructive tools always require a second person to approve.',
      createdBy: admin.id,
    });
    await governance.createPermissionRule({
      organizationId: organization.id,
      effect: 'allow',
      subjectUserId: null,
      subjectRole: 'developer',
      serverId: null,
      versionId: null,
      toolName: null,
      riskClass: 'READ',
      environmentId: null,
      priority: 10,
      description: 'Developers may run read-only tools without approval.',
      createdBy: admin.id,
    });
  }

  void analytics;
  return {
    organizationId: organization.id,
    users,
    demoServers,
    localServers,
    events,
  };
}

/**
 * Generates the health checks and invocations behind the demo charts.
 *
 * These are real rows in the real tables — the dashboard does not have a
 * separate "demo mode" code path — but every one of them is attached to a
 * server flagged `is_demo` and tagged `demo: true`, so nothing fictional can
 * be mistaken for production telemetry.
 */
async function seedTelemetry(
  context: AppContext,
  input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    versionId: Id<'version'>;
    health: 'healthy' | 'degraded' | 'failing';
    actorUserId: Id<'user'> | null;
  },
): Promise<number> {
  const { governance, analytics, registry } = context.repositories;
  const tools = await registry.listTools(input.organizationId, input.versionId);
  const now = Date.now();
  let events = 0;

  // Deterministic pseudo-randomness keeps the demo stable across reseeds.
  let state = 42;
  const rand = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };

  const profile = {
    healthy: { failRate: 0.02, baseLatency: 180, spread: 60 },
    degraded: { failRate: 0.12, baseLatency: 900, spread: 500 },
    failing: { failRate: 0.55, baseLatency: 2600, spread: 1500 },
  }[input.health];

  for (let i = 47; i >= 0; i -= 1) {
    const checkedAt = new Date(now - i * 30 * 60 * 1000);
    // The newest check is fixed to the profile so the rolled-up status the
    // dashboard shows agrees with the story this demo server is telling.
    // Everything older is generated, so the history still looks lived-in.
    const isNewest = i === 0;
    const failed = isNewest ? input.health === 'failing' : rand() < profile.failRate;
    const latency =
      isNewest && input.health === 'degraded'
        ? 6000
        : Math.round(profile.baseLatency + rand() * profile.spread);
    await governance.recordHealthCheck({
      organizationId: input.organizationId,
      serverId: input.serverId,
      versionId: input.versionId,
      status: failed ? 'failing' : latency > 5000 ? 'degraded' : 'healthy',
      latencyMs: latency,
      toolCount: tools.length,
      initialized: !failed,
      timedOut: failed && rand() < 0.4,
      errorCode: failed ? 'UPSTREAM_ERROR' : null,
      errorMessage: failed ? 'DEMO DATA — synthetic failure for the demo dashboard.' : null,
      checkedAt,
    });
    await analytics.record({
      organizationId: input.organizationId,
      type: 'health.checked',
      serverId: input.serverId,
      versionId: input.versionId,
      value: latency,
      status: failed ? 'failing' : 'healthy',
      metadata: { demo: true },
      occurredAt: checkedAt,
    });
    events += 1;
  }

  for (let i = 0; i < 220; i += 1) {
    const tool = tools[Math.floor(rand() * tools.length)];
    if (!tool) continue;
    const occurredAt = new Date(now - Math.floor(rand() * 7 * 24 * 60 * 60 * 1000));
    const failed = rand() < profile.failRate;
    const duration = Math.round(profile.baseLatency * (0.4 + rand() * 1.6));
    const status = failed ? (rand() < 0.3 ? 'timeout' : 'error') : 'success';

    await governance.recordInvocation({
      organizationId: input.organizationId,
      serverId: input.serverId,
      versionId: input.versionId,
      environmentId: null,
      toolName: tool.name,
      riskClass: tool.riskOverride ?? tool.riskClass,
      status,
      durationMs: duration,
      errorCode: failed ? 'UPSTREAM_ERROR' : null,
      errorMessage: failed ? 'DEMO DATA — synthetic error.' : null,
      requestBytes: 120 + Math.floor(rand() * 400),
      responseBytes: failed ? 0 : 200 + Math.floor(rand() * 4000),
      approvalId: null,
      actorUserId: input.actorUserId,
      actorApiKeyId: null,
      requestId: `req_demo_${newId('request').slice(4, 16)}`,
    });
    await analytics.record({
      organizationId: input.organizationId,
      type: 'tool.invoked',
      serverId: input.serverId,
      versionId: input.versionId,
      toolName: tool.name,
      value: duration,
      status,
      metadata: { demo: true },
      occurredAt,
    });
    events += 1;
  }

  // Patch the invocation timestamps so the series spreads across the window
  // instead of collapsing onto the seeding moment.
  await context.db.query(
    `update tool_invocations
        set created_at = now() - (random() * interval '7 days')
      where organization_id = $1 and server_id = $2`,
    [input.organizationId, input.serverId],
  );

  // Roll the generated checks up onto the server, the same way a real health
  // check does. Without this the demo would show servers as never-checked
  // while their own charts were full of checks.
  const recent = await governance.listHealthChecks(input.organizationId, input.serverId, {
    limit: 30,
  });
  const latest = recent[0];
  if (latest) {
    await registry.setHealthStatus(
      input.organizationId,
      input.serverId,
      deriveHealthStatus(recent),
      latest.checkedAt,
    );
  }

  if (input.health === 'failing') {
    await governance.openIncident({
      organizationId: input.organizationId,
      serverId: input.serverId,
      kind: 'repeated_failures',
      title: 'DEMO DATA — repeated health-check failures',
      evidence: [
        {
          label: 'Failed checks in the last 24h',
          value: '18',
          source: 'health_checks',
          observedAt: new Date(),
        },
        {
          label: 'Most recent error',
          value: 'UPSTREAM_ERROR',
          source: 'health_checks',
          observedAt: new Date(),
        },
      ],
    });
  }

  return events;
}
