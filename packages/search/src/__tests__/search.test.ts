import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Id, McpServerRecord, ToolRecord } from '@mcp-hub/core';
import { SearchRepository, createTestDatabase, toTsQuery, type SqlDriver } from '@mcp-hub/database';
import { PostgresSearchProvider, snippetAround } from '../postgres.js';
import { promptDocument, resourceDocument, serverDocument, toolDocument } from '../documents.js';

const ORG = 'org_search' as Id<'organization'>;
const SERVER_ID = 'srv_search' as Id<'server'>;

const server = {
  id: SERVER_ID,
  organizationId: ORG,
  slug: 'postgres-mcp',
  name: 'Postgres MCP',
  description: 'Query and inspect PostgreSQL databases over MCP.',
  category: 'Data',
  tags: ['database', 'sql'],
  repositoryUrl: null,
  documentationUrl: null,
  homepageUrl: null,
  license: 'MIT',
  maintainer: 'Someone',
  visibility: 'organization',
  status: 'active',
  latestVersionId: null,
  healthStatus: 'healthy',
  healthCheckedAt: null,
  healthIntervalSeconds: null,
  isDemo: false,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as McpServerRecord;

const tool = {
  id: 'tool_1' as Id<'tool'>,
  organizationId: ORG,
  serverId: SERVER_ID,
  versionId: 'ver_1' as Id<'version'>,
  name: 'run_query',
  title: null,
  description: 'Runs a read-only SQL statement against the warehouse.',
  inputSchema: {
    type: 'object',
    properties: { sql: { type: 'string' }, limit: { type: 'number' } },
  },
  outputSchema: null,
  annotations: null,
  riskClass: 'READ',
  riskReason: 'test',
  riskOverride: null,
  riskOverrideBy: null,
  riskOverrideReason: null,
  riskOverrideAt: null,
  createdAt: new Date(),
} as ToolRecord;

describe('tsquery construction', () => {
  it('makes the last term a prefix so search-as-you-type works', () => {
    expect(toTsQuery('postgres data')).toBe('postgres & data:*');
  });

  it('never lets user input reach the query language', () => {
    for (const input of ['a & b | c', "x' OR 1=1 --", '!!!', 'a:*:*']) {
      const query = toTsQuery(input);
      expect(query).not.toMatch(/[|!'"()]/);
    }
  });

  it('returns an empty query for input with no terms', () => {
    expect(toTsQuery('   ')).toBe('');
    expect(toTsQuery('!!!')).toBe('');
  });

  it('caps the number of terms', () => {
    const query = toTsQuery(Array.from({ length: 30 }, (_, i) => `term${i}`).join(' '));
    expect(query.split('&').length).toBeLessThanOrEqual(8);
  });
});

describe('document projection', () => {
  it('indexes a server on the fields people search by', () => {
    const document = serverDocument(server);
    expect(document.title).toBe('Postgres MCP');
    expect(document.body).toContain('PostgreSQL');
    expect(document.body).toContain('postgres-mcp');
    expect(document.tags).toEqual(['database', 'sql']);
  });

  it('indexes a tool with its schema property names', () => {
    const document = toolDocument(tool, server);
    expect(document.title).toBe('run_query');
    // Indexing property names is what makes "sql limit" find this tool.
    expect(document.body).toContain('sql');
    expect(document.body).toContain('limit');
    expect(document.riskClass).toBe('READ');
  });

  it('carries an administrator override into the index', () => {
    const document = toolDocument({ ...tool, riskOverride: 'DESTRUCTIVE' }, server);
    expect(document.riskClass).toBe('DESTRUCTIVE');
  });

  it('inherits the server visibility so scoping is consistent', () => {
    const doc = toolDocument(tool, { ...server, visibility: 'public' });
    expect(doc.visibility).toBe('public');
  });

  it('projects resources and prompts', () => {
    const resource = resourceDocument(
      {
        id: 'res_1' as Id<'resource'>,
        organizationId: ORG,
        serverId: SERVER_ID,
        versionId: 'ver_1' as Id<'version'>,
        uri: 'pg://tables',
        name: 'Tables',
        description: 'Every table',
        mimeType: 'application/json',
        isTemplate: false,
        createdAt: new Date(),
      },
      server,
    );
    expect(resource.title).toBe('Tables');
    expect(resource.body).toContain('pg://tables');

    const prompt = promptDocument(
      {
        id: 'prm_1' as Id<'prompt'>,
        organizationId: ORG,
        serverId: SERVER_ID,
        versionId: 'ver_1' as Id<'version'>,
        name: 'explain_plan',
        description: 'Explains a query plan',
        arguments: [{ name: 'sql' }],
        createdAt: new Date(),
      },
      server,
    );
    expect(prompt.title).toBe('explain_plan');
    expect(prompt.body).toContain('sql');
  });
});

describe('snippets', () => {
  it('centres on the first meaningful term', () => {
    const body = `${'padding '.repeat(20)}needle ${'trailing '.repeat(20)}`;
    const snippet = snippetAround(body, 'needle');
    expect(snippet).toContain('needle');
    expect(snippet.length).toBeLessThan(200);
  });

  it('falls back to the start when the term is absent', () => {
    expect(snippetAround('some text here', 'zzz')).toContain('some text');
  });

  it('handles an empty body', () => {
    expect(snippetAround('', 'x')).toBe('');
  });
});

describe('the PostgreSQL provider', () => {
  let db: SqlDriver;
  let provider: PostgresSearchProvider;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.query(
      `insert into organizations (id, slug, name) values ($1, 'search-org', 'Search Org')`,
      [ORG],
    );
    await db.query(
      `insert into servers (id, organization_id, slug, name, visibility, status)
       values ($1, $2, 'postgres-mcp', 'Postgres MCP', 'organization', 'active')`,
      [SERVER_ID, ORG],
    );
    // search_documents.version_id is a real foreign key, so the version must exist.
    await db.query(
      `insert into server_versions (id, organization_id, server_id, version, transport)
       values ('ver_1', $1, $2, '1.0.0', '{"kind":"stdio","command":"node","args":[],"envKeys":[]}'::jsonb)`,
      [ORG, SERVER_ID],
    );

    provider = new PostgresSearchProvider(new SearchRepository(db), db.capabilities);
    await provider.index([serverDocument(server), toolDocument(tool, server)]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('reports which strategy matched', () => {
    expect(provider.name).toBe('postgres');
  });

  it('ranks an exact title match first', async () => {
    const page = await provider.searchAll({ organizationId: ORG, text: 'Postgres MCP' });
    expect(page.data[0]?.matchKind).toBe('exact');
    expect(page.data[0]?.title).toBe('Postgres MCP');
  });

  it('matches a title prefix', async () => {
    const page = await provider.searchAll({ organizationId: ORG, text: 'run_qu' });
    expect(page.data[0]?.title).toBe('run_query');
    expect(['prefix', 'fulltext', 'fuzzy']).toContain(page.data[0]?.matchKind);
  });

  it('finds a tool through its description', async () => {
    const page = await provider.searchTools({ organizationId: ORG, text: 'warehouse' });
    expect(page.data.map((hit) => hit.title)).toContain('run_query');
  });

  it('finds a tool through its schema property names', async () => {
    const page = await provider.searchTools({ organizationId: ORG, text: 'limit' });
    expect(page.data.map((hit) => hit.title)).toContain('run_query');
  });

  it('filters by document type', async () => {
    const page = await provider.searchServers({ organizationId: ORG, text: 'postgres' });
    expect(page.data.every((hit) => hit.type === 'server')).toBe(true);
  });

  it('returns nothing for an empty query rather than everything', async () => {
    const page = await provider.searchAll({ organizationId: ORG, text: '   ' });
    expect(page.data).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('suggests completions from indexed titles', async () => {
    const suggestions = await provider.suggest(ORG, 'run');
    expect(suggestions).toContain('run_query');
  });

  it('removes documents when a server goes away', async () => {
    await provider.removeServer(SERVER_ID);
    const page = await provider.searchAll({ organizationId: ORG, text: 'postgres' });
    expect(page.data).toEqual([]);
  });
});
