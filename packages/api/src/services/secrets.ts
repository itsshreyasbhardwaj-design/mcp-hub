import { type Id, HubError } from '@mcp-hub/core';
import { decryptSecret, encryptSecret } from '@mcp-hub/security';
import type { AppContext } from '../context.js';

/**
 * Resolves the credential values a transport needs.
 *
 * Decryption happens here and nowhere else, and the result never leaves the
 * execution path: it goes straight into the child process environment or the
 * outbound request headers. No API response ever contains a decrypted value.
 */
export async function resolveSecrets(
  context: AppContext,
  organizationId: Id<'organization'>,
  serverId: Id<'server'>,
  environmentId: Id<'environment'> | null,
): Promise<Record<string, string>> {
  const stored = await context.repositories.secrets.listEncrypted(
    organizationId,
    serverId,
    environmentId,
  );
  const out: Record<string, string> = {};
  for (const secret of stored) {
    out[secret.key] = decryptSecret(
      { ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag },
      context.config.security.encryptionKey,
    );
  }
  return out;
}

export async function storeSecret(
  context: AppContext,
  input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    environmentId: Id<'environment'> | null;
    key: string;
    value: string;
    createdBy: Id<'user'> | null;
  },
): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(input.key)) {
    throw HubError.badRequest(
      'A credential key must be a valid environment-variable or header name.',
      { key: input.key },
    );
  }
  if (input.value.length === 0) {
    throw HubError.badRequest('A credential value cannot be empty.');
  }
  await context.repositories.secrets.put({
    organizationId: input.organizationId,
    serverId: input.serverId,
    environmentId: input.environmentId,
    key: input.key,
    encrypted: encryptSecret(input.value, context.config.security.encryptionKey),
    createdBy: input.createdBy,
  });
}
