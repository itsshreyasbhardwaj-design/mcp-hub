import type { Metadata } from 'next';
import Link from 'next/link';
import { GitCompareArrows } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  PageHeader,
  formatRelative,
} from '@mcp-hub/ui';
import { compareVersions } from '@mcp-hub/versioning';
import { requireSession } from '@/lib/session';
import { VersionCompare } from '@/components/versions/version-compare';

export const metadata: Metadata = { title: 'Versions' };
export const dynamic = 'force-dynamic';

export default async function VersionsPage() {
  const session = await requireSession();

  const servers = await session.app.repositories.registry
    .listServers(session.principal.organizationId, {}, { limit: 100 })
    .then((page) => page.data);

  const withVersions = await Promise.all(
    servers.map(async (server) => ({
      server,
      versions: await session.app.repositories.registry.listVersions(
        session.principal.organizationId,
        server.id,
      ),
    })),
  );

  const rows = withVersions.flatMap(({ server, versions }) =>
    [...versions]
      .sort((a, b) => compareVersions(b.version, a.version))
      .map((version) => ({ server, version })),
  );

  const published = rows.filter((row) => row.version.published).length;
  const drafts = rows.length - published;
  const deprecated = rows.filter((row) => row.version.deprecated).length;

  return (
    <>
      <PageHeader
        title="Versions"
        description="Publishing freezes a version's capability surface. Comparing two versions reports each change with the rule that classified it as breaking or not."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Versions" value={rows.length} hint={`${servers.length} server(s)`} />
        <MetricCard label="Published" value={published} hint="immutable" />
        <MetricCard label="Drafts" value={drafts} hint="still editable" />
        <MetricCard label="Deprecated" value={deprecated} tone={deprecated > 0 ? 'warning' : 'default'} />
      </div>

      <div className="mt-3">
        <VersionCompare
          servers={withVersions
            .filter((entry) => entry.versions.length >= 2)
            .map((entry) => ({
              slug: entry.server.slug,
              name: entry.server.name,
              versions: entry.versions.map((version) => ({
                id: version.id,
                version: version.version,
              })),
            }))}
        />
      </div>

      <Card className="mt-3">
        <CardHeader title="All versions" />
        <DataTable
          caption="All server versions"
          rows={rows}
          rowKey={(row) => row.version.id}
          empty={
            <EmptyState
              className="border-0"
              icon={<GitCompareArrows className="size-8" />}
              title="No versions yet"
              description="Register a server with a version to start tracking its capability surface."
            />
          }
          columns={[
            {
              key: 'server',
              header: 'Server',
              render: (row) => (
                <Link
                  href={`/servers/${row.server.slug}?tab=versions`}
                  className="text-sm text-fg-1 hover:text-accent"
                >
                  {row.server.name}
                </Link>
              ),
            },
            {
              key: 'version',
              header: 'Version',
              width: '220px',
              render: (row) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono text-xs text-fg-2">{row.version.version}</code>
                  {row.version.recommended ? <Badge tone="accent">recommended</Badge> : null}
                  {row.version.deprecated ? <Badge tone="warning">deprecated</Badge> : null}
                </span>
              ),
            },
            {
              key: 'state',
              header: 'State',
              width: '110px',
              render: (row) => (
                <Badge tone={row.version.published ? 'success' : 'neutral'}>
                  {row.version.published ? 'published' : 'draft'}
                </Badge>
              ),
            },
            {
              key: 'protocol',
              header: 'Protocol',
              width: '120px',
              render: (row) => (
                <code className="font-mono text-xs text-fg-4">
                  {row.version.protocolVersion ?? '—'}
                </code>
              ),
            },
            {
              key: 'created',
              header: 'Created',
              align: 'right',
              width: '130px',
              render: (row) => (
                <span className="text-xs text-fg-4">{formatRelative(row.version.createdAt)}</span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
