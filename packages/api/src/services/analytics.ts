import { type Id, type Principal, type TimeWindow } from '@mcp-hub/core';
import { buildDashboard, type DashboardData } from '@mcp-hub/analytics';
import type { AppContext } from '../context.js';
import { requireScope } from '../auth/resolve.js';

export async function getDashboard(
  context: AppContext,
  principal: Principal,
  window: TimeWindow,
): Promise<DashboardData> {
  requireScope(principal, 'analytics:read');
  return buildDashboard(principal.organizationId, window, {
    registry: context.repositories.registry,
    governance: context.repositories.governance,
    analytics: context.repositories.analytics,
  });
}

export async function getServerAnalytics(
  context: AppContext,
  principal: Principal,
  serverId: Id<'server'>,
  window: TimeWindow,
): Promise<{
  totals: Awaited<ReturnType<typeof context.repositories.analytics.invocationTotals>>;
  series: Awaited<ReturnType<typeof context.repositories.analytics.invocationSeries>>;
  topTools: Awaited<ReturnType<typeof context.repositories.analytics.topTools>>;
  versionAdoption: Awaited<ReturnType<typeof context.repositories.analytics.versionAdoption>>;
}> {
  requireScope(principal, 'analytics:read');
  const [totals, series, topTools, versionAdoption] = await Promise.all([
    context.repositories.analytics.invocationTotals(principal.organizationId, window, { serverId }),
    context.repositories.analytics.invocationSeries(principal.organizationId, window, { serverId }),
    context.repositories.analytics.topTools(principal.organizationId, window, 10),
    context.repositories.analytics.versionAdoption(principal.organizationId, serverId, window),
  ]);
  return { totals, series, topTools, versionAdoption };
}

export async function getActivity(
  context: AppContext,
  principal: Principal,
  filter: {
    action?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    result?: Array<'allowed' | 'denied' | 'error'>;
    since?: Date;
  },
  page: { cursor?: string | undefined; limit: number },
): Promise<Awaited<ReturnType<typeof context.repositories.audit.list>>> {
  requireScope(principal, 'audit:read');
  return context.repositories.audit.list(principal.organizationId, filter, page);
}
