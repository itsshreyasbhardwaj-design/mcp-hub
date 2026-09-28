import type { Metadata } from 'next';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  formatDateTime,
  formatRelative,
} from '@mcp-hub/ui';
import { getActivity } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { ActivityFilters } from '@/components/activity/activity-filters';

export const metadata: Metadata = { title: 'Activity' };
export const dynamic = 'force-dynamic';

const RESULT_TONES = { allowed: 'success', denied: 'danger', error: 'warning' } as const;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; result?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();

  const page = await getActivity(
    session.app,
    session.principal,
    {
      action: params.action ?? null,
      result: params.result ? [params.result as 'allowed' | 'denied' | 'error'] : undefined,
    },
    { limit: 50, cursor: params.cursor },
  );

  const { rows: actionRows } = await session.app.db.query<{ action: string; count: number }>(
    `select action, count(*)::int as count from audit_logs
      where organization_id = $1 group by action order by count desc limit 20`,
    [session.principal.organizationId],
  );

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every meaningful action, including the ones that were refused. Each entry carries the actor, the resource, the result and the request id that produced it."
      />

      <ActivityFilters
        actions={actionRows}
        action={params.action ?? ''}
        result={params.result ?? ''}
      />

      <Card className="mt-3">
        <DataTable
          caption="Audit log"
          rows={page.data}
          rowKey={(entry) => entry.id}
          rowClassName={(entry) => (entry.result === 'denied' ? 'bg-danger/5' : undefined)}
          empty={
            <EmptyState
              className="border-0"
              icon={<ScrollText className="size-8" />}
              title="No activity recorded"
              description="Actions appear here as soon as anyone registers, validates, tests or runs something."
            />
          }
          columns={[
            {
              key: 'when',
              header: 'When',
              width: '170px',
              render: (entry) => (
                <span className="text-xs text-fg-3" title={formatDateTime(entry.createdAt)}>
                  {formatRelative(entry.createdAt)}
                </span>
              ),
            },
            {
              key: 'actor',
              header: 'Actor',
              width: '180px',
              render: (entry) => (
                <span className="block truncate text-xs text-fg-2" title={entry.actorLabel}>
                  {entry.actorLabel}
                  <span className="ml-1 text-fg-4">({entry.actorType})</span>
                </span>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              width: '200px',
              render: (entry) => (
                <code className="font-mono text-xs text-fg-1">{entry.action}</code>
              ),
            },
            {
              key: 'resource',
              header: 'Resource',
              render: (entry) => (
                <span className="text-xs text-fg-3">
                  <span className="text-fg-4">{entry.resourceType}</span>
                  {entry.resourceId ? (
                    <code className="ml-1 font-mono text-[10px]">{entry.resourceId}</code>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'result',
              header: 'Result',
              width: '100px',
              render: (entry) => <Badge tone={RESULT_TONES[entry.result]}>{entry.result}</Badge>,
            },
            {
              key: 'metadata',
              header: 'Detail',
              render: (entry) =>
                Object.keys(entry.metadata).length === 0 ? (
                  <span className="text-xs text-fg-4">—</span>
                ) : (
                  <code className="block max-w-md truncate font-mono text-[10px] text-fg-4">
                    {JSON.stringify(entry.metadata)}
                  </code>
                ),
            },
            {
              key: 'request',
              header: 'Request',
              align: 'right',
              width: '130px',
              render: (entry) => (
                <code className="font-mono text-[10px] text-fg-4">{entry.requestId}</code>
              ),
            },
          ]}
        />
      </Card>

      {page.nextCursor ? (
        <div className="mt-3 flex justify-center">
          <Link
            href={`/activity?cursor=${encodeURIComponent(page.nextCursor)}`}
            className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm text-fg-2 hover:border-border-strong"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </>
  );
}
