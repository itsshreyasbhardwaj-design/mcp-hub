import type { JsonSchema, RiskClass } from '@mcp-hub/core';

/** The comparable shape of one version's capability surface. */
export interface CapabilitySnapshot {
  version: string;
  protocolVersion: string | null;
  capabilities: Record<string, unknown> | null;
  tools: SnapshotTool[];
  resources: SnapshotResource[];
  prompts: SnapshotPrompt[];
}

export interface SnapshotTool {
  name: string;
  description: string | null;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema | null;
  riskClass: RiskClass;
}

export interface SnapshotResource {
  uri: string;
  name: string | null;
  mimeType: string | null;
}

export interface SnapshotPrompt {
  name: string;
  description: string | null;
  arguments: Array<{ name: string; required?: boolean }>;
}
