import type { Metadata } from 'next';
import { Badge, Card, CardBody, CardHeader, KeyValue, Note, PageHeader } from '@mcp-hub/ui';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const { config, db } = session.app;

  const organization = await session.app.repositories.identity.findOrganizationById(
    session.principal.organizationId,
  );
  const jobStats = await session.app.repositories.jobs.stats();
  const searchDocuments = await session.app.repositories.search.count(
    session.principal.organizationId,
  );

  const rows: Array<{ label: string; value: React.ReactNode; note?: string }> = [
    {
      label: 'Database',
      value: (
        <span className="flex items-center gap-2">
          <code className="font-mono text-xs">{db.kind}</code>
          {db.kind === 'pglite' ? (
            <Badge tone="info">embedded</Badge>
          ) : (
            <Badge tone="success">managed</Badge>
          )}
        </span>
      ),
      note:
        db.kind === 'pglite'
          ? 'PostgreSQL compiled to WebAssembly, running in-process. Set DATABASE_URL to use a managed PostgreSQL.'
          : 'Connected over DATABASE_URL.',
    },
    {
      label: 'Fuzzy search',
      value: db.capabilities.trigram ? 'enabled' : 'disabled',
      note: db.capabilities.trigram
        ? 'pg_trgm is available, so typo-tolerant matching is active.'
        : 'pg_trgm is unavailable. Exact, prefix and full-text search still work.',
    },
    {
      label: 'Authentication',
      value: <code className="font-mono text-xs">{config.auth.provider}</code>,
      note:
        config.auth.provider === 'dev'
          ? 'Local development provider. MCP Hub refuses to boot this under NODE_ENV=production.'
          : 'Clerk-hosted authentication.',
    },
    {
      label: 'Assistant',
      value: <code className="font-mono text-xs">{config.llm.provider}</code>,
      note:
        config.llm.provider === 'grounded'
          ? 'Deterministic. Renders collected evidence with no network call and no model.'
          : `Explanations routed through OpenRouter using ${config.llm.model}.`,
    },
    {
      label: 'Job queue',
      value: <code className="font-mono text-xs">{config.queue.driver}</code>,
      note: `${jobStats.pending} pending · ${jobStats.running} running · ${jobStats.failed} failed`,
    },
    {
      label: 'Search index',
      value: `${searchDocuments} document(s)`,
      note: 'Rebuilt from the registry whenever a server or its capabilities change.',
    },
  ];

  const security: Array<{ label: string; value: React.ReactNode; note: string }> = [
    {
      label: 'stdio transports',
      value: config.security.allowStdioTransport ? (
        <Badge tone="warning">enabled</Badge>
      ) : (
        <Badge tone="success">disabled</Badge>
      ),
      note: config.security.allowStdioTransport
        ? `Local process execution is permitted for: ${config.security.stdioAllowedCommands.join(', ')}. Keep this off on any multi-tenant deployment.`
        : 'Servers cannot be launched as local processes. This is the safe default.',
    },
    {
      label: 'Private network access',
      value: config.security.allowPrivateNetwork ? (
        <Badge tone="warning">allowed</Badge>
      ) : (
        <Badge tone="success">blocked</Badge>
      ),
      note: config.security.allowPrivateNetwork
        ? 'Endpoints resolving to private or loopback addresses are reachable. Only appropriate for local development.'
        : 'Private, loopback, link-local, CGNAT and cloud metadata addresses are refused, and every redirect hop is re-checked.',
    },
    {
      label: 'Encryption key',
      value:
        config.security.encryptionKeySource === 'env' ? (
          <Badge tone="success">from environment</Badge>
        ) : (
          <Badge tone="warning">generated for development</Badge>
        ),
      note:
        config.security.encryptionKeySource === 'env'
          ? 'Credentials are encrypted with the key supplied in MCP_HUB_ENCRYPTION_KEY.'
          : 'A key was generated into the data directory. Production refuses to boot without MCP_HUB_ENCRYPTION_KEY.',
    },
    {
      label: 'Payload limit',
      value: `${Math.round(config.security.maxToolPayloadBytes / 1024)} KiB`,
      note: 'Applies to tool arguments and to responses read back from an MCP server.',
    },
    {
      label: 'Outbound timeout',
      value: `${config.security.outboundTimeoutMs} ms`,
      note: 'Every request to an MCP server is bounded; none can hang a worker.',
    },
    {
      label: 'Rate limits',
      value: `${config.rateLimit.maxRequests} req · ${config.rateLimit.maxToolExecutions} exec`,
      note: `Per ${Math.round(config.rateLimit.windowMs / 1000)}s window, per credential.`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="How this deployment is configured. Everything here comes from the environment and is validated at boot."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organization" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <KeyValue label="Name">{organization?.name ?? '—'}</KeyValue>
              <KeyValue label="Slug">
                <code className="font-mono text-xs">{organization?.slug ?? '—'}</code>
              </KeyValue>
              <KeyValue label="Identifier">
                <code className="font-mono text-[11px]">{session.principal.organizationId}</code>
              </KeyValue>
              <KeyValue label="Your role">
                <Badge tone="accent">{session.principal.role}</Badge>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Deployment" />
          <CardBody>
            <dl className="space-y-3">
              {rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-4">
                    {row.label}
                  </dt>
                  <dd className="text-sm text-fg-2">{row.value}</dd>
                  {row.note ? (
                    <dd className="mt-0.5 text-xs leading-relaxed text-fg-4">{row.note}</dd>
                  ) : null}
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Security posture"
          description="The settings that decide what MCP Hub will and will not do on your behalf."
        />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {security.map((row) => (
              <div key={row.label} className="rounded-md border border-border bg-surface-2/40 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-4">
                  {row.label}
                </dt>
                <dd className="mt-1 text-sm text-fg-2">{row.value}</dd>
                <dd className="mt-1 text-xs leading-relaxed text-fg-3">{row.note}</dd>
              </div>
            ))}
          </dl>
          <Note className="mt-4">
            These values are read from the environment at boot and validated before the process
            accepts a request — a misconfiguration fails immediately rather than at the first call
            that depends on it.
          </Note>
        </CardBody>
      </Card>
    </>
  );
}
