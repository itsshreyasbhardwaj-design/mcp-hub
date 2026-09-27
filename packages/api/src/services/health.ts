import {
  type HealthCheckRecord,
  type HealthStatus,
  type Id,
  type McpServerRecord,
  type Principal,
  HubError,
  truncate,
} from '@mcp-hub/core';
import { contextLogger } from '@mcp-hub/observability';
import { withMcpSession } from '@mcp-hub/mcp-client';
import { detectIncidents, resolvableKinds, deriveHealthStatus } from '@mcp-hub/analytics';
import type { AppContext } from '../context.js';
import { requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';
import { resolveSecrets } from './secrets.js';

export interface HealthCheckOutcome {
  check: HealthCheckRecord;
  status: HealthStatus;
  incidentsOpened: number;
  incidentsResolved: number;
}

/**
 * Performs one health check and folds it into the server's status and
 * incident timeline.
 *
 * A check is an `initialize` handshake plus a `tools/list`, because a server
 * that accepts a connection but cannot enumerate tools is broken from a
 * client's point of view even though the socket opened.
 */
export async function checkServerHealth(
  context: AppContext,
  organizationId: Id<'organization'>,
  server: McpServerRecord,
  options: { actor?: Principal | null; timeoutMs?: number } = {},
): Promise<HealthCheckOutcome> {
  const version = await context.repositories.registry.findPreferredVersion(
    organizationId,
    server.id,
  );
  if (!version) {
    throw HubError.badRequest(
      `"${server.name}" has no version to check. Create a version with a transport first.`,
    );
  }

  const secrets = await resolveSecrets(context, organizationId, server.id, null);
  const started = performance.now();

  let status: HealthStatus = 'failing';
  let latencyMs: number | null = null;
  let toolCount: number | null = null;
  let initialized = false;
  let timedOut = false;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await withMcpSession(
      {
        transport: version.transport,
        secrets,
        ...(options.timeoutMs ? { requestTimeoutMs: options.timeoutMs } : {}),
        clientInfo: { name: 'mcp-hub-health', version: '0.1.0' },
      },
      async (client) => {
        initialized = true;
        const handshakeMs = client.info?.handshakeMs ?? 0;
        const tools = await client.listTools();
        return { handshakeMs, tools: tools.length };
      },
    );
    latencyMs = Math.round(performance.now() - started);
    toolCount = result.tools;
    // Degraded rather than healthy: the server answered, but slowly enough
    // that a client with a default timeout would be at risk.
    status = latencyMs > 5000 ? 'degraded' : 'healthy';
  } catch (err) {
    latencyMs = Math.round(performance.now() - started);
    const code = err instanceof HubError ? err.code : 'UPSTREAM_ERROR';
    timedOut = code === 'UPSTREAM_TIMEOUT';
    errorCode = code;
    errorMessage = truncate(err instanceof Error ? err.message : String(err), 400);
    status = 'failing';
  }

  const check = await context.repositories.governance.recordHealthCheck({
    organizationId,
    serverId: server.id,
    versionId: version.id,
    status,
    latencyMs,
    toolCount,
    initialized,
    timedOut,
    errorCode,
    errorMessage,
  });

  const recent = await context.repositories.governance.listHealthChecks(organizationId, server.id, {
    limit: 30,
  });
  const rolled = deriveHealthStatus(recent);
  await context.repositories.registry.setHealthStatus(
    organizationId,
    server.id,
    rolled,
    check.checkedAt,
  );

  const detected = detectIncidents(recent);
  for (const incident of detected) {
    await context.repositories.governance.openIncident({
      organizationId,
      serverId: server.id,
      kind: incident.kind,
      title: incident.title,
      evidence: incident.evidence,
    });
  }
  const resolved = await context.repositories.governance.resolveOpenIncidents(
    organizationId,
    server.id,
    resolvableKinds(recent),
  );

  if (options.actor) {
    await emit(context, options.actor, {
      type: 'health.checked',
      serverId: server.id,
      versionId: version.id,
      value: latencyMs,
      status,
    });
    for (const incident of detected) {
      await emit(context, options.actor, {
        type: 'incident.opened',
        serverId: server.id,
        status: incident.kind,
      });
    }
  } else {
    await context.repositories.analytics.record({
      organizationId,
      type: 'health.checked',
      serverId: server.id,
      versionId: version.id,
      value: latencyMs,
      status,
      metadata: { source: 'worker' },
    });
  }

  contextLogger().debug('Health check complete', {
    serverId: server.id,
    status,
    latencyMs,
    incidentsOpened: detected.length,
  });

  return { check, status: rolled, incidentsOpened: detected.length, incidentsResolved: resolved };
}

/** Manual "check now" from the UI or API. */
export async function runHealthCheck(
  context: AppContext,
  principal: Principal,
  serverId: Id<'server'>,
): Promise<HealthCheckOutcome> {
  requireScope(principal, 'health:read');
  const server = await context.repositories.registry.findServerById(
    principal.organizationId,
    serverId,
  );
  if (!server) throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');

  const outcome = await checkServerHealth(context, principal.organizationId, server, {
    actor: principal,
  });
  await audit(context, principal, {
    action: 'health.checked',
    resourceType: 'server',
    resourceId: serverId,
    result: outcome.check.status === 'failing' ? 'error' : 'allowed',
    metadata: { status: outcome.status, latencyMs: outcome.check.latencyMs },
  });
  return outcome;
}

export async function getHealthOverview(
  context: AppContext,
  principal: Principal,
  serverId: Id<'server'>,
  since: Date,
): Promise<{
  summary: Awaited<ReturnType<typeof context.repositories.governance.healthSummary>>;
  checks: HealthCheckRecord[];
  incidents: Awaited<ReturnType<typeof context.repositories.governance.listIncidents>>;
}> {
  requireScope(principal, 'health:read');
  const [summary, checks, incidents] = await Promise.all([
    context.repositories.governance.healthSummary(principal.organizationId, serverId, since),
    context.repositories.governance.listHealthChecks(principal.organizationId, serverId, {
      since,
      limit: 200,
    }),
    context.repositories.governance.listIncidents(principal.organizationId, {
      serverId,
      limit: 20,
    }),
  ]);
  return { summary, checks, incidents };
}
