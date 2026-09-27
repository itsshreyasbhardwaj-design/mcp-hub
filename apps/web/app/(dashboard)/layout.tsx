import type { ReactNode } from 'react';
import { requireSession } from '@/lib/session';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const organizations = session.user?.memberships ?? [];
  const active = organizations.find(
    (membership) => membership.organizationId === session.principal.organizationId,
  );

  const [demoCount, pendingApprovals, openIncidents] = await Promise.all([
    session.app.db
      .query<{ count: number }>(
        'select count(*)::int as count from servers where organization_id = $1 and is_demo = true',
        [session.principal.organizationId],
      )
      .then((result) => result.rows[0]?.count ?? 0),
    session.app.repositories.governance
      .listApprovals(session.principal.organizationId, { status: ['pending'], limit: 50 })
      .then((rows) => rows.length),
    session.app.repositories.governance.countOpenIncidents(session.principal.organizationId),
  ]);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        organizationName={active?.name ?? 'Organization'}
        organizations={organizations}
        badges={{ approvals: pendingApprovals, incidents: openIncidents }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          userName={session.user?.user.name ?? session.principal.displayName}
          userEmail={session.user?.user.email ?? ''}
          role={session.principal.role}
          hasDemoData={demoCount > 0}
        />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
