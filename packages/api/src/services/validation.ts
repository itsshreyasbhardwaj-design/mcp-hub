import { type Id, type Principal, type ValidationRunRecord, HubError } from '@mcp-hub/core';
import { validate, type ValidationTarget } from '@mcp-hub/validator';
import type { AppContext } from '../context.js';
import { requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';

/**
 * Runs the validation engine against a stored server/version and persists the
 * result. Validation is read-only against the registry and never touches the
 * MCP server itself, so it is always safe to run.
 */
export async function runValidation(
  context: AppContext,
  principal: Principal,
  serverId: Id<'server'>,
  versionId?: Id<'version'> | null,
): Promise<ValidationRunRecord> {
  requireScope(principal, 'validation:run');

  const detail = await context.repositories.registry.getServerDetail(
    principal.organizationId,
    serverId,
    versionId ?? null,
  );

  const target: ValidationTarget = {
    server: {
      slug: detail.server.slug,
      name: detail.server.name,
      description: detail.server.description,
      category: detail.server.category,
      tags: detail.server.tags,
      repositoryUrl: detail.server.repositoryUrl,
      documentationUrl: detail.server.documentationUrl,
      homepageUrl: detail.server.homepageUrl,
      license: detail.server.license,
      maintainer: detail.server.maintainer,
    },
    version: detail.latestVersion
      ? {
          version: detail.latestVersion.version,
          transport: detail.latestVersion.transport,
          environment: detail.latestVersion.environment,
          supportedPlatforms: detail.latestVersion.supportedPlatforms,
          protocolVersion: detail.latestVersion.protocolVersion,
          capabilities: detail.latestVersion.capabilities,
        }
      : null,
    tools: detail.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    })),
    resources: detail.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
    prompts: detail.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };

  const report = validate(target);
  const run = await context.repositories.governance.recordValidationRun({
    organizationId: principal.organizationId,
    serverId,
    versionId: detail.latestVersion?.id ?? null,
    outcome: report.outcome,
    findings: report.findings,
    durationMs: report.durationMs,
    triggeredBy: principal.userId,
  });

  await audit(context, principal, {
    action: 'validation.run',
    resourceType: 'server',
    resourceId: serverId,
    result: report.outcome === 'error' ? 'error' : 'allowed',
    metadata: {
      outcome: report.outcome,
      errors: report.counts.error,
      warnings: report.counts.warning,
      rulesRun: report.rulesRun.length,
    },
  });
  await emit(context, principal, {
    type: 'validation.completed',
    serverId,
    versionId: detail.latestVersion?.id ?? null,
    value: report.counts.error,
    status: report.outcome,
  });

  return run;
}

export async function getValidationRun(
  context: AppContext,
  principal: Principal,
  runId: Id<'validationRun'>,
): Promise<ValidationRunRecord> {
  requireScope(principal, 'servers:read');
  const run = await context.repositories.governance.findValidationRun(
    principal.organizationId,
    runId,
  );
  if (!run) throw HubError.notFound('That validation run does not exist.');
  return run;
}
