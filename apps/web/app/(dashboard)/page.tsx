import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Server as ServerIcon,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import {
  Card,
  CardBody,
  CardHeader,
  DemoBadge,
  EmptyState,
  KeyValue,
  Meter,
  MetricCard,
  Note,
  PageHeader,
  StatusBadge,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@mcp-hub/ui';
import { resolveWindow } from '@mcp-hub/analytics';
import { getDashboard } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { RangePicker } from '@/components/range-picker';
import { FailuresChart, HealthChart, RequestsChart, ToolUsageChart } from '@/components/charts';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = '24h' } = await searchParams;
  const session = await requireSession();
  const window = resolveWindow({ range });

  const [dashboard, incidents, recentServers, recentValidation] = await Promise.all([
    getDashboard(session.app, session.principal, window),
    session.app.repositories.governance.listIncidents(session.principal.organizationId, {
      status: ['investigating', 'ongoing'],
      limit: 5,
    }),
    session.app.repositories.registry
      .listServers(session.principal.organizationId, { sort: 'updated' }, { limit: 5 })
      .then((page) => page.data),
    session.app.repositories.governance.listValidationRuns(
      session.principal.organizationId,
      null,
      5,
    ),
  ]);

  const { metrics } = dashboard;
  const dense = range === '24h';

  if (metrics.servers.total === 0) {
    return (
      <>
        <PageHeader
          title="Overview"
          description="Fleet health, usage and governance for every MCP server in this organization."
        />
        <EmptyState
          icon={<ServerIcon className="size-8" />}
          title="No servers registered yet"
          description={
            <>
              Register your first MCP server to start discovering tools, validating schemas and
              monitoring health. You can also run{' '}
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px]">
                pnpm db:seed
              </code>{' '}
              to load a demo organization with two real local example servers.
            </>
          }
          action={
            <Link
              href="/servers/new"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 hover:bg-accent-strong"
            >
              Register a server
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every number on this page is an aggregate over events MCP Hub recorded. Nothing is estimated."
        actions={<RangePicker current={range} />}
      />

      <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Registered servers"
          value={metrics.servers.total}
          icon={<ServerIcon className="size-4" />}
          hint={
            <span className="flex items-center gap-2">
              <span className="text-success">{metrics.servers.healthy} healthy</span>
              {metrics.servers.degraded > 0 ? (
                <span className="text-warning">{metrics.servers.degraded} degraded</span>
              ) : null}
              {metrics.servers.failing > 0 ? (
                <span className="text-danger">{metrics.servers.failing} failing</span>
              ) : null}
            </span>
          }
        />
        <MetricCard
          label="Tools"
          value={metrics.tools.total}
          icon={<Wrench className="size-4" />}
          hint={`${metrics.tools.bySensitivity['DESTRUCTIVE'] ?? 0} destructive · ${
            metrics.tools.bySensitivity['UNKNOWN'] ?? 0
          } unclassified`}
        />
        <MetricCard
          label="Tool calls"
          value={metrics.invocations.total}
          icon={<Activity className="size-4" />}
          tone={metrics.invocations.errorRate > 10 ? 'warning' : 'default'}
          hint={`${formatPercent(metrics.invocations.errorRate)} error rate · ${
            metrics.invocations.denied
          } denied`}
        />
        <MetricCard
          label="p95 latency"
          value={formatDuration(metrics.invocations.p95LatencyMs)}
          icon={<Gauge className="size-4" />}
          hint={`p50 ${formatDuration(metrics.invocations.p50LatencyMs)}`}
        />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Requests over time"
            description="Tool invocations, split by outcome."
          />
          <CardBody>
            <RequestsChart series={dashboard.series.requests} dense={dense} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Fleet health" description="Health checks by outcome." />
          <CardBody className="space-y-4">
            <HealthChart series={dashboard.series.health} dense={dense} height={150} />
            <div>
              <Meter
                segments={[
                  { label: 'Healthy', value: metrics.servers.healthy, className: 'bg-success' },
                  { label: 'Degraded', value: metrics.servers.degraded, className: 'bg-warning' },
                  { label: 'Failing', value: metrics.servers.failing, className: 'bg-danger' },
                  { label: 'Unknown', value: metrics.servers.unknown, className: 'bg-surface-3' },
                ]}
              />
              <Note className="mt-2">
                {metrics.servers.unknown > 0
                  ? `${metrics.servers.unknown} server(s) have never been health-checked.`
                  : 'Every server has a recorded health check.'}
              </Note>
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Open incidents"
            description="Opened from measured evidence only."
            action={
              <Link href="/monitoring" className="text-xs text-accent hover:underline">
                All incidents
              </Link>
            }
          />
          <CardBody>
            {incidents.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-fg-3">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                No open incidents.
              </div>
            ) : (
              <ul className="space-y-3">
                {incidents.map((incident) => (
                  <li key={incident.id} className="border-l-2 border-danger pl-3">
                    <p className="text-sm font-medium text-fg-1">{incident.title}</p>
                    <p className="mt-0.5 text-xs text-fg-4">
                      {incident.kind.replaceAll('_', ' ')} · started{' '}
                      {formatRelative(incident.startedAt)}
                    </p>
                    {incident.evidence.slice(0, 2).map((item) => (
                      <p key={item.label} className="mt-1 text-xs text-fg-3">
                        <span className="text-fg-4">{item.label}:</span> {item.value}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Most used tools" description="By invocation count in this window." />
          <CardBody>
            <ToolUsageChart rows={dashboard.topTools} height={220} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Failures by server" description="Errors and timeouts in this window." />
          <CardBody>
            <FailuresChart rows={dashboard.failuresByServer} height={220} />
          </CardBody>
        </Card>
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recently updated servers"
            action={
              <Link href="/servers" className="text-xs text-accent hover:underline">
                All servers
              </Link>
            }
          />
          <ul className="divide-y divide-border">
            {recentServers.map((server) => (
              <li key={server.id}>
                <Link
                  href={`/servers/${server.slug}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-fg-1">{server.name}</p>
                      {server.isDemo ? <DemoBadge /> : null}
                    </div>
                    <p className="truncate font-mono text-xs text-fg-4">{server.slug}</p>
                  </div>
                  <StatusBadge status={server.healthStatus} />
                  <span className="hidden w-28 shrink-0 text-right text-xs text-fg-4 sm:block">
                    {formatRelative(server.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Governance"
            action={
              <Link href="/security" className="text-xs text-accent hover:underline">
                Security
              </Link>
            }
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Open findings">
                <span className={metrics.security.criticalFindings > 0 ? 'text-danger' : ''}>
                  {formatNumber(metrics.security.openFindings)}
                  {metrics.security.criticalFindings > 0 ? (
                    <span className="ml-1 text-xs">
                      ({metrics.security.criticalFindings} critical)
                    </span>
                  ) : null}
                </span>
              </KeyValue>
              <KeyValue label="Denied calls">
                {formatNumber(metrics.invocations.denied)}
              </KeyValue>
              <KeyValue label="Validation runs">{formatNumber(metrics.validation.runs)}</KeyValue>
              <KeyValue label="Failing validations">
                <span className={metrics.validation.failing > 0 ? 'text-warning' : ''}>
                  {formatNumber(metrics.validation.failing)}
                </span>
              </KeyValue>
            </dl>

            {recentValidation.length > 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                  Recent validations
                </p>
                <ul className="space-y-1.5">
                  {recentValidation.slice(0, 4).map((run) => (
                    <li key={run.id} className="flex items-center gap-2 text-xs">
                      {run.outcome === 'error' ? (
                        <ShieldAlert className="size-3.5 shrink-0 text-danger" aria-hidden />
                      ) : run.outcome === 'warning' ? (
                        <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
                      ) : (
                        <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                      )}
                      <span className="flex-1 truncate text-fg-3">
                        {run.errorCount} error(s), {run.warningCount} warning(s)
                      </span>
                      <span className="shrink-0 text-fg-4">{formatRelative(run.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </section>
    </>
  );
}
