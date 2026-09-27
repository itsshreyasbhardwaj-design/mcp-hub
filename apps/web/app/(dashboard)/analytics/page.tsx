import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  Note,
  PageHeader,
  formatDuration,
  formatPercent,
} from '@mcp-hub/ui';
import { ChartLine } from 'lucide-react';
import { resolveWindow } from '@mcp-hub/analytics';
import { getDashboard } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { RangePicker } from '@/components/range-picker';
import { FailuresChart, LatencyChart, RequestsChart, ToolUsageChart } from '@/components/charts';
import { AssistantPanel } from '@/components/analytics/assistant-panel';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = '7d' } = await searchParams;
  const session = await requireSession();
  const window = resolveWindow({ range });
  const dashboard = await getDashboard(session.app, session.principal, window);
  const { metrics } = dashboard;

  if (dashboard.isEmpty) {
    return (
      <>
        <PageHeader title="Analytics" actions={<RangePicker current={range} />} />
        <EmptyState
          icon={<ChartLine className="size-8" />}
          title="No events recorded yet"
          description="Analytics is computed entirely from stored events. Run a tool from the playground, or let health monitoring collect some checks, and the charts will fill in."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Aggregates over recorded events. Empty buckets are shown as zero rather than interpolated."
        actions={<RangePicker current={range} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Tool calls" value={metrics.invocations.total} />
        <MetricCard label="Succeeded" value={metrics.invocations.succeeded} tone="success" />
        <MetricCard
          label="Failed"
          value={metrics.invocations.failed}
          tone={metrics.invocations.failed > 0 ? 'danger' : 'default'}
        />
        <MetricCard
          label="Error rate"
          value={formatPercent(metrics.invocations.errorRate)}
          tone={metrics.invocations.errorRate > 10 ? 'warning' : 'default'}
        />
        <MetricCard
          label="p95 latency"
          value={formatDuration(metrics.invocations.p95LatencyMs)}
          hint={`p50 ${formatDuration(metrics.invocations.p50LatencyMs)}`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Requests" description="Invocations by outcome." />
          <CardBody>
            <RequestsChart series={dashboard.series.requests} dense={range === '24h'} height={240} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Latency" description="Average and p95 per bucket." />
          <CardBody>
            <LatencyChart series={dashboard.series.requests} dense={range === '24h'} height={240} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Tool usage" />
          <CardBody>
            <ToolUsageChart rows={dashboard.topTools} height={280} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Failures by server" />
          <CardBody>
            <FailuresChart rows={dashboard.failuresByServer} height={280} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Tool breakdown" />
          <DataTable
            caption="Tool usage breakdown"
            rows={dashboard.topTools}
            rowKey={(row) => `${row.serverId}:${row.toolName}`}
            empty={
              <div className="px-4 py-8">
                <Note>No tool calls in this window.</Note>
              </div>
            }
            columns={[
              {
                key: 'tool',
                header: 'Tool',
                render: (row) => (
                  <Link
                    href={`/servers/${row.serverSlug}?tab=tools`}
                    className="font-mono text-xs text-fg-2 hover:text-accent"
                  >
                    <span className="text-fg-4">{row.serverSlug}.</span>
                    {row.toolName}
                  </Link>
                ),
              },
              {
                key: 'calls',
                header: 'Calls',
                align: 'right',
                width: '90px',
                render: (row) => <span className="text-xs">{row.calls}</span>,
              },
              {
                key: 'errors',
                header: 'Errors',
                align: 'right',
                width: '90px',
                render: (row) => (
                  <span className={row.errors > 0 ? 'text-xs text-danger' : 'text-xs'}>
                    {row.errors}
                  </span>
                ),
              },
              {
                key: 'rate',
                header: 'Error rate',
                align: 'right',
                width: '110px',
                render: (row) => (
                  <span className="text-xs">{formatPercent(row.errorRate)}</span>
                ),
              },
              {
                key: 'p95',
                header: 'p95',
                align: 'right',
                width: '90px',
                render: (row) => (
                  <span className="text-xs">{formatDuration(row.p95LatencyMs)}</span>
                ),
              },
            ]}
          />
        </Card>

        <AssistantPanel />
      </div>
    </>
  );
}
