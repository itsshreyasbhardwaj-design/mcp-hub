export const VISIBILITY = ['public', 'organization', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const SERVER_STATUS = ['draft', 'active', 'deprecated', 'archived'] as const;
export type ServerStatus = (typeof SERVER_STATUS)[number];

export const TRANSPORT_KINDS = ['stdio', 'streamable-http', 'sse'] as const;
export type TransportKind = (typeof TRANSPORT_KINDS)[number];

export const HEALTH_STATUS = ['healthy', 'degraded', 'failing', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUS)[number];

export const SEVERITY = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITY)[number];

export const VALIDATION_OUTCOME = ['pass', 'warning', 'error'] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOME)[number];

/**
 * Risk classes for tools. This is a heuristic — see `docs/permissions.md`.
 * Ordered from least to most privileged; `UNKNOWN` sorts last deliberately so
 * that an unclassifiable tool is never treated as safe.
 */
export const RISK_CLASSES = [
  'READ',
  'WRITE',
  'NETWORK',
  'CREDENTIAL',
  'DESTRUCTIVE',
  'ADMIN',
  'UNKNOWN',
] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/** Risk classes that must never execute without an explicit human decision. */
export const SENSITIVE_RISK_CLASSES: readonly RiskClass[] = [
  'DESTRUCTIVE',
  'CREDENTIAL',
  'ADMIN',
  'UNKNOWN',
];

export const PERMISSION_EFFECTS = ['allow', 'require_approval', 'deny'] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

export const ORG_ROLES = ['owner', 'admin', 'developer', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const APPROVAL_STATUS = ['pending', 'approved', 'denied', 'expired', 'consumed'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number];

export const INVOCATION_STATUS = ['success', 'error', 'timeout', 'denied', 'blocked'] as const;
export type InvocationStatus = (typeof INVOCATION_STATUS)[number];

export const INCIDENT_STATUS = ['investigating', 'ongoing', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUS)[number];

export const INCIDENT_KIND = [
  'repeated_failures',
  'latency_spike',
  'timeout_spike',
  'capability_change',
  'tool_removed',
  'schema_change',
] as const;
export type IncidentKind = (typeof INCIDENT_KIND)[number];

export const CHANGE_KIND = [
  'tool_added',
  'tool_removed',
  'tool_renamed',
  'schema_changed',
  'description_changed',
  'risk_changed',
  'resource_added',
  'resource_removed',
  'prompt_added',
  'prompt_removed',
  'capability_changed',
] as const;
export type ChangeKind = (typeof CHANGE_KIND)[number];

export const COMPATIBILITY_SUITES = ['connection', 'capabilities', 'schemas', 'behaviour'] as const;
export type CompatibilitySuite = (typeof COMPATIBILITY_SUITES)[number];

export const CASE_OUTCOME = ['passed', 'warning', 'failed', 'skipped'] as const;
export type CaseOutcome = (typeof CASE_OUTCOME)[number];
