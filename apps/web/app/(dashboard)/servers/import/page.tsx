import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@mcp-hub/ui';
import { requireSession } from '@/lib/session';
import { ImportWizard } from '@/components/servers/import-wizard';

export const metadata: Metadata = { title: 'Import servers' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/servers" className="hover:text-fg-2">
            Servers
          </Link>
        }
        title="Import from a client configuration"
        description="Paste a Claude Desktop or mcp.json file. MCP Hub parses it, shows exactly what would be registered, and waits for your confirmation. Nothing is executed and no literal credential is ever imported."
      />
      <ImportWizard stdioAllowed={session.app.config.security.allowStdioTransport} />
    </>
  );
}
