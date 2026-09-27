import type { Id } from '../ids.js';
import type {
  HealthStatus,
  RiskClass,
  ServerStatus,
  TransportKind,
  Visibility,
} from './enums.js';

/** A JSON Schema document as published by an MCP server. Never trusted. */
export type JsonSchema = Record<string, unknown>;

export interface StdioTransportConfig {
  kind: 'stdio';
  command: string;
  args: string[];
  /** Names only — values are resolved from the environment or the secret store. */
  envKeys: string[];
  cwd?: string | null;
}

export interface HttpTransportConfig {
  kind: 'streamable-http' | 'sse';
  url: string;
  /** Header names only. Values live in the encrypted credential store. */
  headerKeys: string[];
}

export type TransportConfig = StdioTransportConfig | HttpTransportConfig;

export interface EnvironmentRequirement {
  key: string;
  description: string | null;
  required: boolean;
  /** Marks the variable as a credential, so it is never echoed back. */
  secret: boolean;
}

export interface McpServerRecord {
  id: Id<'server'>;
  organizationId: Id<'organization'>;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  repositoryUrl: string | null;
  documentationUrl: string | null;
  homepageUrl: string | null;
  license: string | null;
  maintainer: string | null;
  visibility: Visibility;
  status: ServerStatus;
  /** Denormalised pointer to the version marked `recommended`. */
  latestVersionId: Id<'version'> | null;
  healthStatus: HealthStatus;
  healthCheckedAt: Date | null;
  healthIntervalSeconds: number | null;
  isDemo: boolean;
  createdBy: Id<'user'> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerVersionRecord {
  id: Id<'version'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  version: string;
  /** Immutable once published; drafts may still be edited. */
  published: boolean;
  deprecated: boolean;
  recommended: boolean;
  releaseNotes: string | null;
  transport: TransportConfig;
  environment: EnvironmentRequirement[];
  supportedPlatforms: string[];
  /** Raw `initialize` result capabilities, as reported by the server. */
  capabilities: Record<string, unknown> | null;
  protocolVersion: string | null;
  serverInfo: { name: string; version: string } | null;
  discoveredAt: Date | null;
  publishedAt: Date | null;
  createdBy: Id<'user'> | null;
  createdAt: Date;
}

export interface ToolRecord {
  id: Id<'tool'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema | null;
  annotations: Record<string, unknown> | null;
  /** Heuristic classification; `riskOverride` wins when present. */
  riskClass: RiskClass;
  riskReason: string;
  riskOverride: RiskClass | null;
  riskOverrideBy: Id<'user'> | null;
  riskOverrideReason: string | null;
  riskOverrideAt: Date | null;
  createdAt: Date;
}

/** The risk class that the permission engine must actually enforce. */
export function effectiveRisk(tool: Pick<ToolRecord, 'riskClass' | 'riskOverride'>): RiskClass {
  return tool.riskOverride ?? tool.riskClass;
}

export interface ResourceRecord {
  id: Id<'resource'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  uri: string;
  name: string | null;
  description: string | null;
  mimeType: string | null;
  isTemplate: boolean;
  createdAt: Date;
}

export interface PromptRecord {
  id: Id<'prompt'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  name: string;
  description: string | null;
  arguments: Array<{ name: string; description?: string; required?: boolean }>;
  createdAt: Date;
}

export interface EnvironmentRecord {
  id: Id<'environment'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  name: string;
  description: string | null;
  transportOverride: TransportConfig | null;
  /** Encrypted at rest; only ever decrypted inside the execution service. */
  secretRefs: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

/** Full server view assembled for the detail page and the API. */
export interface ServerDetail {
  server: McpServerRecord;
  latestVersion: ServerVersionRecord | null;
  versions: ServerVersionRecord[];
  tools: ToolRecord[];
  resources: ResourceRecord[];
  prompts: PromptRecord[];
}

export interface TransportKindInfo {
  kind: TransportKind;
  requiresProcessExecution: boolean;
}
