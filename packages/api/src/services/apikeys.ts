import {
  type ApiKeyRecord,
  type ApiScope,
  type Id,
  type Principal,
  API_SCOPES,
  HubError,
} from '@mcp-hub/core';
import { generateApiKey } from '@mcp-hub/security';
import type { AppContext } from '../context.js';
import { requireRole, requireUser } from '../auth/resolve.js';
import { audit, emit } from './audit.js';

export interface CreatedApiKey {
  record: ApiKeyRecord;
  /** Returned exactly once. The plaintext is never stored or recoverable. */
  plaintext: string;
}

export async function createApiKey(
  context: AppContext,
  principal: Principal,
  input: { name: string; scopes: string[]; expiresInDays?: number | null },
): Promise<CreatedApiKey> {
  requireRole(principal, 'admin');
  const userId = requireUser(principal);

  const scopes = input.scopes.filter((scope): scope is ApiScope =>
    (API_SCOPES as readonly string[]).includes(scope),
  );
  if (scopes.length === 0) {
    throw HubError.badRequest('At least one valid scope is required.', {
      validScopes: API_SCOPES,
    });
  }
  const invalid = input.scopes.filter(
    (scope) => !(API_SCOPES as readonly string[]).includes(scope),
  );
  if (invalid.length > 0) {
    throw HubError.badRequest(`Unknown scope(s): ${invalid.join(', ')}.`, {
      validScopes: API_SCOPES,
    });
  }

  const generated = generateApiKey();
  const record = await context.repositories.apiKeys.create({
    organizationId: principal.organizationId,
    name: input.name.trim(),
    prefix: generated.prefix,
    hash: generated.hash,
    scopes,
    createdBy: userId,
    expiresAt: input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
  });

  await audit(context, principal, {
    action: 'apikey.created',
    resourceType: 'api_key',
    resourceId: record.id,
    metadata: { name: record.name, scopes, prefix: record.prefix },
  });
  await emit(context, principal, { type: 'apikey.created' });

  return { record, plaintext: generated.plaintext };
}

export async function listApiKeys(
  context: AppContext,
  principal: Principal,
): Promise<ApiKeyRecord[]> {
  requireRole(principal, 'admin');
  return context.repositories.apiKeys.list(principal.organizationId);
}

export async function revokeApiKey(
  context: AppContext,
  principal: Principal,
  keyId: Id<'apiKey'>,
): Promise<void> {
  requireRole(principal, 'admin');
  const revoked = await context.repositories.apiKeys.revoke(principal.organizationId, keyId);
  if (!revoked) throw HubError.notFound('That API key does not exist or is already revoked.');
  await audit(context, principal, {
    action: 'apikey.revoked',
    resourceType: 'api_key',
    resourceId: keyId,
  });
  await emit(context, principal, { type: 'apikey.revoked' });
}

/**
 * Rotation is a revoke plus a create, in that order, so a leaked key stops
 * working even if the caller never receives the replacement.
 */
export async function rotateApiKey(
  context: AppContext,
  principal: Principal,
  keyId: Id<'apiKey'>,
): Promise<CreatedApiKey> {
  requireRole(principal, 'admin');
  const existing = (await context.repositories.apiKeys.list(principal.organizationId)).find(
    (key) => key.id === keyId,
  );
  if (!existing) throw HubError.notFound('That API key does not exist.');

  await context.repositories.apiKeys.revoke(principal.organizationId, keyId);
  return createApiKey(context, principal, {
    name: existing.name,
    scopes: existing.scopes,
    expiresInDays: existing.expiresAt
      ? Math.max(1, Math.ceil((existing.expiresAt.getTime() - Date.now()) / 86_400_000))
      : null,
  });
}
