import type { ServerDetail } from '@mcp-hub/core';
import { EmptyState } from '@mcp-hub/ui';
import { FileCog } from 'lucide-react';
import { ConfigGenerator } from '@/components/servers/config-generator';

export function ConfigTab({ detail }: { detail: ServerDetail }) {
  if (!detail.latestVersion) {
    return (
      <EmptyState
        icon={<FileCog className="size-8" />}
        title="No version to configure"
        description="Create a version with a transport, and MCP Hub can generate client configuration for it."
      />
    );
  }

  return (
    <ConfigGenerator
      slug={detail.server.slug}
      versions={detail.versions.map((version) => ({
        id: version.id,
        version: version.version,
        deprecated: version.deprecated,
      }))}
      defaultVersionId={detail.latestVersion.id}
    />
  );
}
