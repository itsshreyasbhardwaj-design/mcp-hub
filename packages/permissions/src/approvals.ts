import {
  type ApprovalRecord,
  type RiskClass,
  HubError,
  stableStringify,
  sha256,
} from '@mcp-hub/core';

/** Approvals expire so a stale grant cannot be replayed weeks later. */
export const DEFAULT_APPROVAL_TTL_MS = 60 * 60 * 1000;

/**
 * Binds an approval to the exact arguments it was granted for.
 *
 * Without this, an approval for `delete_branch({branch: "tmp"})` could be
 * replayed against `delete_branch({branch: "main"})`. The hash is over a
 * key-sorted serialisation, so argument ordering cannot be used to evade it.
 */
export function hashArguments(args: unknown): string {
  return sha256(stableStringify(args ?? {}));
}

export interface ApprovalCheck {
  status: 'not-required' | 'satisfied' | 'required';
  approval: ApprovalRecord | null;
  reason: string;
}

export function evaluateApproval(options: {
  required: boolean;
  approval: ApprovalRecord | null;
  expectedArgumentsHash: string;
  toolName: string;
  now?: Date;
}): ApprovalCheck {
  if (!options.required) {
    return {
      status: 'not-required',
      approval: null,
      reason: 'The permission engine allowed this call.',
    };
  }

  const approval = options.approval;
  if (!approval) {
    return {
      status: 'required',
      approval: null,
      reason: `"${options.toolName}" requires approval and no approved request matches these arguments.`,
    };
  }

  const now = options.now ?? new Date();
  if (approval.status !== 'approved') {
    return {
      status: 'required',
      approval,
      reason: `The matching approval is ${approval.status}, not approved.`,
    };
  }
  if (approval.consumedAt) {
    return {
      status: 'required',
      approval,
      reason: 'That approval has already been used. Approvals authorise a single execution.',
    };
  }
  if (approval.expiresAt.getTime() <= now.getTime()) {
    return { status: 'required', approval, reason: 'That approval has expired.' };
  }
  if (approval.argumentsHash !== options.expectedArgumentsHash) {
    return {
      status: 'required',
      approval,
      reason: 'The approval was granted for different arguments.',
    };
  }

  return {
    status: 'satisfied',
    approval,
    reason: `Approved by ${approval.decidedBy ?? 'an administrator'}.`,
  };
}

/** An approver may not approve their own request. */
export function assertCanDecide(approval: ApprovalRecord, deciderUserId: string): void {
  if (approval.requestedBy === deciderUserId) {
    throw HubError.forbidden(
      'You cannot decide your own approval request. Ask another administrator to review it.',
      { approvalId: approval.id },
    );
  }
}

export function approvalTtlFor(riskClass: RiskClass): number {
  // The more dangerous the tool, the shorter the window in which the grant is usable.
  switch (riskClass) {
    case 'DESTRUCTIVE':
    case 'ADMIN':
      return 15 * 60 * 1000;
    case 'CREDENTIAL':
      return 30 * 60 * 1000;
    default:
      return DEFAULT_APPROVAL_TTL_MS;
  }
}
