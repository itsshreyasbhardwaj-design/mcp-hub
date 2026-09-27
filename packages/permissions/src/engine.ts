import {
  type Id,
  type OrgRole,
  type PermissionEffect,
  type PermissionRuleRecord,
  type RiskClass,
  SENSITIVE_RISK_CLASSES,
  roleAtLeast,
} from '@mcp-hub/core';

export interface PermissionSubject {
  userId: Id<'user'> | null;
  role: OrgRole;
  /** Present when the caller authenticated with an API key. */
  apiKeyId?: Id<'apiKey'> | null;
  scopes: readonly string[];
}

export interface PermissionRequest {
  subject: PermissionSubject;
  serverId: Id<'server'>;
  versionId: Id<'version'>;
  toolName: string;
  riskClass: RiskClass;
  environmentId?: Id<'environment'> | null;
}

export interface PermissionDecision {
  effect: PermissionEffect;
  /** The rule that decided it, or null when the default policy applied. */
  matchedRule: PermissionRuleRecord | null;
  /** Why this effect was chosen, in plain language, for the UI and audit log. */
  reason: string;
  /** Everything that matched, so an admin can debug an unexpected outcome. */
  evaluated: Array<{ ruleId: string; effect: PermissionEffect; specificity: number }>;
  source: 'rule' | 'default-policy' | 'role' | 'scope';
}

/**
 * The permission engine.
 *
 * Every tool execution passes through `evaluate`, server-side. The frontend
 * hides controls a user cannot use, but nothing in the browser is trusted:
 * the same decision is recomputed in the API before any MCP traffic happens.
 *
 * Resolution order:
 *   1. A caller without the `tools:execute` scope is denied outright.
 *   2. A viewer is denied execution regardless of rules.
 *   3. The most specific matching rule wins. Ties are broken by explicit
 *      priority, then by effect severity (deny > require_approval > allow).
 *   4. With no matching rule, the default policy applies: sensitive risk
 *      classes require approval, everything else is allowed.
 */
export function evaluate(
  request: PermissionRequest,
  rules: readonly PermissionRuleRecord[],
): PermissionDecision {
  if (!request.subject.scopes.includes('tools:execute') && !request.subject.scopes.includes('admin')) {
    return {
      effect: 'deny',
      matchedRule: null,
      reason: 'The credential used for this request does not carry the tools:execute scope.',
      evaluated: [],
      source: 'scope',
    };
  }

  if (!roleAtLeast(request.subject.role, 'developer')) {
    return {
      effect: 'deny',
      matchedRule: null,
      reason: `Role "${request.subject.role}" cannot execute tools. Developer or above is required.`,
      evaluated: [],
      source: 'role',
    };
  }

  const matches = rules
    .map((rule) => ({ rule, specificity: matchSpecificity(rule, request) }))
    .filter((entry): entry is { rule: PermissionRuleRecord; specificity: number } => entry.specificity >= 0)
    .sort(
      (a, b) =>
        b.specificity - a.specificity ||
        b.rule.priority - a.rule.priority ||
        effectSeverity(b.rule.effect) - effectSeverity(a.rule.effect),
    );

  const evaluated = matches.map((m) => ({
    ruleId: m.rule.id,
    effect: m.rule.effect,
    specificity: m.specificity,
  }));

  const winner = matches[0];
  if (winner) {
    return {
      effect: winner.rule.effect,
      matchedRule: winner.rule,
      reason:
        winner.rule.description?.trim() ||
        `Matched rule ${winner.rule.id} (${describeScope(winner.rule)}).`,
      evaluated,
      source: 'rule',
    };
  }

  const sensitive = SENSITIVE_RISK_CLASSES.includes(request.riskClass);
  return {
    effect: sensitive ? 'require_approval' : 'allow',
    matchedRule: null,
    reason: sensitive
      ? `No rule matched. "${request.toolName}" is classified ${request.riskClass}, which requires approval by default.`
      : `No rule matched. "${request.toolName}" is classified ${request.riskClass}, which is allowed by default.`,
    evaluated,
    source: 'default-policy',
  };
}

/**
 * Scores how specifically a rule targets the request.
 * Returns -1 when the rule does not apply at all.
 */
export function matchSpecificity(
  rule: PermissionRuleRecord,
  request: PermissionRequest,
): number {
  let score = 0;

  if (rule.subjectUserId !== null) {
    if (rule.subjectUserId !== request.subject.userId) return -1;
    score += 16;
  }
  if (rule.subjectRole !== null) {
    if (rule.subjectRole !== request.subject.role) return -1;
    score += 4;
  }
  if (rule.toolName !== null) {
    if (!toolNameMatches(rule.toolName, request.toolName)) return -1;
    score += rule.toolName.includes('*') ? 8 : 16;
  }
  if (rule.versionId !== null) {
    if (rule.versionId !== request.versionId) return -1;
    score += 8;
  }
  if (rule.serverId !== null) {
    if (rule.serverId !== request.serverId) return -1;
    score += 4;
  }
  if (rule.environmentId !== null) {
    if (rule.environmentId !== (request.environmentId ?? null)) return -1;
    score += 4;
  }
  if (rule.riskClass !== null) {
    if (rule.riskClass !== request.riskClass) return -1;
    score += 2;
  }
  return score;
}

/** Supports a single trailing wildcard, e.g. `github.*` or `delete_*`. */
function toolNameMatches(pattern: string, toolName: string): boolean {
  if (!pattern.includes('*')) return pattern === toolName;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '\u0000' : `\\${c}`));
  const regex = new RegExp(`^${escaped.replaceAll('\u0000', '.*')}$`);
  return regex.test(toolName);
}

function effectSeverity(effect: PermissionEffect): number {
  return effect === 'deny' ? 2 : effect === 'require_approval' ? 1 : 0;
}

function describeScope(rule: PermissionRuleRecord): string {
  const parts: string[] = [];
  if (rule.subjectUserId) parts.push('a specific user');
  if (rule.subjectRole) parts.push(`role ${rule.subjectRole}`);
  if (rule.serverId) parts.push('a specific server');
  if (rule.versionId) parts.push('a specific version');
  if (rule.toolName) parts.push(`tool ${rule.toolName}`);
  if (rule.riskClass) parts.push(`risk ${rule.riskClass}`);
  if (rule.environmentId) parts.push('a specific environment');
  return parts.length > 0 ? parts.join(', ') : 'the whole organization';
}

/**
 * Summarises what a subject may do with a set of tools. Powers the
 * "Allowed / Requires approval / Denied" panel without running a live check
 * per tool.
 */
export function summarizeForSubject(
  subject: PermissionSubject,
  tools: ReadonlyArray<{ serverId: Id<'server'>; versionId: Id<'version'>; name: string; riskClass: RiskClass }>,
  rules: readonly PermissionRuleRecord[],
): { allowed: string[]; requiresApproval: string[]; denied: string[] } {
  const allowed: string[] = [];
  const requiresApproval: string[] = [];
  const denied: string[] = [];

  for (const tool of tools) {
    const decision = evaluate(
      {
        subject,
        serverId: tool.serverId,
        versionId: tool.versionId,
        toolName: tool.name,
        riskClass: tool.riskClass,
      },
      rules,
    );
    if (decision.effect === 'allow') allowed.push(tool.name);
    else if (decision.effect === 'require_approval') requiresApproval.push(tool.name);
    else denied.push(tool.name);
  }

  return { allowed, requiresApproval, denied };
}
