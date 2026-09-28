import {
  type CompatibilityRunRecord,
  type CompatibilitySuite,
  type Id,
  type Principal,
  HubError,
} from '@mcp-hub/core';
import { runCompatibility } from '@mcp-hub/testing';
import type { AppContext } from '../context.js';
import { requireRole, requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';
import { resolveSecrets } from './secrets.js';
import { resolveTransport } from './discovery.js';

export interface RunCompatibilityInput {
  versionId: Id<'version'>;
  environmentId?: Id<'environment'> | null;
  suites?: CompatibilitySuite[];
}

/**
 * Runs the compatibility suites against a live server and stores the result.
 *
 * The suites are read-only by construction (see `@mcp-hub/testing`), so this
 * is safe against a production endpoint — which matters, because the whole
 * point is to test the endpoint people actually use.
 */
export async function runCompatibilityTests(
  context: AppContext,
  principal: Principal,
  input: RunCompatibilityInput,
): Promise<CompatibilityRunRecord> {
  requireRole(principal, 'developer');
  requireScope(principal, 'testing:run');

  const version = await context.repositories.registry.findVersionById(
    principal.organizationId,
    input.versionId,
  );
  if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');

  const transport = await resolveTransport(
    context,
    principal.organizationId,
    version,
    input.environmentId ?? null,
  );
  const secrets = await resolveSecrets(
    context,
    principal.organizationId,
    version.serverId,
    input.environmentId ?? null,
  );

  const summary = await runCompatibility({
    transport,
    secrets,
    ...(input.suites ? { suites: input.suites } : {}),
  });

  const run = await context.repositories.governance.recordCompatibilityRun({
    organizationId: principal.organizationId,
    serverId: version.serverId,
    versionId: version.id,
    environmentId: input.environmentId ?? null,
    suites: summary.suites,
    total: summary.total,
    passed: summary.passed,
    warnings: summary.warnings,
    failed: summary.failed,
    skipped: summary.skipped,
    durationMs: summary.durationMs,
    cases: summary.cases,
    triggeredBy: principal.userId,
  });

  await audit(context, principal, {
    action: 'compatibility.run',
    resourceType: 'version',
    resourceId: version.id,
    result: summary.failed > 0 ? 'error' : 'allowed',
    metadata: {
      passed: summary.passed,
      warnings: summary.warnings,
      failed: summary.failed,
      skipped: summary.skipped,
    },
  });
  await emit(context, principal, {
    type: 'compatibility.completed',
    serverId: version.serverId,
    versionId: version.id,
    value: summary.failed,
    status: summary.failed > 0 ? 'failed' : 'passed',
  });

  return run;
}

export async function getCompatibilityRun(
  context: AppContext,
  principal: Principal,
  runId: Id<'compatibilityRun'>,
): Promise<CompatibilityRunRecord> {
  requireScope(principal, 'servers:read');
  const run = await context.repositories.governance.findCompatibilityRun(
    principal.organizationId,
    runId,
  );
  if (!run) throw HubError.notFound('That compatibility run does not exist.');
  return run;
}
