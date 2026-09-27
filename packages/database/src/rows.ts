/* eslint-disable @typescript-eslint/no-explicit-any -- row objects are driver-shaped. */
import type {
  ApiKeyRecord,
  ApprovalRecord,
  AuditLogRecord,
  CompatibilityRunRecord,
  EnvironmentRecord,
  HealthCheckRecord,
  IncidentRecord,
  InvocationRecord,
  McpServerRecord,
  MembershipRecord,
  OrganizationRecord,
  PermissionRuleRecord,
  PromptRecord,
  ResourceRecord,
  SecurityFindingRecord,
  ServerVersionRecord,
  TeamRecord,
  ToolRecord,
  UserRecord,
  ValidationRunRecord,
} from '@mcp-hub/core';

/**
 * Row → domain mappers. Kept in one place so the shape of a database row never
 * leaks past this module, and so nullable columns are converted exactly once.
 */

type Row = Record<string, any>;

const date = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));
const maybeDate = (value: unknown): Date | null =>
  value == null ? null : date(value);
const num = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value ?? 0);
const maybeNum = (value: unknown): number | null =>
  value == null ? null : num(value);
const arr = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const toOrganization = (r: Row): OrganizationRecord => ({
  id: r['id'],
  externalId: r['external_id'] ?? null,
  slug: r['slug'],
  name: r['name'],
  createdAt: date(r['created_at']),
});

export const toUser = (r: Row): UserRecord => ({
  id: r['id'],
  externalId: r['external_id'],
  email: r['email'],
  name: r['name'] ?? null,
  avatarUrl: r['avatar_url'] ?? null,
  createdAt: date(r['created_at']),
});

export const toMembership = (r: Row): MembershipRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  userId: r['user_id'],
  role: r['role'],
  createdAt: date(r['created_at']),
});

export const toTeam = (r: Row): TeamRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  slug: r['slug'],
  name: r['name'],
  description: r['description'] ?? null,
  createdAt: date(r['created_at']),
});

export const toServer = (r: Row): McpServerRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  slug: r['slug'],
  name: r['name'],
  description: r['description'] ?? null,
  category: r['category'] ?? null,
  tags: arr<string>(r['tags']),
  repositoryUrl: r['repository_url'] ?? null,
  documentationUrl: r['documentation_url'] ?? null,
  homepageUrl: r['homepage_url'] ?? null,
  license: r['license'] ?? null,
  maintainer: r['maintainer'] ?? null,
  visibility: r['visibility'],
  status: r['status'],
  latestVersionId: r['latest_version_id'] ?? null,
  healthStatus: r['health_status'],
  healthCheckedAt: maybeDate(r['health_checked_at']),
  healthIntervalSeconds: maybeNum(r['health_interval_seconds']),
  isDemo: Boolean(r['is_demo']),
  createdBy: r['created_by'] ?? null,
  createdAt: date(r['created_at']),
  updatedAt: date(r['updated_at']),
});

export const toVersion = (r: Row): ServerVersionRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  version: r['version'],
  published: Boolean(r['published']),
  deprecated: Boolean(r['deprecated']),
  recommended: Boolean(r['recommended']),
  releaseNotes: r['release_notes'] ?? null,
  transport: r['transport'],
  environment: arr(r['environment']),
  supportedPlatforms: arr<string>(r['supported_platforms']),
  capabilities: r['capabilities'] ?? null,
  protocolVersion: r['protocol_version'] ?? null,
  serverInfo: r['server_info'] ?? null,
  discoveredAt: maybeDate(r['discovered_at']),
  publishedAt: maybeDate(r['published_at']),
  createdBy: r['created_by'] ?? null,
  createdAt: date(r['created_at']),
});

export const toTool = (r: Row): ToolRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'],
  name: r['name'],
  title: r['title'] ?? null,
  description: r['description'] ?? null,
  inputSchema: r['input_schema'] ?? {},
  outputSchema: r['output_schema'] ?? null,
  annotations: r['annotations'] ?? null,
  riskClass: r['risk_class'],
  riskReason: r['risk_reason'] ?? '',
  riskOverride: r['risk_override'] ?? null,
  riskOverrideBy: r['risk_override_by'] ?? null,
  riskOverrideReason: r['risk_override_reason'] ?? null,
  riskOverrideAt: maybeDate(r['risk_override_at']),
  createdAt: date(r['created_at']),
});

export const toResource = (r: Row): ResourceRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'],
  uri: r['uri'],
  name: r['name'] ?? null,
  description: r['description'] ?? null,
  mimeType: r['mime_type'] ?? null,
  isTemplate: Boolean(r['is_template']),
  createdAt: date(r['created_at']),
});

export const toPrompt = (r: Row): PromptRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'],
  name: r['name'],
  description: r['description'] ?? null,
  arguments: arr(r['arguments']),
  createdAt: date(r['created_at']),
});

export const toEnvironment = (r: Row): EnvironmentRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  name: r['name'],
  description: r['description'] ?? null,
  transportOverride: r['transport_override'] ?? null,
  secretRefs: r['secret_refs'] ?? {},
  createdAt: date(r['created_at']),
  updatedAt: date(r['updated_at']),
});

export const toValidationRun = (r: Row): ValidationRunRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'] ?? null,
  outcome: r['outcome'],
  errorCount: num(r['error_count']),
  warningCount: num(r['warning_count']),
  infoCount: num(r['info_count']),
  findings: arr(r['findings']),
  durationMs: num(r['duration_ms']),
  triggeredBy: r['triggered_by'] ?? null,
  createdAt: date(r['created_at']),
});

export const toCompatibilityRun = (r: Row): CompatibilityRunRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'],
  environmentId: r['environment_id'] ?? null,
  suites: arr(r['suites']),
  total: num(r['total']),
  passed: num(r['passed']),
  warnings: num(r['warnings']),
  failed: num(r['failed']),
  skipped: num(r['skipped']),
  durationMs: num(r['duration_ms']),
  cases: arr(r['cases']),
  triggeredBy: r['triggered_by'] ?? null,
  createdAt: date(r['created_at']),
});

export const toHealthCheck = (r: Row): HealthCheckRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'] ?? null,
  status: r['status'],
  latencyMs: maybeNum(r['latency_ms']),
  toolCount: maybeNum(r['tool_count']),
  initialized: Boolean(r['initialized']),
  timedOut: Boolean(r['timed_out']),
  errorCode: r['error_code'] ?? null,
  errorMessage: r['error_message'] ?? null,
  checkedAt: date(r['checked_at']),
});

export const toIncident = (r: Row): IncidentRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  kind: r['kind'],
  status: r['status'],
  title: r['title'],
  evidence: arr<any>(r['evidence']).map((e) => ({ ...e, observedAt: date(e.observedAt) })),
  startedAt: date(r['started_at']),
  resolvedAt: maybeDate(r['resolved_at']),
  updatedAt: date(r['updated_at']),
});

export const toPermissionRule = (r: Row): PermissionRuleRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  effect: r['effect'],
  subjectUserId: r['subject_user_id'] ?? null,
  subjectRole: r['subject_role'] ?? null,
  serverId: r['server_id'] ?? null,
  versionId: r['version_id'] ?? null,
  toolName: r['tool_name'] ?? null,
  riskClass: r['risk_class'] ?? null,
  environmentId: r['environment_id'] ?? null,
  priority: num(r['priority']),
  description: r['description'] ?? null,
  createdBy: r['created_by'] ?? null,
  createdAt: date(r['created_at']),
});

export const toApproval = (r: Row): ApprovalRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'],
  toolName: r['tool_name'],
  riskClass: r['risk_class'],
  argumentsJson: r['arguments_json'] ?? {},
  argumentsHash: r['arguments_hash'],
  reason: r['reason'] ?? null,
  status: r['status'],
  requestedBy: r['requested_by'],
  decidedBy: r['decided_by'] ?? null,
  decisionReason: r['decision_reason'] ?? null,
  decidedAt: maybeDate(r['decided_at']),
  expiresAt: date(r['expires_at']),
  consumedAt: maybeDate(r['consumed_at']),
  createdAt: date(r['created_at']),
});

export const toInvocation = (r: Row): InvocationRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'],
  environmentId: r['environment_id'] ?? null,
  toolName: r['tool_name'],
  riskClass: r['risk_class'],
  status: r['status'],
  durationMs: num(r['duration_ms']),
  errorCode: r['error_code'] ?? null,
  errorMessage: r['error_message'] ?? null,
  requestBytes: num(r['request_bytes']),
  responseBytes: num(r['response_bytes']),
  approvalId: r['approval_id'] ?? null,
  actorUserId: r['actor_user_id'] ?? null,
  actorApiKeyId: r['actor_api_key_id'] ?? null,
  requestId: r['request_id'],
  createdAt: date(r['created_at']),
});

export const toAuditLog = (r: Row): AuditLogRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  actorType: r['actor_type'],
  actorId: r['actor_id'] ?? null,
  actorLabel: r['actor_label'],
  action: r['action'],
  resourceType: r['resource_type'],
  resourceId: r['resource_id'] ?? null,
  result: r['result'],
  requestId: r['request_id'],
  metadata: r['metadata'] ?? {},
  createdAt: date(r['created_at']),
});

export const toApiKey = (r: Row): ApiKeyRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  name: r['name'],
  prefix: r['prefix'],
  hash: r['hash'],
  scopes: arr(r['scopes']),
  createdBy: r['created_by'] ?? null,
  lastUsedAt: maybeDate(r['last_used_at']),
  expiresAt: maybeDate(r['expires_at']),
  revokedAt: maybeDate(r['revoked_at']),
  createdAt: date(r['created_at']),
});

export const toSecurityFinding = (r: Row): SecurityFindingRecord => ({
  id: r['id'],
  organizationId: r['organization_id'],
  serverId: r['server_id'],
  versionId: r['version_id'] ?? null,
  severity: r['severity'],
  rule: r['rule'],
  title: r['title'],
  detail: r['detail'],
  excerpt: r['excerpt'] ?? null,
  location: r['location'],
  acknowledgedBy: r['acknowledged_by'] ?? null,
  acknowledgedAt: maybeDate(r['acknowledged_at']),
  createdAt: date(r['created_at']),
});
