import type { ServerDetail } from '@mcp-hub/core';
import { effectiveRisk } from '@mcp-hub/core';
import { EmptyState, Note } from '@mcp-hub/ui';
import { TerminalSquare } from 'lucide-react';
import { Playground } from '@/components/servers/playground';

export function PlaygroundTab({ detail, role }: { detail: ServerDetail; role: string }) {
  if (!detail.latestVersion || detail.tools.length === 0) {
    return (
      <EmptyState
        icon={<TerminalSquare className="size-8" />}
        title="Nothing to run yet"
        description="Discover this server's capability surface first; the playground builds its form from the recorded tool schemas."
      />
    );
  }

  if (detail.server.isDemo) {
    return (
      <EmptyState
        icon={<TerminalSquare className="size-8" />}
        title="Demo servers cannot be executed"
        description="This server is fictional. Its endpoint does not exist, so there is nothing to call. Use the local example servers to try the playground against real MCP traffic."
      />
    );
  }

  if (role === 'viewer') {
    return (
      <EmptyState
        icon={<TerminalSquare className="size-8" />}
        title="Your role cannot execute tools"
        description="Viewers have read-only access. Ask an administrator for the developer role to use the playground."
      />
    );
  }

  return (
    <div className="space-y-3">
      <Note>
        Every call from here goes through the same permission engine, approval gate and audit trail
        as the API. Nothing about this page grants extra privilege.
      </Note>
      <Playground
        versionId={detail.latestVersion.id}
        versionLabel={detail.latestVersion.version}
        tools={detail.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          riskClass: effectiveRisk(tool),
        }))}
      />
    </div>
  );
}
