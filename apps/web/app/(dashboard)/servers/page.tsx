import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Server as ServerIcon, Upload } from 'lucide-react';
import {
  Badge,
  Card,
  DataTable,
  DemoBadge,
  EmptyState,
  PageHeader,
  StatusBadge,
  formatRelative,
} from '@mcp-hub/ui';
import type { McpServerRecord } from '@mcp-hub/core';
import { listServers } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { ServerFilters } from '@/components/servers/server-filters';

export const metadata: Metadata = { title: 'Servers' };
export const dynamic = 'force-dynamic';

export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; health?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();

  const page = await listServers(
    session.app,
    session.principal,
    {
      query: params.q ?? null,
      status: params.status ? [params.status as McpServerRecord['status']] : undefined,
      healthStatus: params.health ? [params.health as McpServerRecord['healthStatus']] : undefined,
      sort: 'updated',
    },
    { limit: 50, cursor: params.cursor },
  );

  return (
    <>
      <PageHeader
        title="Servers"
        description="Every MCP server registered to this organization, with its current health and capability surface."
        actions={
          <>
            <Link
              href="/servers/import"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:border-border-strong"
            >
              <Upload className="size-3.5" aria-hidden />
              Import
            </Link>
            <Link
              href="/servers/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 transition-colors hover:bg-accent-strong"
            >
              <Plus className="size-3.5" aria-hidden />
              Register server
            </Link>
          </>
        }
      />

      <ServerFilters
        query={params.q ?? ''}
        status={params.status ?? ''}
        health={params.health ?? ''}
        total={page.total ?? page.data.length}
      />

      <Card className="mt-3 overflow-hidden">
        <DataTable
          caption="Registered MCP servers"
          rows={page.data}
          rowKey={(server) => server.id}
          empty={
            <EmptyState
              className="border-0"
              icon={<ServerIcon className="size-8" />}
              title={params.q ? 'No servers match that filter' : 'No servers registered yet'}
              description={
                params.q
                  ? 'Try a different search term, or clear the filters.'
                  : 'Register a server to discover its tools, validate its schemas and monitor its health.'
              }
              action={
                params.q ? null : (
                  <Link
                    href="/servers/new"
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0"
                  >
                    Register a server
                  </Link>
                )
              }
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Server',
              render: (server) => (
                <Link href={`/servers/${server.slug}`} className="group block min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg-1 group-hover:text-accent">
                      {server.name}
                    </span>
                    {server.isDemo ? <DemoBadge /> : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-fg-4">
                    {server.slug}
                  </span>
                </Link>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: '110px',
              render: (server) => (
                <Badge tone={server.status === 'active' ? 'success' : 'neutral'}>
                  {server.status}
                </Badge>
              ),
            },
            {
              key: 'health',
              header: 'Health',
              width: '120px',
              render: (server) => <StatusBadge status={server.healthStatus} />,
            },
            {
              key: 'visibility',
              header: 'Visibility',
              width: '120px',
              render: (server) => <span className="text-xs text-fg-3">{server.visibility}</span>,
            },
            {
              key: 'tags',
              header: 'Tags',
              render: (server) =>
                server.tags.length === 0 ? (
                  <span className="text-xs text-fg-4">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {server.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} tone="muted">
                        {tag}
                      </Badge>
                    ))}
                    {server.tags.length > 3 ? (
                      <span className="text-xs text-fg-4">+{server.tags.length - 3}</span>
                    ) : null}
                  </span>
                ),
            },
            {
              key: 'checked',
              header: 'Last checked',
              align: 'right',
              width: '140px',
              render: (server) => (
                <span className="text-xs text-fg-4">
                  {server.healthCheckedAt ? formatRelative(server.healthCheckedAt) : 'never'}
                </span>
              ),
            },
            {
              key: 'updated',
              header: 'Updated',
              align: 'right',
              width: '120px',
              render: (server) => (
                <span className="text-xs text-fg-4">{formatRelative(server.updatedAt)}</span>
              ),
            },
          ]}
        />
      </Card>

      {page.nextCursor ? (
        <div className="mt-3 flex justify-center">
          <Link
            href={`/servers?cursor=${encodeURIComponent(page.nextCursor)}`}
            className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm text-fg-2 hover:border-border-strong"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </>
  );
}
