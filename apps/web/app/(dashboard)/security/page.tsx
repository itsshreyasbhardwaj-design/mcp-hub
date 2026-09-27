import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  Note,
  PageHeader,
  RiskBadge,
  SeverityBadge,
  formatDateTime,
  formatRelative,
  type RiskClass,
} from '@mcp-hub/ui';
import { requireSession } from '@/lib/session';
import { ApprovalQueue } from '@/components/security/approval-queue';
import { PermissionRules } from '@/components/security/permission-rules';

export const metadata: Metadata = { title: 'Security' };
export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const session = await requireSession();
  const isAdmin = ['owner', 'admin'].includes(session.principal.role);

  const [approvals, rules, findings, servers, deniedPage] = await Promise.all([
    session.app.repositories.governance.listApprovals(session.principal.organizationId, {
      limit: 50,
    }),
    session.app.repositories.governance.listPermissionRules(session.principal.organizationId),
    session.app.repositories.governance.listSecurityFindings(session.principal.organizationId, {
      limit: 50,
    }),
    session.app.repositories.registry
      .listServers(session.principal.organizationId, {}, { limit: 100 })
      .then((page) => page.data),
    session.app.repositories.governance.listInvocations(
      session.principal.organizationId,
      { status: ['denied', 'blocked'] },
      { limit: 20 },
    ),
  ]);

  const slugFor = new Map(servers.map((server) => [server.id, server.slug]));
  const pending = approvals.filter((approval) => approval.status === 'pending');
  const criticalFindings = findings.filter((finding) => finding.severity === 'error');

  return (
    <>
      <PageHeader
        title="Security"
        description="Permission rules, the approval queue, security findings and every refused call — the record of what MCP Hub stopped."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pending approvals"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
        />
        <MetricCard label="Permission rules" value={rules.length} />
        <MetricCard
          label="Open findings"
          value={findings.length}
          tone={criticalFindings.length > 0 ? 'danger' : 'default'}
          hint={`${criticalFindings.length} critical`}
        />
        <MetricCard label="Refused calls" value={deniedPage.data.length} hint="most recent 20" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ApprovalQueue
          approvals={approvals.slice(0, 20).map((approval) => ({
            id: approval.id,
            toolName: approval.toolName,
            riskClass: approval.riskClass as RiskClass,
            status: approval.status,
            reason: approval.reason,
            argumentsJson: approval.argumentsJson,
            requestedBy: approval.requestedBy,
            decidedBy: approval.decidedBy,
            expiresAt: approval.expiresAt.toISOString(),
            createdAt: approval.createdAt.toISOString(),
            serverSlug: slugFor.get(approval.serverId) ?? approval.serverId,
          }))}
          canDecide={isAdmin}
          currentUserId={session.principal.userId ?? ''}
        />

        <Card>
          <CardHeader
            title="Security findings"
            description="Raised at discovery from the server's own metadata."
          />
          {findings.length === 0 ? (
            <CardBody>
              <EmptyState
                className="border-0 py-6"
                icon={<ShieldCheck className="size-7" />}
                title="No open findings"
              />
            </CardBody>
          ) : (
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto scrollbar-thin">
              {findings.map((finding) => (
                <li key={finding.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <Link
                      href={`/servers/${slugFor.get(finding.serverId) ?? finding.serverId}?tab=security`}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {slugFor.get(finding.serverId) ?? finding.serverId}
                    </Link>
                    <span className="text-sm text-fg-1">{finding.title}</span>
                    <span className="ml-auto text-xs text-fg-4">
                      {formatRelative(finding.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">{finding.detail}</p>
                  <code className="mt-0.5 block truncate font-mono text-[10px] text-fg-4">
                    {finding.rule} · {finding.location}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-3">
        <PermissionRules
          rules={rules.map((rule) => ({
            id: rule.id,
            effect: rule.effect,
            subjectRole: rule.subjectRole,
            subjectUserId: rule.subjectUserId,
            serverId: rule.serverId,
            toolName: rule.toolName,
            riskClass: rule.riskClass as RiskClass | null,
            priority: rule.priority,
            description: rule.description,
            serverSlug: rule.serverId ? (slugFor.get(rule.serverId) ?? null) : null,
          }))}
          servers={servers.map((server) => ({ id: server.id, slug: server.slug }))}
          canEdit={isAdmin}
        />
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Refused calls"
          description="Every execution the permission engine or approval gate stopped, with the reason."
        />
        <DataTable
          caption="Refused tool executions"
          rows={deniedPage.data}
          rowKey={(invocation) => invocation.id}
          empty={
            <div className="px-4 py-8">
              <Note>No calls have been refused.</Note>
            </div>
          }
          columns={[
            {
              key: 'when',
              header: 'When',
              width: '170px',
              render: (invocation) => (
                <span className="text-xs text-fg-4">{formatDateTime(invocation.createdAt)}</span>
              ),
            },
            {
              key: 'tool',
              header: 'Tool',
              render: (invocation) => (
                <code className="font-mono text-xs text-fg-2">
                  <span className="text-fg-4">
                    {slugFor.get(invocation.serverId) ?? invocation.serverId}.
                  </span>
                  {invocation.toolName}
                </code>
              ),
            },
            {
              key: 'risk',
              header: 'Risk',
              width: '120px',
              render: (invocation) => <RiskBadge risk={invocation.riskClass as RiskClass} />,
            },
            {
              key: 'status',
              header: 'Outcome',
              width: '110px',
              render: (invocation) => (
                <Badge tone={invocation.status === 'denied' ? 'danger' : 'warning'}>
                  {invocation.status}
                </Badge>
              ),
            },
            {
              key: 'reason',
              header: 'Reason',
              render: (invocation) => (
                <span className="text-xs text-fg-3">
                  <code className="font-mono text-[10px] text-fg-4">{invocation.errorCode}</code>{' '}
                  {invocation.errorMessage}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
