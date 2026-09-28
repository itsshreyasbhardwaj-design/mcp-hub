import type { Metadata } from 'next';
import { PageHeader } from '@mcp-hub/ui';
import { requireSession } from '@/lib/session';
import { DiscoverSearch } from '@/components/discover/discover-search';

export const metadata: Metadata = { title: 'Discover' };
export const dynamic = 'force-dynamic';

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title="Discover"
        description="Search across server names, descriptions, tool names, schemas, resources and prompts."
      />
      <DiscoverSearch initialQuery={q ?? ''} fuzzyAvailable={session.app.db.capabilities.trigram} />
    </>
  );
}
