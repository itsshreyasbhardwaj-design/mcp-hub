import type { Id } from '../ids.js';
import type {
  ApprovalStatus,
  CaseOutcome,
  ChangeKind,
  CompatibilitySuite,
  HealthStatus,
  IncidentKind,
  IncidentStatus,
  InvocationStatus,
  PermissionEffect,
  RiskClass,
  Severity,
  ValidationOutcome,
} from './enums.js';

// --- Validation -----------------------------------------------------------

export interface ValidationFinding {
  id: Id<'validationFinding'>;
  severity: Severity;
  /** Machine-readable rule identifier, e.g. `tool.schema.missing-description`. */
  rule: string;
  /** Human-readable pointer into the document, e.g. `tools[3].inputSchema.path`. */
  location: string;
  message: string;
  suggestion: string | null;
}

export interface ValidationRunRecord {
  id: Id<'validationRun'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  outcome: ValidationOutcome;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: ValidationFinding[];
  durationMs: number;
  triggeredBy: Id<'user'> | null;
  createdAt: Date;
}

// --- Compatibility testing ------------------------------------------------

export interface CompatibilityCaseResult {
  id: Id<'compatibilityCase'>;
  suite: CompatibilitySuite;
  /** Stable identifier of the test, e.g. `connection.initialize`. */
  key: string;
  title: string;
  outcome: CaseOutcome;
  durationMs: number;
  message: string | null;
  /** Evidence captured during the run; redacted before storage. */
  evidence: Record<string, unknown> | null;
}

export interface CompatibilityRunRecord {
  id: Id<'compatibilityRun'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  environmentId: Id<'environment'> | null;
  suites: CompatibilitySuite[];
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  durationMs: number;
  cases: CompatibilityCaseResult[];
  triggeredBy: Id<'user'> | null;
  createdAt: Date;
}

// --- Health & incidents ---------------------------------------------------

export interface HealthCheckRecord {
  id: Id<'healthCheck'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  status: HealthStatus;
  /** Round-trip time of the `initialize` handshake. */
  latencyMs: number | null;
  toolCount: number | null;
  initialized: boolean;
  timedOut: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: Date;
}

export interface IncidentRecord {
  id: Id<'incident'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  kind: IncidentKind;
  status: IncidentStatus;
  title: string;
  /** Only evidence that was actually measured. No inferred root causes. */
  evidence: IncidentEvidence[];
  startedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
}

export interface IncidentEvidence {
  label: string;
  value: string;
  /** Where the number came from, so the UI can link back to the raw data. */
  source: 'health_checks' | 'invocations' | 'versions' | 'validation';
  observedAt: Date;
}

// --- Permissions & approvals ---------------------------------------------

export interface PermissionRuleRecord {
  id: Id<'permissionRule'>;
  organizationId: Id<'organization'>;
  effect: PermissionEffect;
  /** null means "any" at that level; more specific rules win. */
  subjectUserId: Id<'user'> | null;
  subjectRole: string | null;
  serverId: Id<'server'> | null;
  versionId: Id<'version'> | null;
  toolName: string | null;
  riskClass: RiskClass | null;
  environmentId: Id<'environment'> | null;
  /** Higher runs first among equally specific rules. */
  priority: number;
  description: string | null;
  createdBy: Id<'user'> | null;
  createdAt: Date;
}

export interface ApprovalRecord {
  id: Id<'approval'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  toolName: string;
  riskClass: RiskClass;
  /** Exact arguments the requester intends to run, hashed and stored verbatim. */
  argumentsJson: Record<string, unknown>;
  argumentsHash: string;
  reason: string | null;
  status: ApprovalStatus;
  requestedBy: Id<'user'>;
  decidedBy: Id<'user'> | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

// --- Invocations & audit --------------------------------------------------

export interface InvocationRecord {
  id: Id<'invocation'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  environmentId: Id<'environment'> | null;
  toolName: string;
  riskClass: RiskClass;
  status: InvocationStatus;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Byte sizes only — payloads are stored separately and redacted. */
  requestBytes: number;
  responseBytes: number;
  approvalId: Id<'approval'> | null;
  actorUserId: Id<'user'> | null;
  actorApiKeyId: Id<'apiKey'> | null;
  requestId: string;
  createdAt: Date;
}

export interface AuditLogRecord {
  id: Id<'auditLog'>;
  organizationId: Id<'organization'>;
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: 'allowed' | 'denied' | 'error';
  requestId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// --- Version diffing ------------------------------------------------------

export interface VersionChange {
  kind: ChangeKind;
  /** e.g. `tools.create_issue.inputSchema.properties.labels` */
  path: string;
  subject: string;
  before: unknown;
  after: unknown;
  breaking: boolean;
  /** Which explicit rule in docs/versioning classified this change. */
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

// --- Security findings ----------------------------------------------------

export interface SecurityFindingRecord {
  id: Id<'finding'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  severity: Severity;
  rule: string;
  title: string;
  detail: string;
  /** The untrusted text that triggered the finding, truncated and escaped. */
  excerpt: string | null;
  location: string;
  acknowledgedBy: Id<'user'> | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}
