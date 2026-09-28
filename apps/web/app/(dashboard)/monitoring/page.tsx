import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, CheckCircle2 } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Meter,
  MetricCard,
  Note,
  PageHeader,
  StatusBadge,
  formatDuration,
  formatPercent,
  formatRelative,
} from '@mcp-hub/ui';
import { resolveWindow } from '@mcp-hub/analytics';
import { requireSession } from '@/lib/session';
import { RangePicker } from '@/components/range-picker';
import { HealthChart } from '@/components/charts';
import { ResolveIncidentButton } from '@/components/monitoring/resolve-incident';

export const metadata: Metadata = { title: 'Monitoring' };
export const dynamic = 'force-dynamic';

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = '24h' } = await searchParams;
  const session = await requireSession();
  const window = resolveWindow({ range });

  const [servers, incidents, healthSeries, healthCounts] = await Promise.all([
    session.app.repositories.registry
      .listServers(session.principal.organizationId, {}, { limit: 100 })
      .then((page) => page.data),
    session.app.repositories.governance.listIncidents(session.principal.organizationId, {
      limit: 50,
    }),
    session.app.repositories.analytics.healthSeries(session.principal.organizationId, window),
    session.app.repositories.registry.countServersByHealth(session.principal.organizationId),
  ]);

  const summaries = await Promise.all(
    servers.map(async (server) => ({
      server,
      summary: await session.app.repositories.governance.healthSummary(
        session.principal.organizationId,
        server.id,
        window.from,
      ),
    })),
  );

  const open = incidents.filter((incident) => incident.status !== 'resolved');
  const monitored = servers.filter((server) => server.healthIntervalSeconds !== null);
  const canResolve = ['owner', 'admin', 'developer'].includes(session.principal.role);

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Health checks run an initialize handshake and a tools/list against the live server. A server that connects but cannot enumerate tools is not healthy."
        actions={<RangePicker current={range} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Healthy"
          value={healthCounts.healthy}
          tone="success"
          hint={`of ${servers.length} server(s)`}
        />
        <MetricCard
          label="Degraded"
          value={healthCounts.degraded}
          tone={healthCounts.degraded > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          label="Failing"
          value={healthCounts.failing}
          tone={healthCounts.failing > 0 ? 'danger' : 'default'}
        />
        <MetricCard
          label="Open incidents"
          value={open.length}
          tone={open.length > 0 ? 'danger' : 'default'}
          hint={`${monitored.length} server(s) on a schedule`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Health checks over time" />
          <CardBody>
            <HealthChart series={healthSeries} dense={range === '24h'} height={220} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Fleet" />
          <CardBody className="space-y-3">
            <Meter
              segments={[
                { label: 'Healthy', value: healthCounts.healthy, className: 'bg-success' },
                { label: 'Degraded', value: healthCounts.degraded, className: 'bg-warning' },
                { label: 'Failing', value: healthCounts.failing, className: 'bg-danger' },
                { label: 'Unknown', value: healthCounts.unknown, className: 'bg-surface-3' },
              ]}
            />
            <Note>
              {servers.length - monitored.length} server(s) have no health-check interval and are
              only checked when someone asks. Demo servers are never checked.
            </Note>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Incidents"
          description="Each incident carries the measurements that opened it. MCP Hub never states a cause it did not measure."
        />
        {incidents.length === 0 ? (
          <CardBody>
            <EmptyState
              className="border-0 py-6"
              icon={<CheckCircle2 className="size-7" />}
              title="No incidents"
              description="Nothing has crossed a detection threshold."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {incidents.map((incident) => {
              const server = servers.find((item) => item.id === incident.serverId);
              return (
                <li key={incident.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={incident.status === 'resolved' ? 'muted' : 'danger'}>
                      {incident.status}
                    </Badge>
                    {server ? (
                      <Link
                        href={`/servers/${server.slug}?tab=health`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {server.slug}
                      </Link>
                    ) : null}
                    <span className="text-sm text-fg-1">{incident.title}</span>
                    <code className="font-mono text-[10px] text-fg-4">{incident.kind}</code>
                    <span className="ml-auto flex items-center gap-2 text-xs text-fg-4">
                      {formatRelative(incident.startedAt)}
                      {canResolve && incident.status !== 'resolved' ? (
                        <ResolveIncidentButton incidentId={incident.id} />
                      ) : null}
                    </span>
                  </div>
                  {incident.evidence.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {incident.evidence.map((item) => (
                        <span
                          key={`${item.label}-${item.value}`}
                          className="rounded border border-border bg-surface-2/50 px-2 py-1 text-[11px] text-fg-3"
                          title={`Source: ${item.source}`}
                        >
                          <span className="text-fg-4">{item.label}:</span> {item.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-3">
        <CardHeader title="Per-server health" description={`Over the selected ${range} window.`} />
        <DataTable
          caption="Per-server health"
          rows={summaries}
          rowKey={(row) => row.server.id}
          empty={
            <EmptyState
              className="border-0"
              icon={<Activity className="size-8" />}
              title="No servers to monitor"
            />
          }
          columns={[
            {
              key: 'server',
              header: 'Server',
              render: (row) => (
                <Link
                  href={`/servers/${row.server.slug}?tab=health`}
                  className="text-sm text-fg-1 hover:text-accent"
                >
                  {row.server.name}
                </Link>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: '120px',
              render: (row) => <StatusBadge status={row.server.healthStatus} />,
            },
            {
              key: 'uptime',
              header: 'Uptime',
              align: 'right',
              width: '100px',
              render: (row) => (
                <span className="text-xs">{formatPercent(row.summary.uptimePercent)}</span>
              ),
            },
            {
              key: 'checks',
              header: 'Checks',
              align: 'right',
              width: '80px',
              render: (row) => <span className="text-xs">{row.summary.checks}</span>,
            },
            {
              key: 'p95',
              header: 'p95',
              align: 'right',
              width: '90px',
              render: (row) => (
                <span className="text-xs">{formatDuration(row.summary.p95LatencyMs)}</span>
              ),
            },
            {
              key: 'interval',
              header: 'Interval',
              align: 'right',
              width: '110px',
              render: (row) => (
                <span className="text-xs text-fg-4">
                  {row.server.healthIntervalSeconds
                    ? `${Math.round(row.server.healthIntervalSeconds / 60)}m`
                    : 'manual'}
                </span>
              ),
            },
            {
              key: 'last',
              header: 'Last check',
              align: 'right',
              width: '130px',
              render: (row) => (
                <span className="text-xs text-fg-4">
                  {row.server.healthCheckedAt
                    ? formatRelative(row.server.healthCheckedAt)
                    : 'never'}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
