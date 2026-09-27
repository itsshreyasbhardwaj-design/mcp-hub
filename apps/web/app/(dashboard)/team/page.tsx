import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Note,
  PageHeader,
  formatRelative,
} from '@mcp-hub/ui';
import { listMembers, listTeams } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { MemberActions } from '@/components/team/member-actions';
import { AddMemberForm } from '@/components/team/add-member-form';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

const ROLE_CAPABILITIES: Record<string, string> = {
  owner: 'Everything, including transferring ownership.',
  admin: 'Manage members, permissions, API keys and approvals.',
  developer: 'Register servers, run discovery and tests, execute permitted tools.',
  viewer: 'Read-only. Cannot execute tools.',
};

export default async function TeamPage() {
  const session = await requireSession();
  const isAdmin = ['owner', 'admin'].includes(session.principal.role);

  const [members, teams] = await Promise.all([
    listMembers(session.app, session.principal),
    listTeams(session.app, session.principal),
  ]);

  return (
    <>
      <PageHeader
        title="Team"
        description="Roles decide what a person can do. Every action they take is attributed to them in the audit log."
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card>
            <CardHeader title="Members" description={`${members.length} in this organization.`} />
            <DataTable
              caption="Organization members"
              rows={members}
              rowKey={(row) => row.membership.id}
              empty={
                <EmptyState className="border-0" icon={<Users className="size-8" />} title="No members" />
              }
              columns={[
                {
                  key: 'user',
                  header: 'Member',
                  render: (row) => (
                    <div className="min-w-0">
                      <p className="truncate text-sm text-fg-1">
                        {row.user.name ?? row.user.email}
                      </p>
                      <p className="truncate font-mono text-xs text-fg-4">{row.user.email}</p>
                    </div>
                  ),
                },
                {
                  key: 'role',
                  header: 'Role',
                  width: '130px',
                  render: (row) => (
                    <Badge
                      tone={row.membership.role === 'owner' ? 'accent' : 'neutral'}
                      title={ROLE_CAPABILITIES[row.membership.role]}
                    >
                      {row.membership.role}
                    </Badge>
                  ),
                },
                {
                  key: 'joined',
                  header: 'Joined',
                  align: 'right',
                  width: '130px',
                  render: (row) => (
                    <span className="text-xs text-fg-4">
                      {formatRelative(row.membership.createdAt)}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  width: '200px',
                  render: (row) =>
                    isAdmin ? (
                      <MemberActions
                        userId={row.user.id}
                        role={row.membership.role}
                        isSelf={row.user.id === session.principal.userId}
                        canManageOwners={session.principal.role === 'owner'}
                      />
                    ) : null,
                },
              ]}
            />
          </Card>

          {isAdmin ? <AddMemberForm /> : null}
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader title="What each role can do" />
            <CardBody>
              <dl className="space-y-3">
                {Object.entries(ROLE_CAPABILITIES).map(([role, description]) => (
                  <div key={role}>
                    <dt className="mb-0.5">
                      <Badge tone={role === 'owner' ? 'accent' : 'neutral'}>{role}</Badge>
                    </dt>
                    <dd className="text-xs leading-relaxed text-fg-3">{description}</dd>
                  </div>
                ))}
              </dl>
              <Note className="mt-3">
                Roles are the floor, not the ceiling: permission rules can narrow what a developer
                may execute, and every sensitive tool still requires acknowledgement and approval.
              </Note>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Teams" description={`${teams.length} team(s).`} />
            <CardBody>
              {teams.length === 0 ? (
                <Note>
                  No teams yet. Teams group members for shared ownership of servers; permission
                  rules can target a role today, and teams are the grouping those rules will use.
                </Note>
              ) : (
                <ul className="space-y-2">
                  {teams.map((team) => (
                    <li key={team.id} className="rounded border border-border px-3 py-2">
                      <p className="text-sm text-fg-1">{team.name}</p>
                      {team.description ? (
                        <p className="mt-0.5 text-xs text-fg-3">{team.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
