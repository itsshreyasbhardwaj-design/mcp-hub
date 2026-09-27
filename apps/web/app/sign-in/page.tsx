import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAppContext, getSession } from '@/lib/session';
import { SignInForm } from '@/components/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

interface SeededUser {
  email: string;
  name: string | null;
  role: string;
  organization: string;
}

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect('/');

  const app = await getAppContext();
  let users: SeededUser[] = [];

  if (app.config.auth.provider === 'dev') {
    const { rows } = await app.db.query<SeededUser>(
      `select u.email, u.name, m.role, o.name as organization
         from users u
         join organization_members m on m.user_id = u.id
         join organizations o on o.id = m.organization_id
        order by case m.role
                   when 'owner' then 0 when 'admin' then 1
                   when 'developer' then 2 else 3 end, u.email
        limit 10`,
    );
    users = rows;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-accent/15 text-accent">
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-fg-1">MCP Hub</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-fg-1">Sign in</h1>
        <p className="mt-1 text-sm text-fg-3">
          A control plane for discovering, validating, testing, monitoring and governing MCP
          servers.
        </p>
      </div>

      {app.config.auth.provider === 'clerk' ? (
        <div className="rounded-lg border border-border bg-surface-1 p-4 text-sm text-fg-3">
          <p className="font-medium text-fg-2">This deployment uses Clerk.</p>
          <p className="mt-2 leading-relaxed">
            Sign in through the Clerk flow configured for this installation. The development
            sign-in is only available when{' '}
            <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs">
              MCP_HUB_AUTH_PROVIDER=dev
            </code>
            .
          </p>
        </div>
      ) : (
        <SignInForm users={users} />
      )}
    </main>
  );
}
