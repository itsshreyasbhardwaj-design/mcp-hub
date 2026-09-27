import type { Metadata } from 'next';
import { PageHeader } from '@mcp-hub/ui';
import { exploreTools } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { ToolExplorer } from '@/components/tools/tool-explorer';

export const metadata: Metadata = { title: 'Tools' };
export const dynamic = 'force-dynamic';

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; risk?: string; page?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const page = Math.max(0, Number.parseInt(params.page ?? '0', 10) || 0);
  const limit = 25;

  const result = await exploreTools(session.app, session.principal, {
    query: params.q ?? null,
    ...(params.risk ? { riskClass: params.risk.split(',') } : {}),
    preferredVersionsOnly: true,
    limit,
    offset: page * limit,
  });

  return (
    <>
      <PageHeader
        title="Tool explorer"
        description="Every tool across every registered server, addressable independently of the server that provides it. Only each server's recommended version is shown."
      />
      <ToolExplorer
        rows={result.rows as never}
        total={result.total}
        page={page}
        limit={limit}
        query={params.q ?? ''}
        risk={params.risk ?? ''}
      />
    </>
  );
}
