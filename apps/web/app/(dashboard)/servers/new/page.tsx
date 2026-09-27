import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@mcp-hub/ui';
import { requireSession } from '@/lib/session';
import { RegisterServerForm } from '@/components/servers/register-form';

export const metadata: Metadata = { title: 'Register a server' };
export const dynamic = 'force-dynamic';

export default async function NewServerPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/servers" className="hover:text-fg-2">
            Servers
          </Link>
        }
        title="Register an MCP server"
        description="Registration records metadata only. MCP Hub does not connect to the server until you explicitly run discovery."
      />
      <RegisterServerForm
        stdioAllowed={session.app.config.security.allowStdioTransport}
        allowedCommands={[...session.app.config.security.stdioAllowedCommands]}
        privateNetworkAllowed={session.app.config.security.allowPrivateNetwork}
      />
    </>
  );
}
