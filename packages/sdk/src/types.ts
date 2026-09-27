export type Visibility = 'public' | 'organization' | 'private';
export type ServerStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type HealthStatus = 'healthy' | 'degraded' | 'failing' | 'unknown';
export type RiskClass =
  | 'READ'
  | 'WRITE'
  | 'NETWORK'
  | 'CREDENTIAL'
  | 'DESTRUCTIVE'
  | 'ADMIN'
  | 'UNKNOWN';
export type Severity = 'error' | 'warning' | 'info';
export type PermissionEffect = 'allow' | 'require_approval' | 'deny';

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  total?: number;
}

export interface StdioTransport {
  kind: 'stdio';
  command: string;
  args: string[];
  envKeys: string[];
  cwd?: string | null;
}

export interface HttpTransport {
  kind: 'streamable-http';
  url: string;
  headerKeys: string[];
}

export type Transport = StdioTransport | HttpTransport;

export interface EnvironmentRequirement {
  key: string;
  description: string | null;
  required: boolean;
  secret: boolean;
}

export interface McpServer {
  id: string;
  organizationId: string;
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
  latestVersionId: string | null;
  healthStatus: HealthStatus;
  healthCheckedAt: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerVersion {
  id: string;
  serverId: string;
  version: string;
  published: boolean;
  deprecated: boolean;
  recommended: boolean;
  releaseNotes: string | null;
  transport: Transport;
  environment: EnvironmentRequirement[];
  capabilities: Record<string, unknown> | null;
  protocolVersion: string | null;
  serverInfo: { name: string; version: string } | null;
  createdAt: string;
}

export interface Tool {
  id: string;
  serverId: string;
  versionId: string;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  riskClass: RiskClass;
  riskReason: string;
  riskOverride: RiskClass | null;
}

export interface ServerDetail {
  server: McpServer;
  latestVersion: ServerVersion | null;
  versions: ServerVersion[];
  tools: Tool[];
  resources: Array<{ id: string; uri: string; name: string | null; mimeType: string | null }>;
  prompts: Array<{ id: string; name: string; description: string | null }>;
}

export interface ValidationFinding {
  id: string;
  severity: Severity;
  rule: string;
  location: string;
  message: string;
  suggestion: string | null;
}

export interface ValidationRun {
  id: string;
  serverId: string;
  versionId: string | null;
  outcome: 'pass' | 'warning' | 'error';
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: ValidationFinding[];
  durationMs: number;
  createdAt: string;
}

export interface CompatibilityCase {
  id: string;
  suite: string;
  key: string;
  title: string;
  outcome: 'passed' | 'warning' | 'failed' | 'skipped';
  durationMs: number;
  message: string | null;
  evidence: Record<string, unknown> | null;
}

export interface CompatibilityRun {
  id: string;
  serverId: string;
  versionId: string;
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  durationMs: number;
  cases: CompatibilityCase[];
  createdAt: string;
}

export interface VersionChange {
  kind: string;
  path: string;
  subject: string;
  before: unknown;
  after: unknown;
  breaking: boolean;
  rule: string;
  detail: string;
}

export interface VersionDiff {
  fromVersion: string;
  toVersion: string;
  toolsAdded: number;
  toolsRemoved: number;
  toolsRenamed: number;
  schemasChanged: number;
  breakingChanges: number;
  changes: VersionChange[];
}

export interface ExecutionResult {
  status: 'success' | 'error' | 'timeout' | 'denied' | 'blocked';
  invocationId: string;
  durationMs: number;
  riskClass: RiskClass;
  decision: { effect: PermissionEffect; reason: string; source: string };
  result: { content: Array<Record<string, unknown>>; structuredContent?: unknown; isError?: boolean } | null;
  error: { code: string; message: string } | null;
  approvalId: string | null;
}

export interface Approval {
  id: string;
  serverId: string;
  versionId: string;
  toolName: string;
  riskClass: RiskClass;
  argumentsJson: Record<string, unknown>;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
  requestedBy: string;
  decidedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  serverId: string;
  kind: string;
  status: 'investigating' | 'ongoing' | 'resolved';
  title: string;
  evidence: Array<{ label: string; value: string; source: string; observedAt: string }>;
  startedAt: string;
  resolvedAt: string | null;
}

export interface SearchHit {
  type: 'server' | 'tool' | 'resource' | 'prompt';
  entityId: string;
  serverId: string;
  versionId: string | null;
  title: string;
  subtitle: string | null;
  snippet: string;
  tags: string[];
  riskClass: string | null;
  score: number;
  matchKind: 'exact' | 'prefix' | 'fulltext' | 'fuzzy';
}

export interface DashboardMetrics {
  metrics: {
    servers: { total: number; healthy: number; degraded: number; failing: number; unknown: number };
    tools: { total: number; bySensitivity: Record<string, number> };
    invocations: {
      total: number;
      succeeded: number;
      failed: number;
      denied: number;
      errorRate: number;
      p50LatencyMs: number | null;
      p95LatencyMs: number | null;
    };
    incidents: { open: number; resolvedInWindow: number };
    security: { openFindings: number; criticalFindings: number };
    validation: { runs: number; failing: number };
  };
  series: Record<string, Record<string, Array<{ bucket: string; value: number }>>>;
  topTools: Array<{
    serverId: string;
    serverSlug: string;
    toolName: string;
    calls: number;
    errors: number;
    errorRate: number;
    p95LatencyMs: number | null;
  }>;
  isEmpty: boolean;
}

export interface AssistantAnswer {
  question: string;
  intent: string;
  answer: string;
  evidence: Array<{ label: string; value: string; source: string; href?: string | null }>;
  insufficientEvidence: boolean;
  provider: string;
  model: string | null;
  deterministic: boolean;
}

export interface GeneratedConfig {
  format: string;
  filename: string;
  language: 'json' | 'bash';
  content: string;
  placeholders: string[];
  notes: string[];
}
