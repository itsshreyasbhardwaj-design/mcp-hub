import type { ServerDetail } from '@mcp-hub/core';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  Note,
  StatusBadge,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelative,
} from '@mcp-hub/ui';
import { Activity } from 'lucide-react';
import { getHealthOverview } from '@mcp-hub/api';
import type { Session } from '@/lib/session';
import { LatencyChart } from '@/components/charts';

export async function HealthTab({
  detail,
  session,
}: {
  detail: ServerDetail;
  session: Session;
}) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { summary, checks, incidents } = await getHealthOverview(
    session.app,
    session.principal,
    detail.server.id,
    since,
  );

  if (checks.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="size-8" />}
        title="No health checks recorded"
        description={
          detail.server.isDemo
            ? 'This is a demo server. It points at an endpoint that does not exist, so it is deliberately never health-checked.'
            : 'Run a health check from the actions above, or set a health-check interval so the worker checks it automatically.'
        }
      />
    );
  }

  // Bucket the raw checks into an hourly latency series for the chart.
  const buckets = new Map<number, { sum: number; count: number; max: number }>();
  for (const check of checks) {
    if (check.latencyMs == null) continue;
    const bucket = Math.floor(check.checkedAt.getTime() / 3_600_000) * 3_600_000;
    const entry = buckets.get(bucket) ?? { sum: 0, count: 0, max: 0 };
    entry.sum += check.latencyMs;
    entry.count += 1;
    entry.max = Math.max(entry.max, check.latencyMs);
    buckets.set(bucket, entry);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const series = {
    avgLatencyMs: ordered.map(([bucket, entry]) => ({
      bucket: new Date(bucket).toISOString(),
      value: Math.round(entry.sum / entry.count),
    })),
    p95LatencyMs: ordered.map(([bucket, entry]) => ({
      bucket: new Date(bucket).toISOString(),
      value: entry.max,
    })),
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Uptime (7d)"
          value={formatPercent(summary.uptimePercent)}
          tone={
            (summary.uptimePercent ?? 100) < 95
              ? 'danger'
              : (summary.uptimePercent ?? 100) < 99
                ? 'warning'
                : 'success'
          }
          hint={`${summary.healthy} of ${summary.checks} checks healthy`}
        />
        <MetricCard label="p95 latency" value={formatDuration(summary.p95LatencyMs)} hint={`average ${formatDuration(summary.avgLatencyMs)}`} />
        <MetricCard label="Failures" value={summary.failing} tone={summary.failing > 0 ? 'danger' : 'default'} />
        <MetricCard label="Timeouts" value={summary.timeouts} tone={summary.timeouts > 0 ? 'warning' : 'default'} />
      </div>

      <Card>
        <CardHeader title="Latency" description="Hourly average and peak, from recorded checks." />
        <CardBody>
          <LatencyChart series={series} dense={false} />
        </CardBody>
      </Card>

      {incidents.length > 0 ? (
        <Card>
          <CardHeader
            title="Incidents"
            description="Opened from measured evidence. MCP Hub never infers a root cause."
          />
          <ul className="divide-y divide-border">
            {incidents.map((incident) => (
              <li key={incident.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={incident.status === 'resolved' ? 'muted' : 'danger'}>
                    {incident.status}
                  </Badge>
                  <span className="text-sm font-medium text-fg-1">{incident.title}</span>
                  <code className="font-mono text-[10px] text-fg-4">{incident.kind}</code>
                  <span className="ml-auto text-xs text-fg-4">
                    started {formatRelative(incident.startedAt)}
                    {incident.resolvedAt ? ` · resolved ${formatRelative(incident.resolvedAt)}` : ''}
                  </span>
                </div>
                {incident.evidence.length > 0 ? (
                  <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                    {incident.evidence.map((item) => (
                      <div key={`${item.label}-${item.value}`} className="rounded border border-border bg-surface-2/50 px-2 py-1.5">
                        <dt className="text-[10px] uppercase tracking-wide text-fg-4">
                          {item.label}
                        </dt>
                        <dd className="text-xs text-fg-2">{item.value}</dd>
                        <dd className="text-[10px] text-fg-4">source: {item.source}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Recent checks" />
        <DataTable
          caption="Recent health checks"
          rows={checks.slice(0, 50)}
          rowKey={(check) => check.id}
          rowClassName={(check) => (check.status === 'failing' ? 'bg-danger/5' : undefined)}
          columns={[
            {
              key: 'checked',
              header: 'When',
              width: '180px',
              render: (check) => (
                <span className="text-xs text-fg-3">{formatDateTime(check.checkedAt)}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: '120px',
              render: (check) => <StatusBadge status={check.status} />,
            },
            {
              key: 'latency',
              header: 'Latency',
              align: 'right',
              width: '100px',
              render: (check) => (
                <span className="text-xs">{formatDuration(check.latencyMs)}</span>
              ),
            },
            {
              key: 'tools',
              header: 'Tools',
              align: 'right',
              width: '80px',
              render: (check) => <span className="text-xs">{check.toolCount ?? '—'}</span>,
            },
            {
              key: 'error',
              header: 'Error',
              render: (check) =>
                check.errorMessage ? (
                  <span className="text-xs text-danger">
                    <code className="font-mono text-[10px]">{check.errorCode}</code>{' '}
                    {check.errorMessage}
                  </span>
                ) : (
                  <span className="text-xs text-fg-4">—</span>
                ),
            },
          ]}
        />
        <div className="border-t border-border px-4 py-2">
          <Note>
            Showing the 50 most recent of {checks.length} checks in the last 7 days.
          </Note>
        </div>
      </Card>
    </div>
  );
}
