import {
  type Id,
  type Principal,
  type ServerVersionRecord,
  HubError,
} from '@mcp-hub/core';
import { contextLogger } from '@mcp-hub/observability';
import { withMcpSession } from '@mcp-hub/mcp-client';
import { classifyTool, scanCapabilities, sanitizeExcerpt } from '@mcp-hub/security';
import type { DiscoveredCapabilities } from '@mcp-hub/database';
import type { AppContext } from '../context.js';
import { requireRole, requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';
import { resolveSecrets } from './secrets.js';
import { reindexServer } from './indexing.js';

export interface DiscoveryResult {
  versionId: Id<'version'>;
  protocolVersion: string | null;
  serverInfo: { name: string; version: string } | null;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  securityFindings: number;
  durationMs: number;
}

/**
 * Connects to a server, records what it exposes, and screens it.
 *
 * Three things happen in one pass, deliberately:
 *  1. capabilities are persisted, so the registry reflects reality;
 *  2. every tool is risk-classified, so the permission engine has something
 *     to enforce the moment the version exists;
 *  3. all server-provided text is scanned for prompt injection, so a hostile
 *     description is visible before anyone wires the server into an agent.
 */
export async function discoverCapabilities(
  context: AppContext,
  principal: Principal,
  versionId: Id<'version'>,
  options: { environmentId?: Id<'environment'> | null } = {},
): Promise<DiscoveryResult> {
  requireRole(principal, 'developer');
  requireScope(principal, 'servers:write');

  const started = performance.now();
  const version = await context.repositories.registry.findVersionById(
    principal.organizationId,
    versionId,
  );
  if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');
  if (version.published) {
    throw new HubError(
      'VERSION_IMMUTABLE',
      `Version ${version.version} is published. Create a new version to record a changed capability surface.`,
    );
  }

  const transport = await resolveTransport(context, principal.organizationId, version, options.environmentId ?? null);
  const secrets = await resolveSecrets(
    context,
    principal.organizationId,
    version.serverId,
    options.environmentId ?? null,
  );

  const discovered = await withMcpSession(
    { transport, secrets, clientInfo: { name: 'mcp-hub-discovery', version: '0.1.0' } },
    async (client) => {
      const info = client.info;
      const [tools, resources, resourceTemplates, prompts] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listResourceTemplates(),
        client.listPrompts(),
      ]);

      const capabilities: DiscoveredCapabilities = {
        protocolVersion: info?.protocolVersion ?? null,
        capabilities: info?.capabilities ?? null,
        serverInfo: info?.serverInfo
          ? { name: info.serverInfo.name, version: info.serverInfo.version }
          : null,
        tools: tools.map((tool) => {
          const assessment = classifyTool({
            name: tool.name,
            description: tool.description ?? null,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations ?? null,
          });
          return {
            name: tool.name,
            title: tool.title ?? null,
            description: tool.description ?? null,
            inputSchema: tool.inputSchema ?? {},
            outputSchema: tool.outputSchema ?? null,
            annotations: tool.annotations ?? null,
            riskClass: assessment.riskClass,
            riskReason: assessment.reason,
          };
        }),
        resources: [
          ...resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name ?? null,
            description: resource.description ?? null,
            mimeType: resource.mimeType ?? null,
            isTemplate: false,
          })),
          ...resourceTemplates.map((template) => ({
            uri: template.uriTemplate,
            name: template.name ?? null,
            description: template.description ?? null,
            mimeType: template.mimeType ?? null,
            isTemplate: true,
          })),
        ],
        prompts: prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description ?? null,
          arguments: prompt.arguments ?? [],
        })),
      };
      return capabilities;
    },
  );

  await context.repositories.registry.replaceCapabilities(
    principal.organizationId,
    version,
    discovered,
  );

  const findings = await recordSecurityFindings(context, principal, version, discovered);
  await reindexServer(context, principal.organizationId, version.serverId);

  const durationMs = Math.round(performance.now() - started);
  await audit(context, principal, {
    action: 'capabilities.discovered',
    resourceType: 'version',
    resourceId: versionId,
    metadata: {
      tools: discovered.tools.length,
      resources: discovered.resources.length,
      prompts: discovered.prompts.length,
      securityFindings: findings,
    },
  });
  await emit(context, principal, {
    type: 'capabilities.discovered',
    serverId: version.serverId,
    versionId,
    value: discovered.tools.length,
  });

  contextLogger().info('Discovered MCP capabilities', {
    versionId,
    tools: discovered.tools.length,
    durationMs,
  });

  return {
    versionId,
    protocolVersion: discovered.protocolVersion,
    serverInfo: discovered.serverInfo,
    toolCount: discovered.tools.length,
    resourceCount: discovered.resources.length,
    promptCount: discovered.prompts.length,
    securityFindings: findings,
    durationMs,
  };
}

async function recordSecurityFindings(
  context: AppContext,
  principal: Principal,
  version: ServerVersionRecord,
  discovered: DiscoveredCapabilities,
): Promise<number> {
  await context.repositories.governance.clearSecurityFindings(
    principal.organizationId,
    version.serverId,
    version.id,
  );

  const signals = scanCapabilities({
    tools: discovered.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema,
    })),
    resources: discovered.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name ?? null,
      description: resource.description ?? null,
    })),
    prompts: discovered.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description ?? null,
    })),
  });

  for (const signal of signals) {
    await context.repositories.governance.upsertSecurityFinding({
      organizationId: principal.organizationId,
      serverId: version.serverId,
      versionId: version.id,
      severity: signal.severity,
      rule: signal.rule,
      title: signal.title,
      detail: signal.detail,
      excerpt: sanitizeExcerpt(signal.excerpt),
      location: signal.detail.slice(signal.detail.lastIndexOf('(at ') + 4).replace(/\)$/, ''),
    });
  }

  // Unclassifiable tools are a governance problem, not a protocol one, but an
  // operator needs to see them in the same place as the injection findings.
  for (const tool of discovered.tools) {
    if (tool.riskClass !== 'UNKNOWN') continue;
    await context.repositories.governance.upsertSecurityFinding({
      organizationId: principal.organizationId,
      serverId: version.serverId,
      versionId: version.id,
      severity: 'warning',
      rule: 'risk.unclassified',
      title: `Tool "${tool.name}" could not be classified`,
      detail:
        'No classification signal matched. Unknown tools require approval before execution until an administrator reviews them.',
      excerpt: null,
      location: `tools.${tool.name}`,
    });
  }

  return signals.length;
}

/** Resolves the transport for a version, applying an environment override. */
export async function resolveTransport(
  context: AppContext,
  organizationId: Id<'organization'>,
  version: ServerVersionRecord,
  environmentId: Id<'environment'> | null,
): Promise<ServerVersionRecord['transport']> {
  if (!environmentId) return version.transport;
  const environment = await context.repositories.registry.findEnvironment(
    organizationId,
    environmentId,
  );
  if (!environment) throw HubError.notFound('That environment does not exist.');
  if (environment.serverId !== version.serverId) {
    throw HubError.badRequest('That environment belongs to a different server.');
  }
  return environment.transportOverride ?? version.transport;
}
