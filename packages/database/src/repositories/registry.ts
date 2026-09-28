import {
  type EnvironmentRecord,
  type EnvironmentRequirement,
  type HealthStatus,
  type Id,
  type JsonSchema,
  type McpServerRecord,
  type Page,
  type PageRequest,
  type PromptRecord,
  type ResourceRecord,
  type RiskClass,
  type ServerDetail,
  type ServerStatus,
  type ServerVersionRecord,
  type ToolRecord,
  type TransportConfig,
  type Visibility,
  HubError,
  decodeCursor,
  encodeCursor,
  fingerprint,
  newId,
} from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';
import { isUniqueViolation } from '../driver.js';
import { Params, WhereBuilder } from '../sqlutil.js';
import { toEnvironment, toPrompt, toResource, toServer, toTool, toVersion } from '../rows.js';

export interface CreateServerInput {
  organizationId: Id<'organization'>;
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  repositoryUrl?: string | null;
  documentationUrl?: string | null;
  homepageUrl?: string | null;
  license?: string | null;
  maintainer?: string | null;
  visibility?: Visibility;
  status?: ServerStatus;
  healthIntervalSeconds?: number | null;
  isDemo?: boolean;
  createdBy?: Id<'user'> | null;
}

export type UpdateServerInput = Partial<
  Omit<CreateServerInput, 'organizationId' | 'createdBy' | 'slug'>
>;

export interface ListServersFilter {
  status?: ServerStatus[];
  visibility?: Visibility[];
  healthStatus?: HealthStatus[];
  category?: string | null;
  tag?: string | null;
  query?: string | null;
  includeDemo?: boolean;
  sort?: 'updated' | 'created' | 'name';
}

export interface CreateVersionInput {
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  version: string;
  transport: TransportConfig;
  environment?: EnvironmentRequirement[];
  supportedPlatforms?: string[];
  releaseNotes?: string | null;
  published?: boolean;
  createdBy?: Id<'user'> | null;
}

export interface DiscoveredCapabilities {
  protocolVersion: string | null;
  capabilities: Record<string, unknown> | null;
  serverInfo: { name: string; version: string } | null;
  tools: Array<{
    name: string;
    title?: string | null;
    description?: string | null;
    inputSchema: JsonSchema;
    outputSchema?: JsonSchema | null;
    annotations?: Record<string, unknown> | null;
    riskClass: RiskClass;
    riskReason: string;
  }>;
  resources: Array<{
    uri: string;
    name?: string | null;
    description?: string | null;
    mimeType?: string | null;
    isTemplate?: boolean;
  }>;
  prompts: Array<{
    name: string;
    description?: string | null;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  }>;
}

/**
 * Registry persistence. Every method takes an `organizationId` and includes it
 * in the WHERE clause: tenant isolation is enforced in SQL, not by the caller
 * remembering to filter. `docs/security.md` records the reasoning.
 */
export class RegistryRepository {
  constructor(private readonly db: SqlExecutor) {}

  // --- Servers ------------------------------------------------------------

  async createServer(input: CreateServerInput): Promise<McpServerRecord> {
    try {
      const { rows } = await this.db.query(
        `insert into servers (
           id, organization_id, slug, name, description, category, tags,
           repository_url, documentation_url, homepage_url, license, maintainer,
           visibility, status, health_interval_seconds, is_demo, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         returning *`,
        [
          newId('server'),
          input.organizationId,
          input.slug,
          input.name,
          input.description ?? null,
          input.category ?? null,
          input.tags ?? [],
          input.repositoryUrl ?? null,
          input.documentationUrl ?? null,
          input.homepageUrl ?? null,
          input.license ?? null,
          input.maintainer ?? null,
          input.visibility ?? 'organization',
          input.status ?? 'draft',
          input.healthIntervalSeconds ?? null,
          input.isDemo ?? false,
          input.createdBy ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw HubError.internal('Failed to create server.');
      return toServer(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HubError('SLUG_TAKEN', `A server with slug "${input.slug}" already exists.`, {
          details: { slug: input.slug },
        });
      }
      throw err;
    }
  }

  async updateServer(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    patch: UpdateServerInput,
  ): Promise<McpServerRecord> {
    const columns: Record<keyof UpdateServerInput, string> = {
      name: 'name',
      description: 'description',
      category: 'category',
      tags: 'tags',
      repositoryUrl: 'repository_url',
      documentationUrl: 'documentation_url',
      homepageUrl: 'homepage_url',
      license: 'license',
      maintainer: 'maintainer',
      visibility: 'visibility',
      status: 'status',
      healthIntervalSeconds: 'health_interval_seconds',
      isDemo: 'is_demo',
    };
    const params = new Params();
    const sets: string[] = [];
    for (const [key, column] of Object.entries(columns) as Array<
      [keyof UpdateServerInput, string]
    >) {
      const value = patch[key];
      if (value === undefined) continue;
      sets.push(`${column} = ${params.add(value)}`);
    }
    if (sets.length === 0) {
      const existing = await this.findServerById(organizationId, serverId);
      if (!existing)
        throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');
      return existing;
    }
    sets.push('updated_at = now()');
    const orgParam = params.add(organizationId);
    const idParam = params.add(serverId);
    const { rows } = await this.db.query(
      `update servers set ${sets.join(', ')}
        where organization_id = ${orgParam} and id = ${idParam}
        returning *`,
      params.all,
    );
    const row = rows[0];
    if (!row) throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');
    return toServer(row);
  }

  async deleteServer(organizationId: Id<'organization'>, serverId: Id<'server'>): Promise<boolean> {
    const result = await this.db.query(
      'delete from servers where organization_id = $1 and id = $2',
      [organizationId, serverId],
    );
    return result.rowCount > 0;
  }

  async findServerById(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
  ): Promise<McpServerRecord | null> {
    const { rows } = await this.db.query(
      'select * from servers where organization_id = $1 and id = $2',
      [organizationId, serverId],
    );
    return rows[0] ? toServer(rows[0]) : null;
  }

  async findServerBySlug(
    organizationId: Id<'organization'>,
    slug: string,
  ): Promise<McpServerRecord | null> {
    const { rows } = await this.db.query(
      'select * from servers where organization_id = $1 and slug = $2',
      [organizationId, slug],
    );
    return rows[0] ? toServer(rows[0]) : null;
  }

  /**
   * Resolves a server by id **or** slug. Used by API routes so both
   * `/servers/srv_abc` and `/servers/github-mcp` work.
   */
  async resolveServer(
    organizationId: Id<'organization'>,
    idOrSlug: string,
  ): Promise<McpServerRecord> {
    const server = idOrSlug.startsWith('srv_')
      ? await this.findServerById(organizationId, idOrSlug as Id<'server'>)
      : await this.findServerBySlug(organizationId, idOrSlug);
    if (!server) {
      throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.', {
        details: { server: idOrSlug },
      });
    }
    return server;
  }

  async listServers(
    organizationId: Id<'organization'>,
    filter: ListServersFilter,
    page: PageRequest,
  ): Promise<Page<McpServerRecord>> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.in('status', filter.status);
    where.in('visibility', filter.visibility);
    where.in('health_status', filter.healthStatus);
    where.eq('category', filter.category ?? undefined);
    if (filter.tag) where.and(`${params.add(filter.tag)} = any(tags)`);
    if (filter.query) {
      const q = params.add(`%${filter.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.and(`(name ilike ${q} or slug ilike ${q} or coalesce(description, '') ilike ${q})`);
    }
    if (filter.includeDemo === false) where.and('is_demo = false');

    const sortColumn =
      filter.sort === 'created' ? 'created_at' : filter.sort === 'name' ? 'name' : 'updated_at';
    const direction = filter.sort === 'name' ? 'asc' : 'desc';

    if (page.cursor) {
      const { sortValue, id } = decodeCursor(page.cursor);
      const op = direction === 'asc' ? '>' : '<';
      const sv = params.add(sortColumn === 'name' ? sortValue : new Date(sortValue));
      const ci = params.add(id);
      where.and(`(${sortColumn}, id) ${op} (${sv}, ${ci})`);
    }

    const limitParam = params.add(page.limit + 1);
    const { rows } = await this.db.query(
      `select * from servers ${where.sql}
        order by ${sortColumn} ${direction}, id ${direction}
        limit ${limitParam}`,
      params.all,
    );

    const countParams = new Params();
    const countWhere = new WhereBuilder(countParams).eq('organization_id', organizationId);
    countWhere.in('status', filter.status);
    if (filter.includeDemo === false) countWhere.and('is_demo = false');
    const { rows: countRows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from servers ${countWhere.sql}`,
      countParams.all,
    );

    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit).map(toServer);
    const last = data[data.length - 1];
    return {
      data,
      nextCursor:
        hasMore && last
          ? encodeCursor(
              sortColumn === 'name'
                ? last.name
                : last[sortColumn === 'created_at' ? 'createdAt' : 'updatedAt'],
              last.id,
            )
          : null,
      total: countRows[0]?.count ?? data.length,
    };
  }

  async countServersByHealth(
    organizationId: Id<'organization'>,
  ): Promise<Record<HealthStatus, number>> {
    const { rows } = await this.db.query<{ health_status: HealthStatus; count: number }>(
      `select health_status, count(*)::int as count from servers
        where organization_id = $1 and status <> 'archived'
        group by health_status`,
      [organizationId],
    );
    const out: Record<HealthStatus, number> = { healthy: 0, degraded: 0, failing: 0, unknown: 0 };
    for (const row of rows) out[row.health_status] = row.count;
    return out;
  }

  async setHealthStatus(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    status: HealthStatus,
    checkedAt: Date,
  ): Promise<void> {
    await this.db.query(
      `update servers set health_status = $3, health_checked_at = $4, updated_at = now()
        where organization_id = $1 and id = $2`,
      [organizationId, serverId, status, checkedAt],
    );
  }

  /** Servers whose health interval has elapsed. Drives the monitoring worker. */
  async listServersDueForHealthCheck(limit: number, now = new Date()): Promise<McpServerRecord[]> {
    const { rows } = await this.db.query(
      `select * from servers
        where status = 'active'
          and is_demo = false
          and health_interval_seconds is not null
          and (
            health_checked_at is null
            or health_checked_at < $1::timestamptz - make_interval(secs => health_interval_seconds::double precision)
          )
        order by coalesce(health_checked_at, to_timestamp(0)) asc
        limit $2`,
      [now, limit],
    );
    return rows.map(toServer);
  }

  // --- Versions -----------------------------------------------------------

  async createVersion(input: CreateVersionInput): Promise<ServerVersionRecord> {
    try {
      const { rows } = await this.db.query(
        `insert into server_versions (
           id, organization_id, server_id, version, transport, environment,
           supported_platforms, release_notes, published, published_at, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning *`,
        [
          newId('version'),
          input.organizationId,
          input.serverId,
          input.version,
          JSON.stringify(input.transport),
          JSON.stringify(input.environment ?? []),
          input.supportedPlatforms ?? [],
          input.releaseNotes ?? null,
          input.published ?? false,
          input.published ? new Date() : null,
          input.createdBy ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw HubError.internal('Failed to create version.');
      return toVersion(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HubError(
          'CONFLICT',
          `Version "${input.version}" already exists for this server.`,
          {
            details: { version: input.version },
          },
        );
      }
      throw err;
    }
  }

  async findVersionById(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
  ): Promise<ServerVersionRecord | null> {
    const { rows } = await this.db.query(
      'select * from server_versions where organization_id = $1 and id = $2',
      [organizationId, versionId],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async findVersionByName(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    version: string,
  ): Promise<ServerVersionRecord | null> {
    const { rows } = await this.db.query(
      'select * from server_versions where organization_id = $1 and server_id = $2 and version = $3',
      [organizationId, serverId, version],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async listVersions(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
  ): Promise<ServerVersionRecord[]> {
    const { rows } = await this.db.query(
      `select * from server_versions where organization_id = $1 and server_id = $2
        order by created_at desc`,
      [organizationId, serverId],
    );
    return rows.map(toVersion);
  }

  /** The version the UI and the config generator default to. */
  async findPreferredVersion(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
  ): Promise<ServerVersionRecord | null> {
    const { rows } = await this.db.query(
      `select * from server_versions
        where organization_id = $1 and server_id = $2 and deprecated = false
        order by recommended desc, published desc, created_at desc
        limit 1`,
      [organizationId, serverId],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async publishVersion(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
  ): Promise<ServerVersionRecord> {
    const { rows } = await this.db.query(
      `update server_versions
          set published = true, published_at = coalesce(published_at, now())
        where organization_id = $1 and id = $2
        returning *`,
      [organizationId, versionId],
    );
    const row = rows[0];
    if (!row) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');
    return toVersion(row);
  }

  async setVersionFlags(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
    flags: { deprecated?: boolean; recommended?: boolean },
  ): Promise<ServerVersionRecord> {
    const version = await this.findVersionById(organizationId, versionId);
    if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');

    if (flags.recommended) {
      await this.db.query(
        'update server_versions set recommended = false where organization_id = $1 and server_id = $2',
        [organizationId, version.serverId],
      );
    }
    const { rows } = await this.db.query(
      `update server_versions
          set deprecated = coalesce($3, deprecated), recommended = coalesce($4, recommended)
        where organization_id = $1 and id = $2
        returning *`,
      [organizationId, versionId, flags.deprecated ?? null, flags.recommended ?? null],
    );
    const row = rows[0];
    if (!row) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');
    if (flags.recommended) {
      await this.db.query(
        'update servers set latest_version_id = $3, updated_at = now() where organization_id = $1 and id = $2',
        [organizationId, version.serverId, versionId],
      );
    }
    return toVersion(row);
  }

  async setLatestVersion(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    versionId: Id<'version'>,
  ): Promise<void> {
    await this.db.query(
      'update servers set latest_version_id = $3, updated_at = now() where organization_id = $1 and id = $2',
      [organizationId, serverId, versionId],
    );
  }

  async deleteVersion(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
  ): Promise<boolean> {
    const result = await this.db.query(
      `delete from server_versions
        where organization_id = $1 and id = $2 and published = false`,
      [organizationId, versionId],
    );
    return result.rowCount > 0;
  }

  // --- Capabilities -------------------------------------------------------

  /**
   * Replaces the discovered capability surface of a version. Published
   * versions are immutable, so discovery against them is rejected here rather
   * than being silently ignored.
   */
  async replaceCapabilities(
    organizationId: Id<'organization'>,
    version: ServerVersionRecord,
    discovered: DiscoveredCapabilities,
    options: { allowPublished?: boolean } = {},
  ): Promise<void> {
    if (version.published && !options.allowPublished) {
      throw new HubError(
        'VERSION_IMMUTABLE',
        `Version ${version.version} is published and cannot be modified.`,
        { details: { versionId: version.id } },
      );
    }

    await this.db.query(
      `update server_versions
          set capabilities = $3, protocol_version = $4, server_info = $5, discovered_at = now()
        where organization_id = $1 and id = $2`,
      [
        organizationId,
        version.id,
        discovered.capabilities ? JSON.stringify(discovered.capabilities) : null,
        discovered.protocolVersion,
        discovered.serverInfo ? JSON.stringify(discovered.serverInfo) : null,
      ],
    );

    await this.db.query('delete from server_tools where organization_id = $1 and version_id = $2', [
      organizationId,
      version.id,
    ]);
    await this.db.query(
      'delete from server_resources where organization_id = $1 and version_id = $2',
      [organizationId, version.id],
    );
    await this.db.query(
      'delete from server_prompts where organization_id = $1 and version_id = $2',
      [organizationId, version.id],
    );

    for (const tool of discovered.tools) {
      await this.db.query(
        `insert into server_tools (
           id, organization_id, server_id, version_id, name, title, description,
           input_schema, output_schema, annotations, risk_class, risk_reason, schema_fingerprint
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          newId('tool'),
          organizationId,
          version.serverId,
          version.id,
          tool.name,
          tool.title ?? null,
          tool.description ?? null,
          JSON.stringify(tool.inputSchema ?? {}),
          tool.outputSchema ? JSON.stringify(tool.outputSchema) : null,
          tool.annotations ? JSON.stringify(tool.annotations) : null,
          tool.riskClass,
          tool.riskReason,
          fingerprint(tool.inputSchema ?? {}),
        ],
      );
    }

    for (const resource of discovered.resources) {
      await this.db.query(
        `insert into server_resources (
           id, organization_id, server_id, version_id, uri, name, description, mime_type, is_template
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (version_id, uri) do nothing`,
        [
          newId('resource'),
          organizationId,
          version.serverId,
          version.id,
          resource.uri,
          resource.name ?? null,
          resource.description ?? null,
          resource.mimeType ?? null,
          resource.isTemplate ?? false,
        ],
      );
    }

    for (const prompt of discovered.prompts) {
      await this.db.query(
        `insert into server_prompts (
           id, organization_id, server_id, version_id, name, description, arguments
         ) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (version_id, name) do nothing`,
        [
          newId('prompt'),
          organizationId,
          version.serverId,
          version.id,
          prompt.name,
          prompt.description ?? null,
          JSON.stringify(prompt.arguments ?? []),
        ],
      );
    }
  }

  async listTools(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
  ): Promise<ToolRecord[]> {
    const { rows } = await this.db.query(
      'select * from server_tools where organization_id = $1 and version_id = $2 order by name asc',
      [organizationId, versionId],
    );
    return rows.map(toTool);
  }

  async findTool(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
    name: string,
  ): Promise<ToolRecord | null> {
    const { rows } = await this.db.query(
      'select * from server_tools where organization_id = $1 and version_id = $2 and name = $3',
      [organizationId, versionId, name],
    );
    return rows[0] ? toTool(rows[0]) : null;
  }

  async listResources(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
  ): Promise<ResourceRecord[]> {
    const { rows } = await this.db.query(
      'select * from server_resources where organization_id = $1 and version_id = $2 order by uri asc',
      [organizationId, versionId],
    );
    return rows.map(toResource);
  }

  async listPrompts(
    organizationId: Id<'organization'>,
    versionId: Id<'version'>,
  ): Promise<PromptRecord[]> {
    const { rows } = await this.db.query(
      'select * from server_prompts where organization_id = $1 and version_id = $2 order by name asc',
      [organizationId, versionId],
    );
    return rows.map(toPrompt);
  }

  async overrideToolRisk(
    organizationId: Id<'organization'>,
    toolId: Id<'tool'>,
    override: { riskClass: RiskClass | null; reason: string; reviewer: Id<'user'> },
  ): Promise<ToolRecord> {
    const { rows } = await this.db.query(
      `update server_tools
          set risk_override = $3, risk_override_reason = $4,
              risk_override_by = $5, risk_override_at = now()
        where organization_id = $1 and id = $2
        returning *`,
      [organizationId, toolId, override.riskClass, override.reason, override.reviewer],
    );
    const row = rows[0];
    if (!row) throw new HubError('TOOL_NOT_FOUND', 'The requested tool does not exist.');
    return toTool(row);
  }

  /** Cross-server tool search backing the global Tool Explorer. */
  async searchToolsAcrossServers(
    organizationId: Id<'organization'>,
    options: {
      query?: string | null;
      riskClass?: RiskClass[];
      serverId?: Id<'server'> | null;
      /** Restrict to each server's preferred version. */
      preferredVersionsOnly?: boolean;
      limit: number;
      offset: number;
    },
  ): Promise<{
    rows: Array<ToolRecord & { serverSlug: string; serverName: string; versionName: string }>;
    total: number;
  }> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('t.organization_id', organizationId);
    where.in('t.risk_class', options.riskClass);
    where.eq('t.server_id', options.serverId ?? undefined);
    if (options.query) {
      const q = params.add(`%${options.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.and(
        `(t.name ilike ${q} or coalesce(t.description, '') ilike ${q} or s.name ilike ${q})`,
      );
    }
    if (options.preferredVersionsOnly) {
      where.and(
        `t.version_id = (
           select v2.id from server_versions v2
            where v2.server_id = t.server_id and v2.deprecated = false
            order by v2.recommended desc, v2.published desc, v2.created_at desc
            limit 1
         )`,
      );
    }

    const limitParam = params.add(options.limit);
    const offsetParam = params.add(options.offset);
    const { rows } = await this.db.query(
      `select t.*, s.slug as server_slug, s.name as server_name, v.version as version_name
         from server_tools t
         join servers s on s.id = t.server_id
         join server_versions v on v.id = t.version_id
        ${where.sql}
        order by t.name asc, s.slug asc
        limit ${limitParam} offset ${offsetParam}`,
      params.all,
    );

    const countParams = new Params();
    const countWhere = new WhereBuilder(countParams).eq('t.organization_id', organizationId);
    countWhere.in('t.risk_class', options.riskClass);
    countWhere.eq('t.server_id', options.serverId ?? undefined);
    if (options.query) {
      const q = countParams.add(`%${options.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      countWhere.and(
        `(t.name ilike ${q} or coalesce(t.description, '') ilike ${q} or s.name ilike ${q})`,
      );
    }
    if (options.preferredVersionsOnly) {
      countWhere.and(
        `t.version_id = (
           select v2.id from server_versions v2
            where v2.server_id = t.server_id and v2.deprecated = false
            order by v2.recommended desc, v2.published desc, v2.created_at desc
            limit 1
         )`,
      );
    }
    const { rows: countRows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count
         from server_tools t
         join servers s on s.id = t.server_id
        ${countWhere.sql}`,
      countParams.all,
    );

    return {
      rows: rows.map((row) => ({
        ...toTool(row),
        serverSlug: String(row['server_slug']),
        serverName: String(row['server_name']),
        versionName: String(row['version_name']),
      })),
      total: countRows[0]?.count ?? 0,
    };
  }

  async countTools(organizationId: Id<'organization'>): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      'select count(*)::int as count from server_tools where organization_id = $1',
      [organizationId],
    );
    return rows[0]?.count ?? 0;
  }

  async countToolsByRisk(organizationId: Id<'organization'>): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ risk: string; count: number }>(
      `select coalesce(risk_override, risk_class) as risk, count(*)::int as count
         from server_tools where organization_id = $1 group by 1`,
      [organizationId],
    );
    return Object.fromEntries(rows.map((r) => [r.risk, r.count]));
  }

  // --- Composite view -----------------------------------------------------

  async getServerDetail(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    versionId?: Id<'version'> | null,
  ): Promise<ServerDetail> {
    const server = await this.findServerById(organizationId, serverId);
    if (!server) throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');
    const versions = await this.listVersions(organizationId, serverId);
    const selected = versionId
      ? (versions.find((v) => v.id === versionId) ?? null)
      : (versions.find((v) => v.id === server.latestVersionId) ??
        (await this.findPreferredVersion(organizationId, serverId)));

    if (!selected) {
      return { server, latestVersion: null, versions, tools: [], resources: [], prompts: [] };
    }
    const [tools, resources, prompts] = await Promise.all([
      this.listTools(organizationId, selected.id),
      this.listResources(organizationId, selected.id),
      this.listPrompts(organizationId, selected.id),
    ]);
    return { server, latestVersion: selected, versions, tools, resources, prompts };
  }

  // --- Environments -------------------------------------------------------

  async createEnvironment(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    name: string;
    description?: string | null;
    transportOverride?: TransportConfig | null;
  }): Promise<EnvironmentRecord> {
    const { rows } = await this.db.query(
      `insert into server_environments (id, organization_id, server_id, name, description, transport_override)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [
        newId('environment'),
        input.organizationId,
        input.serverId,
        input.name,
        input.description ?? null,
        input.transportOverride ? JSON.stringify(input.transportOverride) : null,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to create environment.');
    return toEnvironment(row);
  }

  async listEnvironments(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
  ): Promise<EnvironmentRecord[]> {
    const { rows } = await this.db.query(
      'select * from server_environments where organization_id = $1 and server_id = $2 order by name asc',
      [organizationId, serverId],
    );
    return rows.map(toEnvironment);
  }

  async findEnvironment(
    organizationId: Id<'organization'>,
    environmentId: Id<'environment'>,
  ): Promise<EnvironmentRecord | null> {
    const { rows } = await this.db.query(
      'select * from server_environments where organization_id = $1 and id = $2',
      [organizationId, environmentId],
    );
    return rows[0] ? toEnvironment(rows[0]) : null;
  }

  async deleteEnvironment(
    organizationId: Id<'organization'>,
    environmentId: Id<'environment'>,
  ): Promise<boolean> {
    const result = await this.db.query(
      'delete from server_environments where organization_id = $1 and id = $2',
      [organizationId, environmentId],
    );
    return result.rowCount > 0;
  }
}
