import {
  type EnvironmentRequirement,
  type Id,
  type McpServerRecord,
  type Page,
  type PageRequest,
  type Principal,
  type ServerDetail,
  type ServerStatus,
  type TransportConfig,
  type Visibility,
  HubError,
  isSlug,
  toSlug,
} from '@mcp-hub/core';
import { describeTransport } from '@mcp-hub/security';
import type { AppContext } from '../context.js';
import { requireRole, requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';
import { reindexServer } from './indexing.js';

export interface RegisterServerInput {
  name: string;
  slug?: string;
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
  /** When supplied, an initial version is created alongside the server. */
  version?: {
    version: string;
    transport: TransportConfig;
    environment?: EnvironmentRequirement[];
    supportedPlatforms?: string[];
    releaseNotes?: string | null;
  };
}

/**
 * Registry service.
 *
 * Registration never connects to the server: it records metadata and returns.
 * Discovery is a separate, explicit step (see `discovery.ts`), so that adding
 * an entry to the registry cannot itself cause an outbound connection or a
 * process launch.
 */
export async function registerServer(
  context: AppContext,
  principal: Principal,
  input: RegisterServerInput,
): Promise<{ server: McpServerRecord; versionId: Id<'version'> | null }> {
  requireRole(principal, 'developer');
  requireScope(principal, 'servers:write');

  const slug = input.slug?.trim() || toSlug(input.name);
  if (!isSlug(slug)) {
    throw HubError.badRequest(
      `"${slug}" is not a valid slug. Use 2–64 lowercase alphanumeric characters separated by hyphens.`,
      { slug },
    );
  }

  const server = await context.repositories.registry.createServer({
    organizationId: principal.organizationId,
    slug,
    name: input.name.trim(),
    description: input.description ?? null,
    category: input.category ?? null,
    tags: normalizeTags(input.tags),
    repositoryUrl: input.repositoryUrl ?? null,
    documentationUrl: input.documentationUrl ?? null,
    homepageUrl: input.homepageUrl ?? null,
    license: input.license ?? null,
    maintainer: input.maintainer ?? null,
    visibility: input.visibility ?? 'organization',
    status: input.status ?? 'draft',
    healthIntervalSeconds: input.healthIntervalSeconds ?? null,
    createdBy: principal.userId,
  });

  let versionId: Id<'version'> | null = null;
  if (input.version) {
    const version = await context.repositories.registry.createVersion({
      organizationId: principal.organizationId,
      serverId: server.id,
      version: input.version.version,
      transport: input.version.transport,
      ...(input.version.environment ? { environment: input.version.environment } : {}),
      ...(input.version.supportedPlatforms
        ? { supportedPlatforms: input.version.supportedPlatforms }
        : {}),
      releaseNotes: input.version.releaseNotes ?? null,
      createdBy: principal.userId,
    });
    versionId = version.id;
    await context.repositories.registry.setLatestVersion(
      principal.organizationId,
      server.id,
      version.id,
    );
  }

  await reindexServer(context, principal.organizationId, server.id);
  await audit(context, principal, {
    action: 'server.registered',
    resourceType: 'server',
    resourceId: server.id,
    metadata: {
      slug: server.slug,
      visibility: server.visibility,
      transport: input.version ? describeTransport(input.version.transport) : null,
    },
  });
  await emit(context, principal, {
    type: 'server.registered',
    serverId: server.id,
    versionId,
  });

  return { server, versionId };
}

export async function updateServer(
  context: AppContext,
  principal: Principal,
  serverId: Id<'server'>,
  patch: Partial<RegisterServerInput>,
): Promise<McpServerRecord> {
  requireRole(principal, 'developer');
  requireScope(principal, 'servers:write');

  const updated = await context.repositories.registry.updateServer(
    principal.organizationId,
    serverId,
    {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
      ...(patch.repositoryUrl !== undefined ? { repositoryUrl: patch.repositoryUrl } : {}),
      ...(patch.documentationUrl !== undefined ? { documentationUrl: patch.documentationUrl } : {}),
      ...(patch.homepageUrl !== undefined ? { homepageUrl: patch.homepageUrl } : {}),
      ...(patch.license !== undefined ? { license: patch.license } : {}),
      ...(patch.maintainer !== undefined ? { maintainer: patch.maintainer } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.healthIntervalSeconds !== undefined
        ? { healthIntervalSeconds: patch.healthIntervalSeconds }
        : {}),
    },
  );

  await reindexServer(context, principal.organizationId, serverId);
  await audit(context, principal, {
    action: 'server.updated',
    resourceType: 'server',
    resourceId: serverId,
    metadata: { fields: Object.keys(patch) },
  });
  await emit(context, principal, { type: 'server.updated', serverId });
  return updated;
}

export async function deleteServer(
  context: AppContext,
  principal: Principal,
  serverId: Id<'server'>,
): Promise<void> {
  requireRole(principal, 'admin');
  requireScope(principal, 'servers:write');

  const server = await context.repositories.registry.findServerById(
    principal.organizationId,
    serverId,
  );
  if (!server) throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');

  const deleted = await context.repositories.registry.deleteServer(
    principal.organizationId,
    serverId,
  );
  if (!deleted) throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');

  await context.searchProvider.removeServer(serverId);
  await audit(context, principal, {
    action: 'server.deleted',
    resourceType: 'server',
    resourceId: serverId,
    metadata: { slug: server.slug },
  });
  await emit(context, principal, { type: 'server.deleted', serverId: null, metadata: { slug: server.slug } });
}

export interface ListServersInput {
  status?: ServerStatus[];
  visibility?: Visibility[];
  healthStatus?: Array<'healthy' | 'degraded' | 'failing' | 'unknown'>;
  category?: string | null;
  tag?: string | null;
  query?: string | null;
  includeDemo?: boolean;
  sort?: 'updated' | 'created' | 'name';
}

export async function listServers(
  context: AppContext,
  principal: Principal,
  filter: ListServersInput,
  page: PageRequest,
): Promise<Page<McpServerRecord>> {
  requireScope(principal, 'servers:read');
  return context.repositories.registry.listServers(principal.organizationId, filter, page);
}

export async function getServerDetail(
  context: AppContext,
  principal: Principal,
  idOrSlug: string,
  versionId?: Id<'version'> | null,
): Promise<ServerDetail> {
  requireScope(principal, 'servers:read');
  const server = await context.repositories.registry.resolveServer(
    principal.organizationId,
    idOrSlug,
  );
  return context.repositories.registry.getServerDetail(
    principal.organizationId,
    server.id,
    versionId ?? null,
  );
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const cleaned = tags
    .map((tag) => toSlug(tag))
    .filter((tag) => tag.length > 0)
    .slice(0, 20);
  return [...new Set(cleaned)];
}
