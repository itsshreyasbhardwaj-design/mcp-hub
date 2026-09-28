import type { ServerDetail } from '@mcp-hub/core';
import { effectiveRisk } from '@mcp-hub/core';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Note,
  RiskBadge,
  SeverityBadge,
  formatRelative,
} from '@mcp-hub/ui';
import { ShieldCheck } from 'lucide-react';
import type { Session } from '@/lib/session';

export async function SecurityTab({ detail, session }: { detail: ServerDetail; session: Session }) {
  const [findings, validation] = await Promise.all([
    session.app.repositories.governance.listSecurityFindings(session.principal.organizationId, {
      serverId: detail.server.id,
      limit: 100,
    }),
    session.app.repositories.governance.latestValidationRun(
      session.principal.organizationId,
      detail.server.id,
    ),
  ]);

  const sensitive = detail.tools.filter((tool) =>
    ['DESTRUCTIVE', 'CREDENTIAL', 'ADMIN', 'UNKNOWN'].includes(effectiveRisk(tool)),
  );
  const credentials = detail.latestVersion?.environment.filter((item) => item.secret) ?? [];
  const transport = detail.latestVersion?.transport;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <Card>
          <CardHeader
            title="Findings"
            description="Raised when a capability surface is recorded. Content from the server is never executed — only reported."
          />
          {findings.length === 0 ? (
            <CardBody>
              <EmptyState
                className="border-0 py-6"
                icon={<ShieldCheck className="size-7" />}
                title="No open findings"
                description="Nothing in this server's metadata matched a security rule at the last discovery."
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {findings.map((finding) => (
                <li key={finding.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-sm font-medium text-fg-1">{finding.title}</span>
                    <code className="font-mono text-[10px] text-fg-4">{finding.rule}</code>
                    <span className="ml-auto text-xs text-fg-4">
                      {formatRelative(finding.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">{finding.detail}</p>
                  <code className="mt-1 block truncate font-mono text-[10px] text-fg-4">
                    {finding.location}
                  </code>
                  {finding.excerpt ? (
                    <pre className="mt-2 overflow-x-auto rounded border border-border bg-surface-2/60 p-2 font-mono text-[11px] leading-relaxed text-fg-3 scrollbar-thin">
                      {finding.excerpt}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {validation && validation.findings.length > 0 ? (
          <Card>
            <CardHeader
              title="Validation findings"
              description={`From the run ${formatRelative(validation.createdAt)}.`}
            />
            <ul className="divide-y divide-border">
              {validation.findings.slice(0, 25).map((finding) => (
                <li key={finding.id} className="flex items-start gap-3 px-4 py-2.5">
                  <SeverityBadge severity={finding.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-fg-2">{finding.message}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <code className="font-mono text-[10px] text-fg-4">{finding.location}</code>
                      <code className="font-mono text-[10px] text-fg-4">{finding.rule}</code>
                    </div>
                    {finding.suggestion ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-3">
                        → {finding.suggestion}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader title="Sensitive tools" />
          <CardBody>
            {sensitive.length === 0 ? (
              <Note>No tool on this version is classified sensitive.</Note>
            ) : (
              <ul className="space-y-2">
                {sensitive.map((tool) => (
                  <li key={tool.id} className="flex items-center gap-2">
                    <RiskBadge risk={effectiveRisk(tool)} overridden={tool.riskOverride !== null} />
                    <code className="truncate font-mono text-xs text-fg-2">{tool.name}</code>
                  </li>
                ))}
              </ul>
            )}
            <Note className="mt-3">
              Sensitive tools require an explicit risk acknowledgement, and by default a separate
              approval, before they run.
            </Note>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Credentials" />
          <CardBody>
            {credentials.length === 0 ? (
              <Note>This version declares no credentials.</Note>
            ) : (
              <ul className="space-y-1.5">
                {credentials.map((credential) => (
                  <li key={credential.key} className="flex items-center gap-2">
                    <Badge tone="warning" className="font-mono text-[10px]">
                      {credential.key}
                    </Badge>
                    <span className="text-xs text-fg-4">
                      {credential.required ? 'required' : 'optional'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Note className="mt-3">
              Values are encrypted with AES-256-GCM and are decrypted only inside the execution
              path. No API response ever contains one.
            </Note>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Network" />
          <CardBody>
            {transport?.kind === 'stdio' ? (
              <Note>
                This server runs as a local subprocess. It receives only PATH, HOME and the
                variables the version declares — never the Hub&apos;s own environment.
              </Note>
            ) : transport ? (
              <>
                <code className="block break-all font-mono text-xs text-fg-2">
                  {new URL(transport.url).origin}
                </code>
                <Note className="mt-2">
                  Every connection re-validates this endpoint against the SSRF policy, including on
                  each redirect hop.
                </Note>
              </>
            ) : (
              <Note>No transport configured.</Note>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
