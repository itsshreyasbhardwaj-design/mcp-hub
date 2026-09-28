import type { ServerDetail } from '@mcp-hub/core';
import { effectiveRisk } from '@mcp-hub/core';
import { Card, EmptyState, Note } from '@mcp-hub/ui';
import { Wrench } from 'lucide-react';
import { ToolList } from '@/components/servers/tool-list';

export function ToolsTab({ detail, canOverride }: { detail: ServerDetail; canOverride: boolean }) {
  if (detail.tools.length === 0) {
    return (
      <EmptyState
        icon={<Wrench className="size-8" />}
        title="No tools discovered"
        description={
          detail.latestVersion
            ? 'Run Discover to connect to this server and record the tools it exposes.'
            : 'Create a version with a transport, then run Discover.'
        }
      />
    );
  }

  const tools = detail.tools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    riskClass: effectiveRisk(tool),
    heuristicRisk: tool.riskClass,
    riskReason: tool.riskReason,
    overridden: tool.riskOverride !== null,
    overrideReason: tool.riskOverrideReason,
  }));

  return (
    <Card>
      <div className="border-b border-border px-4 py-3">
        <Note>
          Risk classification is a heuristic over the tool name, description and schema. It is a
          starting point for review, not a guarantee — an administrator can override any
          classification, and the override is recorded with its reason.
        </Note>
      </div>
      <ToolList tools={tools} canOverride={canOverride} />
    </Card>
  );
}
