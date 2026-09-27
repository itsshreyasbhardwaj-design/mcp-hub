import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import type { ServerDetail } from '@mcp-hub/core';
import {
  Card,
  CardBody,
  CardHeader,
  KeyValue,
  Note,
  SeverityBadge,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelative,
} from '@mcp-hub/ui';
import { describeTransport } from '@mcp-hub/security';
import type { Session } from '@/lib/session';

export async function OverviewTab({
  detail,
  session,
}: {
  detail: ServerDetail;
  session: Session;
}) {
  const { server, latestVersion, tools } = detail;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [validation, health, findings] = await Promise.all([
    session.app.repositories.governance.latestValidationRun(
      session.principal.organizationId,
      server.id,
    ),
    session.app.repositories.governance.healthSummary(
      session.principal.organizationId,
      server.id,
      since,
    ),
    session.app.repositories.governance.listSecurityFindings(session.principal.organizationId, {
      serverId: server.id,
      limit: 5,
    }),
  ]);

  const risky = tools.filter((tool) =>
    ['DESTRUCTIVE', 'CREDENTIAL', 'ADMIN', 'UNKNOWN'].includes(tool.riskOverride ?? tool.riskClass),
  );

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="About" />
        <CardBody className="space-y-4">
          <p className="text-sm leading-relaxed text-fg-2">
            {server.description ?? (
              <span className="text-fg-4">No description recorded.</span>
            )}
          </p>
          <dl className="grid gap-4 sm:grid-cols-3">
            <KeyValue label="Maintainer">{server.maintainer ?? '—'}</KeyValue>
            <KeyValue label="License">{server.license ?? '—'}</KeyValue>
            <KeyValue label="Category">{server.category ?? '—'}</KeyValue>
            <KeyValue label="Repository">
              {server.repositoryUrl ? (
                <a
                  href={server.repositoryUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {new URL(server.repositoryUrl).pathname.replace(/^\//, '')}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                '—'
              )}
            </KeyValue>
            <KeyValue label="Documentation">
              {server.documentationUrl ? (
                <a
                  href={server.documentationUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Docs
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                '—'
              )}
            </KeyValue>
            <KeyValue label="Registered">{formatDateTime(server.createdAt)}</KeyValue>
          </dl>

          {latestVersion ? (
            <div className="rounded-md border border-border bg-surface-2/50 p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                Transport
              </p>
              <code className="block break-all font-mono text-xs text-fg-2">
                {describeTransport(latestVersion.transport)}
              </code>
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <KeyValue label="Protocol">
                  {latestVersion.protocolVersion ?? 'not discovered'}
                </KeyValue>
                <KeyValue label="Reported name">
                  {latestVersion.serverInfo?.name ?? '—'}
                </KeyValue>
                <KeyValue label="Discovered">
                  {latestVersion.discoveredAt ? formatRelative(latestVersion.discoveredAt) : 'never'}
                </KeyValue>
              </dl>
              {latestVersion.environment.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                    Required credentials
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {latestVersion.environment.map((requirement) => (
                      <code
                        key={requirement.key}
                        className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-2"
                        title={requirement.secret ? 'Stored encrypted' : 'Plain configuration value'}
                      >
                        {requirement.key}
                        {requirement.secret ? ' 🔒' : ''}
                      </code>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <Note>
              This server has no version yet, so there is nothing to connect to. Create one from the
              Versions tab.
            </Note>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        <Card>
          <CardHeader title="Health (24h)" action={<Link href={`/servers/${server.slug}?tab=health`} className="text-xs text-accent hover:underline">Details</Link>} />
          <CardBody>
            {health.checks === 0 ? (
              <Note>No health checks recorded in the last 24 hours.</Note>
            ) : (
              <dl className="grid grid-cols-2 gap-3">
                <KeyValue label="Uptime">{formatPercent(health.uptimePercent)}</KeyValue>
                <KeyValue label="Checks">{health.checks}</KeyValue>
                <KeyValue label="p95 latency">{formatDuration(health.p95LatencyMs)}</KeyValue>
                <KeyValue label="Timeouts">{health.timeouts}</KeyValue>
              </dl>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Validation" />
          <CardBody>
            {!validation ? (
              <Note>Not validated yet. Use the Validate action above.</Note>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {validation.outcome === 'pass' ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                  ) : validation.outcome === 'warning' ? (
                    <AlertTriangle className="size-4 text-warning" aria-hidden />
                  ) : (
                    <XCircle className="size-4 text-danger" aria-hidden />
                  )}
                  <span className="text-sm font-medium text-fg-1 capitalize">
                    {validation.outcome}
                  </span>
                  <span className="ml-auto text-xs text-fg-4">
                    {formatRelative(validation.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-fg-3">
                  {validation.errorCount} error(s), {validation.warningCount} warning(s),{' '}
                  {validation.infoCount} note(s)
                </p>
                {validation.findings.slice(0, 3).map((finding) => (
                  <div key={finding.id} className="rounded border border-border bg-surface-2/50 p-2">
                    <div className="flex items-center gap-1.5">
                      <SeverityBadge severity={finding.severity} />
                      <code className="truncate font-mono text-[10px] text-fg-4">
                        {finding.rule}
                      </code>
                    </div>
                    <p className="mt-1 text-xs text-fg-2">{finding.message}</p>
                  </div>
                ))}
                {validation.findings.length > 3 ? (
                  <Link
                    href={`/servers/${server.slug}?tab=security`}
                    className="block text-xs text-accent hover:underline"
                  >
                    {validation.findings.length - 3} more finding(s)
                  </Link>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Attention" />
          <CardBody className="space-y-2">
            {risky.length > 0 ? (
              <p className="text-xs text-fg-3">
                <span className="font-medium text-warning">{risky.length}</span> tool(s) are
                classified sensitive and require approval by default.
              </p>
            ) : (
              <p className="text-xs text-fg-3">No sensitive tools on this version.</p>
            )}
            {findings.length > 0 ? (
              <p className="text-xs text-fg-3">
                <span className="font-medium text-danger">{findings.length}</span> open security
                finding(s).{' '}
                <Link href={`/servers/${server.slug}?tab=security`} className="text-accent hover:underline">
                  Review
                </Link>
              </p>
            ) : (
              <p className="text-xs text-fg-3">No open security findings.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
