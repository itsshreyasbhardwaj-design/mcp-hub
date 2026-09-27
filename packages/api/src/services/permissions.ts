import {
  type PermissionEffect,
  type PermissionRuleRecord,
  type Principal,
  type RiskClass,
  HubError,
  PERMISSION_EFFECTS,
  RISK_CLASSES,
} from '@mcp-hub/core';
import { summarizeForSubject } from '@mcp-hub/permissions';
import type { AppContext } from '../context.js';
import { requireRole, requireScope } from '../auth/resolve.js';
import { audit } from './audit.js';

export interface CreateRuleInput {
  effect: PermissionEffect;
  subjectUserId?: string | null;
  subjectRole?: string | null;
  serverId?: string | null;
  versionId?: string | null;
  toolName?: string | null;
  riskClass?: RiskClass | null;
  environmentId?: string | null;
  priority?: number;
  description?: string | null;
}

export async function listRules(
  context: AppContext,
  principal: Principal,
): Promise<PermissionRuleRecord[]> {
  requireScope(principal, 'servers:read');
  return context.repositories.governance.listPermissionRules(principal.organizationId);
}

export async function createRule(
  context: AppContext,
  principal: Principal,
  input: CreateRuleInput,
): Promise<PermissionRuleRecord> {
  requireRole(principal, 'admin');
  if (!PERMISSION_EFFECTS.includes(input.effect)) {
    throw HubError.badRequest(`Unknown effect "${input.effect}".`, {
      validEffects: PERMISSION_EFFECTS,
    });
  }
  if (input.riskClass && !RISK_CLASSES.includes(input.riskClass)) {
    throw HubError.badRequest(`Unknown risk class "${input.riskClass}".`, {
      validRiskClasses: RISK_CLASSES,
    });
  }

  const rule = await context.repositories.governance.createPermissionRule({
    organizationId: principal.organizationId,
    effect: input.effect,
    subjectUserId: (input.subjectUserId ?? null) as PermissionRuleRecord['subjectUserId'],
    subjectRole: input.subjectRole ?? null,
    serverId: (input.serverId ?? null) as PermissionRuleRecord['serverId'],
    versionId: (input.versionId ?? null) as PermissionRuleRecord['versionId'],
    toolName: input.toolName ?? null,
    riskClass: input.riskClass ?? null,
    environmentId: (input.environmentId ?? null) as PermissionRuleRecord['environmentId'],
    priority: input.priority ?? 0,
    description: input.description ?? null,
    createdBy: principal.userId,
  });

  await audit(context, principal, {
    action: 'permission.rule-created',
    resourceType: 'permission_rule',
    resourceId: rule.id,
    metadata: {
      effect: rule.effect,
      toolName: rule.toolName,
      riskClass: rule.riskClass,
      serverId: rule.serverId,
    },
  });
  return rule;
}

export async function deleteRule(
  context: AppContext,
  principal: Principal,
  ruleId: string,
): Promise<void> {
  requireRole(principal, 'admin');
  const deleted = await context.repositories.governance.deletePermissionRule(
    principal.organizationId,
    ruleId as PermissionRuleRecord['id'],
  );
  if (!deleted) throw HubError.notFound('That permission rule does not exist.');
  await audit(context, principal, {
    action: 'permission.rule-deleted',
    resourceType: 'permission_rule',
    resourceId: ruleId,
  });
}

/**
 * Overriding a classification is a governance decision, so the override, its
 * author, its reason and the original heuristic verdict are all retained.
 */
export async function overrideToolRisk(
  context: AppContext,
  principal: Principal,
  input: { toolId: string; riskClass: RiskClass | null; reason: string },
): Promise<void> {
  requireRole(principal, 'admin');
  if (!principal.userId) {
    throw HubError.forbidden('Risk overrides must be recorded against a user, not an API key.');
  }
  if (input.riskClass && !RISK_CLASSES.includes(input.riskClass)) {
    throw HubError.badRequest(`Unknown risk class "${input.riskClass}".`);
  }
  if (input.reason.trim().length < 5) {
    throw HubError.badRequest('Give a reason for the override; it is stored with the decision.');
  }

  const tool = await context.repositories.registry.overrideToolRisk(
    principal.organizationId,
    input.toolId as Parameters<typeof context.repositories.registry.overrideToolRisk>[1],
    { riskClass: input.riskClass, reason: input.reason.trim(), reviewer: principal.userId },
  );

  await audit(context, principal, {
    action: 'risk.overridden',
    resourceType: 'tool',
    resourceId: tool.id,
    metadata: {
      toolName: tool.name,
      heuristic: tool.riskClass,
      override: input.riskClass,
      reason: input.reason.trim(),
    },
  });
}

/** "What can this person actually run?" for the permissions preview panel. */
export async function previewForSubject(
  context: AppContext,
  principal: Principal,
  subjectUserId: string | null,
): Promise<{ allowed: string[]; requiresApproval: string[]; denied: string[] }> {
  requireRole(principal, 'admin');
  const rules = await context.repositories.governance.listPermissionRules(principal.organizationId);
  const { rows } = await context.repositories.registry.searchToolsAcrossServers(
    principal.organizationId,
    { preferredVersionsOnly: true, limit: 200, offset: 0 },
  );

  const membership = subjectUserId
    ? await context.repositories.identity.findMembership(
        principal.organizationId,
        subjectUserId as Parameters<typeof context.repositories.identity.findMembership>[1],
      )
    : null;

  return summarizeForSubject(
    {
      userId: (subjectUserId ?? principal.userId) as Parameters<
        typeof summarizeForSubject
      >[0]['userId'],
      role: membership?.role ?? principal.role,
      scopes: ['tools:execute'],
    },
    rows.map((tool) => ({
      serverId: tool.serverId,
      versionId: tool.versionId,
      name: tool.name,
      riskClass: tool.riskOverride ?? tool.riskClass,
    })),
    rules,
  );
}
