import { type Id, newSecret, sha256 } from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';

export interface SessionRecord {
  id: string;
  userId: Id<'user'>;
  expiresAt: Date;
}

/**
 * Sessions for the local development auth provider. Only the SHA-256 of the
 * cookie value is stored, so a database dump cannot be replayed as a login.
 * Unused when MCP_HUB_AUTH_PROVIDER=clerk.
 */
export class SessionRepository {
  constructor(private readonly db: SqlExecutor) {}

  async create(userId: Id<'user'>, ttlMs: number): Promise<{ token: string; expiresAt: Date }> {
    const token = newSecret(32);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.db.query(
      'insert into auth_sessions (id, token_hash, user_id, expires_at) values ($1,$2,$3,$4)',
      [`sess_${sha256(token).slice(0, 24)}`, sha256(token), userId, expiresAt],
    );
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<SessionRecord | null> {
    const { rows } = await this.db.query(
      'select * from auth_sessions where token_hash = $1 and expires_at > now()',
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row['id']),
      userId: String(row['user_id']) as Id<'user'>,
      expiresAt:
        row['expires_at'] instanceof Date ? row['expires_at'] : new Date(String(row['expires_at'])),
    };
  }

  async destroy(token: string): Promise<void> {
    await this.db.query('delete from auth_sessions where token_hash = $1', [sha256(token)]);
  }

  async purgeExpired(): Promise<number> {
    const result = await this.db.query('delete from auth_sessions where expires_at <= now()');
    return result.rowCount;
  }
}
