import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HubError } from '@mcp-hub/core';
import { getServerDetail } from '@mcp-hub/api';
import { Badge, DemoBadge, PageHeader, StatusBadge, formatRelative } from '@mcp-hub/ui';
import { requireSession } from '@/lib/session';
import { ServerActions } from '@/components/servers/server-actions';
import { ServerTabs, type ServerTab } from '@/components/servers/server-tabs';
import { OverviewTab } from '@/components/servers/tabs/overview-tab';
import { ToolsTab } from '@/components/servers/tabs/tools-tab';
import { CapabilitiesTab } from '@/components/servers/tabs/capabilities-tab';
import { VersionsTab } from '@/components/servers/tabs/versions-tab';
import { HealthTab } from '@/components/servers/tabs/health-tab';
import { SecurityTab } from '@/components/servers/tabs/security-tab';
import { PlaygroundTab } from '@/components/servers/tabs/playground-tab';
import { ConfigTab } from '@/components/servers/tabs/config-tab';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

const TABS: ServerTab[] = [
  'overview',
  'tools',
  'capabilities',
  'versions',
  'health',
  'security',
  'playground',
  'config',
];

export default async function ServerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; versionId?: string }>;
}) {
  const { slug } = await params;
  const { tab: rawTab, versionId } = await searchParams;
  const session = await requireSession();

  let detail;
  try {
    detail = await getServerDetail(
      session.app,
      session.principal,
      slug,
      (versionId ?? null) as never,
    );
  } catch (err) {
    if (err instanceof HubError && err.code === 'SERVER_NOT_FOUND') notFound();
    throw err;
  }

  const tab: ServerTab = TABS.includes(rawTab as ServerTab) ? (rawTab as ServerTab) : 'overview';
  const { server, latestVersion, versions, tools, resources, prompts } = detail;
  const canWrite = ['owner', 'admin', 'developer'].includes(session.principal.role);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/servers" className="hover:text-fg-2">
            Servers
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {server.name}
            {server.isDemo ? <DemoBadge /> : null}
            <StatusBadge status={server.healthStatus} />
            <Badge tone={server.status === 'active' ? 'success' : 'neutral'}>{server.status}</Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-4">
            <code className="font-mono text-fg-3">{server.slug}</code>
            {latestVersion ? (
              <span>
                version <span className="font-mono text-fg-3">{latestVersion.version}</span>
              </span>
            ) : (
              <span className="text-warning">no version yet</span>
            )}
            <span>{tools.length} tool(s)</span>
            <span>updated {formatRelative(server.updatedAt)}</span>
          </span>
        }
        actions={
          canWrite && latestVersion ? (
            <ServerActions
              serverSlug={server.slug}
              serverId={server.id}
              versionId={latestVersion.id}
              published={latestVersion.published}
              isDemo={server.isDemo}
            />
          ) : null
        }
      />

      <ServerTabs
        slug={server.slug}
        active={tab}
        counts={{
          tools: tools.length,
          capabilities: resources.length + prompts.length,
          versions: versions.length,
        }}
        versionId={versionId ?? null}
      />

      <div className="mt-4">
        {tab === 'overview' ? <OverviewTab detail={detail} session={session} /> : null}
        {tab === 'tools' ? (
          <ToolsTab
            detail={detail}
            canOverride={session.principal.role === 'admin' || session.principal.role === 'owner'}
          />
        ) : null}
        {tab === 'capabilities' ? <CapabilitiesTab detail={detail} /> : null}
        {tab === 'versions' ? <VersionsTab detail={detail} canWrite={canWrite} /> : null}
        {tab === 'health' ? <HealthTab detail={detail} session={session} /> : null}
        {tab === 'security' ? <SecurityTab detail={detail} session={session} /> : null}
        {tab === 'playground' ? (
          <PlaygroundTab detail={detail} role={session.principal.role} />
        ) : null}
        {tab === 'config' ? <ConfigTab detail={detail} /> : null}
      </div>
    </>
  );
}
