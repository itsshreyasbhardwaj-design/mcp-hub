import {
  type ApprovalRecord,
  type ApprovalStatus,
  type Id,
  type Principal,
  HubError,
  effectiveRisk,
} from '@mcp-hub/core';
import { approvalTtlFor, assertCanDecide, hashArguments } from '@mcp-hub/permissions';
import type { AppContext } from '../context.js';
import { requireRole, requireScope, requireUser } from '../auth/resolve.js';
import { audit, emit } from './audit.js';

export interface RequestApprovalInput {
  versionId: Id<'version'>;
  toolName: string;
  arguments: unknown;
  reason?: string | null;
}

/**
 * Opens an approval request for a specific call.
 *
 * The request captures the exact arguments and their hash. A decision
 * therefore authorises one payload, not a tool — which is the difference
 * between approving `delete_branch({branch:"tmp"})` and handing out the
 * ability to delete any branch.
 */
export async function requestApproval(
  context: AppContext,
  principal: Principal,
  input: RequestApprovalInput,
): Promise<ApprovalRecord> {
  requireScope(principal, 'tools:execute');
  const userId = requireUser(principal);

  const version = await context.repositories.registry.findVersionById(
    principal.organizationId,
    input.versionId,
  );
  if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');

  const tool = await context.repositories.registry.findTool(
    principal.organizationId,
    input.versionId,
    input.toolName,
  );
  if (!tool) throw new HubError('TOOL_NOT_FOUND', 'That tool does not exist on this version.');

  const riskClass = effectiveRisk(tool);
  const approval = await context.repositories.governance.createApproval({
    organizationId: principal.organizationId,
    serverId: version.serverId,
    versionId: version.id,
    toolName: tool.name,
    riskClass,
    argumentsJson: (input.arguments ?? {}) as Record<string, unknown>,
    argumentsHash: hashArguments(input.arguments),
    reason: input.reason ?? null,
    requestedBy: userId,
    expiresAt: new Date(Date.now() + approvalTtlFor(riskClass)),
  });

  await audit(context, principal, {
    action: 'approval.requested',
    resourceType: 'approval',
    resourceId: approval.id,
    metadata: { toolName: tool.name, riskClass, expiresAt: approval.expiresAt.toISOString() },
  });
  await emit(context, principal, {
    type: 'approval.requested',
    serverId: version.serverId,
    versionId: version.id,
    toolName: tool.name,
    status: riskClass,
  });

  return approval;
}

export async function decideApproval(
  context: AppContext,
  principal: Principal,
  approvalId: Id<'approval'>,
  decision: 'approved' | 'denied',
  reason?: string | null,
): Promise<ApprovalRecord> {
  requireRole(principal, 'admin');
  const userId = requireUser(principal);

  const existing = await context.repositories.governance.findApproval(
    principal.organizationId,
    approvalId,
  );
  if (!existing) throw HubError.notFound('That approval request does not exist.');
  assertCanDecide(existing, userId);

  const updated = await context.repositories.governance.decideApproval({
    organizationId: principal.organizationId,
    approvalId,
    decision,
    decidedBy: userId,
    reason: reason ?? null,
  });

  await audit(context, principal, {
    action: 'approval.decided',
    resourceType: 'approval',
    resourceId: approvalId,
    result: decision === 'approved' ? 'allowed' : 'denied',
    metadata: {
      decision,
      toolName: updated.toolName,
      riskClass: updated.riskClass,
      requestedBy: updated.requestedBy,
    },
  });
  await emit(context, principal, {
    type: 'approval.decided',
    serverId: updated.serverId,
    versionId: updated.versionId,
    toolName: updated.toolName,
    status: decision,
  });

  return updated;
}

export async function listApprovals(
  context: AppContext,
  principal: Principal,
  status: ApprovalStatus[] | undefined,
  limit: number,
): Promise<ApprovalRecord[]> {
  requireScope(principal, 'servers:read');
  return context.repositories.governance.listApprovals(principal.organizationId, {
    ...(status ? { status } : {}),
    limit,
  });
}
