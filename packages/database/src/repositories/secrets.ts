import { type Id, HubError, newId } from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface StoredSecret extends EncryptedSecret {
  id: string;
  key: string;
}

/**
 * Credential storage. Rows only ever contain AES-256-GCM ciphertext; the key
 * lives in MCP_HUB_ENCRYPTION_KEY. Nothing in this class returns plaintext —
 * decryption happens in `@mcp-hub/security` and only inside the execution path.
 */
export class SecretRepository {
  constructor(private readonly db: SqlExecutor) {}

  async put(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    environmentId: Id<'environment'> | null;
    key: string;
    encrypted: EncryptedSecret;
    createdBy: Id<'user'> | null;
  }): Promise<void> {
    await this.db.query(
      `insert into server_secrets (
         id, organization_id, server_id, environment_id, key, ciphertext, iv, auth_tag, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (server_id, coalesce(environment_id, ''), key) do update
         set ciphertext = excluded.ciphertext,
             iv = excluded.iv,
             auth_tag = excluded.auth_tag,
             updated_at = now()`,
      [
        newId('secret'),
        input.organizationId,
        input.serverId,
        input.environmentId,
        input.key,
        input.encrypted.ciphertext,
        input.encrypted.iv,
        input.encrypted.authTag,
        input.createdBy,
      ],
    );
  }

  /** Returns ciphertext for every secret bound to a server/environment pair. */
  async listEncrypted(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    environmentId: Id<'environment'> | null,
  ): Promise<StoredSecret[]> {
    const { rows } = await this.db.query(
      `select id, key, ciphertext, iv, auth_tag from server_secrets
        where organization_id = $1 and server_id = $2
          and (environment_id is not distinct from $3 or environment_id is null)
        order by key asc`,
      [organizationId, serverId, environmentId],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      key: String(row['key']),
      ciphertext: String(row['ciphertext']),
      iv: String(row['iv']),
      authTag: String(row['auth_tag']),
    }));
  }

  /** Key names only — safe to send to the browser. */
  async listKeys(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
  ): Promise<Array<{ key: string; environmentId: string | null }>> {
    const { rows } = await this.db.query(
      `select key, environment_id from server_secrets
        where organization_id = $1 and server_id = $2 order by key asc`,
      [organizationId, serverId],
    );
    return rows.map((row) => ({
      key: String(row['key']),
      environmentId: (row['environment_id'] as string | null) ?? null,
    }));
  }

  async remove(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    environmentId: Id<'environment'> | null,
    key: string,
  ): Promise<boolean> {
    const result = await this.db.query(
      `delete from server_secrets
        where organization_id = $1 and server_id = $2
          and environment_id is not distinct from $3 and key = $4`,
      [organizationId, serverId, environmentId, key],
    );
    if (result.rowCount === 0) {
      throw HubError.notFound('No stored credential with that key.', { key });
    }
    return true;
  }
}
