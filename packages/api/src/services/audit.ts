import { type EventType, type Id, type Principal } from '@mcp-hub/core';
import { currentRequestId } from '@mcp-hub/observability';
import type { AppContext } from '../context.js';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result?: 'allowed' | 'denied' | 'error';
  metadata?: Record<string, unknown>;
}

/**
 * Writes one audit row per meaningful action.
 *
 * Auditing is best-effort with respect to the caller: a failure to write the
 * log is reported but never fails the user's request, because losing a write
 * is worse than losing its record. Denials are audited too — the interesting
 * security events are the ones that did *not* happen.
 */
export async function audit(
  context: AppContext,
  principal: Principal,
  input: AuditInput,
): Promise<void> {
  try {
    await context.repositories.audit.record({
      organizationId: principal.organizationId,
      actorType: principal.kind,
      actorId: principal.userId ?? principal.apiKeyId ?? null,
      actorLabel: principal.displayName,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      result: input.result ?? 'allowed',
      requestId: currentRequestId(),
      metadata: input.metadata ?? {},
    });
  } catch {
    // Swallowed deliberately; see the note above.
  }
}

export interface EventInput {
  type: EventType;
  serverId?: Id<'server'> | null;
  versionId?: Id<'version'> | null;
  toolName?: string | null;
  environmentId?: Id<'environment'> | null;
  value?: number | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
}

/** Records the analytics fact behind a dashboard number. */
export async function emit(
  context: AppContext,
  principal: Principal,
  input: EventInput,
): Promise<void> {
  try {
    await context.repositories.analytics.record({
      organizationId: principal.organizationId,
      type: input.type,
      serverId: input.serverId ?? null,
      versionId: input.versionId ?? null,
      toolName: input.toolName ?? null,
      environmentId: input.environmentId ?? null,
      actorUserId: principal.userId,
      value: input.value ?? null,
      status: input.status ?? null,
      metadata: input.metadata ?? {},
    });
  } catch {
    // Same reasoning as audit(): analytics must not break the request path.
  }
}
