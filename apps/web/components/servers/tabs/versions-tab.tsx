import type { ServerDetail } from '@mcp-hub/core';
import { Badge, Card, CardHeader, DataTable, formatDateTime } from '@mcp-hub/ui';
import { VersionActions } from '@/components/servers/version-actions';
import { CreateVersionForm } from '@/components/servers/create-version-form';

export function VersionsTab({ detail, canWrite }: { detail: ServerDetail; canWrite: boolean }) {
  const { server, versions } = detail;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Versions"
          description="Published versions are immutable: their capability surface can never change after publication."
        />
        <DataTable
          caption="Server versions"
          rows={versions}
          rowKey={(version) => version.id}
          columns={[
            {
              key: 'version',
              header: 'Version',
              render: (version) => (
                <span className="flex items-center gap-2">
                  <code className="font-mono text-sm text-fg-1">{version.version}</code>
                  {version.recommended ? <Badge tone="accent">recommended</Badge> : null}
                  {version.deprecated ? <Badge tone="warning">deprecated</Badge> : null}
                </span>
              ),
            },
            {
              key: 'state',
              header: 'State',
              width: '120px',
              render: (version) => (
                <Badge tone={version.published ? 'success' : 'neutral'}>
                  {version.published ? 'published' : 'draft'}
                </Badge>
              ),
            },
            {
              key: 'transport',
              header: 'Transport',
              width: '140px',
              render: (version) => (
                <code className="font-mono text-xs text-fg-3">{version.transport.kind}</code>
              ),
            },
            {
              key: 'protocol',
              header: 'Protocol',
              width: '120px',
              render: (version) => (
                <code className="font-mono text-xs text-fg-3">
                  {version.protocolVersion ?? '—'}
                </code>
              ),
            },
            {
              key: 'created',
              header: 'Created',
              align: 'right',
              width: '170px',
              render: (version) => (
                <span className="text-xs text-fg-4">{formatDateTime(version.createdAt)}</span>
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              width: '220px',
              render: (version) =>
                canWrite ? (
                  <VersionActions
                    slug={server.slug}
                    versionId={version.id}
                    published={version.published}
                    deprecated={version.deprecated}
                    recommended={version.recommended}
                    comparableVersions={versions
                      .filter((other) => other.id !== version.id)
                      .map((other) => ({ id: other.id, version: other.version }))}
                  />
                ) : null,
            },
          ]}
        />
      </Card>

      {canWrite ? <CreateVersionForm slug={server.slug} /> : null}
    </div>
  );
}
