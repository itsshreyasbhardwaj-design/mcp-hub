import {
  type EnvironmentRequirement,
  type Id,
  type Principal,
  type ServerVersionRecord,
  type TransportConfig,
  type VersionDiff,
  HubError,
  effectiveRisk,
} from '@mcp-hub/core';
import {
  diffVersions,
  sortVersionsDescending,
  suggestedBump,
  type CapabilitySnapshot,
} from '@mcp-hub/versioning';
import type { AppContext } from '../context.js';
import { requireRole, requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';
import { reindexServer } from './indexing.js';

export interface CreateVersionInput {
  serverId: Id<'server'>;
  version: string;
  transport: TransportConfig;
  environment?: EnvironmentRequirement[];
  supportedPlatforms?: string[];
  releaseNotes?: string | null;
}

export async function createVersion(
  context: AppContext,
  principal: Principal,
  input: CreateVersionInput,
): Promise<ServerVersionRecord> {
  requireRole(principal, 'developer');
  requireScope(principal, 'servers:write');

  await context.repositories.registry.resolveServer(principal.organizationId, input.serverId);
  const version = await context.repositories.registry.createVersion({
    organizationId: principal.organizationId,
    serverId: input.serverId,
    version: input.version.trim(),
    transport: input.transport,
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.supportedPlatforms ? { supportedPlatforms: input.supportedPlatforms } : {}),
    releaseNotes: input.releaseNotes ?? null,
    createdBy: principal.userId,
  });

  await audit(context, principal, {
    action: 'version.created',
    resourceType: 'version',
    resourceId: version.id,
    metadata: { serverId: input.serverId, version: version.version },
  });
  return version;
}

/**
 * Publishing freezes a version.
 *
 * After this point the capability surface is immutable: re-running discovery
 * against a published version is rejected rather than silently overwriting
 * what consumers already pinned. A new version is the only way forward.
 */
export async function publishVersion(
  context: AppContext,
  principal: Principal,
  versionId: Id<'version'>,
  options: { markRecommended?: boolean } = {},
): Promise<{ version: ServerVersionRecord; diff: VersionDiff | null }> {
  requireRole(principal, 'developer');
  requireScope(principal, 'servers:write');

  const existing = await context.repositories.registry.findVersionById(
    principal.organizationId,
    versionId,
  );
  if (!existing) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');
  if (existing.published) {
    throw new HubError('VERSION_IMMUTABLE', `Version ${existing.version} is already published.`);
  }

  const previous = await findPreviousVersion(context, principal.organizationId, existing);
  const published = await context.repositories.registry.publishVersion(
    principal.organizationId,
    versionId,
  );

  let diff: VersionDiff | null = null;
  if (previous) {
    diff = await compareVersions(context, principal, previous.id, published.id);
  }

  if (options.markRecommended !== false) {
    await context.repositories.registry.setVersionFlags(principal.organizationId, versionId, {
      recommended: true,
    });
  }
  await reindexServer(context, principal.organizationId, published.serverId);

  await audit(context, principal, {
    action: 'version.published',
    resourceType: 'version',
    resourceId: versionId,
    metadata: {
      version: published.version,
      breakingChanges: diff?.breakingChanges ?? 0,
      previousVersion: previous?.version ?? null,
    },
  });
  await emit(context, principal, {
    type: 'version.published',
    serverId: published.serverId,
    versionId,
    value: diff?.breakingChanges ?? 0,
  });

  return { version: published, diff };
}

export async function setVersionFlags(
  context: AppContext,
  principal: Principal,
  versionId: Id<'version'>,
  flags: { deprecated?: boolean; recommended?: boolean },
): Promise<ServerVersionRecord> {
  requireRole(principal, 'developer');
  requireScope(principal, 'servers:write');
  const version = await context.repositories.registry.setVersionFlags(
    principal.organizationId,
    versionId,
    flags,
  );
  await audit(context, principal, {
    action: flags.deprecated ? 'version.deprecated' : 'version.flags-updated',
    resourceType: 'version',
    resourceId: versionId,
    metadata: flags,
  });
  if (flags.deprecated) {
    await emit(context, principal, {
      type: 'version.deprecated',
      serverId: version.serverId,
      versionId,
    });
  }
  return version;
}

/** Loads both surfaces and diffs them with the versioning engine. */
export async function compareVersions(
  context: AppContext,
  principal: Principal,
  fromVersionId: Id<'version'>,
  toVersionId: Id<'version'>,
): Promise<VersionDiff> {
  requireScope(principal, 'servers:read');
  const [from, to] = await Promise.all([
    snapshotFor(context, principal.organizationId, fromVersionId),
    snapshotFor(context, principal.organizationId, toVersionId),
  ]);
  return diffVersions(from, to);
}

export async function snapshotFor(
  context: AppContext,
  organizationId: Id<'organization'>,
  versionId: Id<'version'>,
): Promise<CapabilitySnapshot> {
  const version = await context.repositories.registry.findVersionById(organizationId, versionId);
  if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');

  const [tools, resources, prompts] = await Promise.all([
    context.repositories.registry.listTools(organizationId, versionId),
    context.repositories.registry.listResources(organizationId, versionId),
    context.repositories.registry.listPrompts(organizationId, versionId),
  ]);

  return {
    version: version.version,
    protocolVersion: version.protocolVersion,
    capabilities: version.capabilities,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      riskClass: effectiveRisk(tool),
    })),
    resources: resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      mimeType: resource.mimeType,
    })),
    prompts: prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments.map((argument) => ({
        name: argument.name,
        ...(argument.required !== undefined ? { required: argument.required } : {}),
      })),
    })),
  };
}

/** The version immediately preceding `version` in registry order. */
async function findPreviousVersion(
  context: AppContext,
  organizationId: Id<'organization'>,
  version: ServerVersionRecord,
): Promise<ServerVersionRecord | null> {
  const all = await context.repositories.registry.listVersions(organizationId, version.serverId);
  const published = sortVersionsDescending(
    all.filter((candidate) => candidate.published && candidate.id !== version.id),
    (candidate) => candidate.version,
  );
  return published[0] ?? null;
}

export { suggestedBump };
