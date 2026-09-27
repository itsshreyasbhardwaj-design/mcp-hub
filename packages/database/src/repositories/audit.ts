import {
  type ApiKeyRecord,
  type ApiScope,
  type AuditLogRecord,
  type Id,
  type Page,
  type PageRequest,
  HubError,
  decodeCursor,
  encodeCursor,
  newId,
} from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';
import { Params, WhereBuilder } from '../sqlutil.js';
import { toApiKey, toAuditLog } from '../rows.js';

export interface AuditEntryInput {
  organizationId: Id<'organization'>;
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: 'allowed' | 'denied' | 'error';
  requestId: string;
  metadata?: Record<string, unknown>;
}

export class AuditRepository {
  constructor(private readonly db: SqlExecutor) {}

  async record(input: AuditEntryInput): Promise<AuditLogRecord> {
    const { rows } = await this.db.query(
      `insert into audit_logs (
         id, organization_id, actor_type, actor_id, actor_label, action,
         resource_type, resource_id, result, request_id, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [
        newId('auditLog'),
        input.organizationId,
        input.actorType,
        input.actorId,
        input.actorLabel,
        input.action,
        input.resourceType,
        input.resourceId,
        input.result,
        input.requestId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to write audit log.');
    return toAuditLog(row);
  }

  async list(
    organizationId: Id<'organization'>,
    filter: {
      action?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
      actorId?: string | null;
      result?: Array<'allowed' | 'denied' | 'error'>;
      since?: Date;
    },
    page: PageRequest,
  ): Promise<Page<AuditLogRecord>> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.eq('action', filter.action ?? undefined);
    where.eq('resource_type', filter.resourceType ?? undefined);
    where.eq('resource_id', filter.resourceId ?? undefined);
    where.eq('actor_id', filter.actorId ?? undefined);
    where.in('result', filter.result);
    where.gte('created_at', filter.since);
    if (page.cursor) {
      const { sortValue, id } = decodeCursor(page.cursor);
      where.and(`(created_at, id) < (${params.add(new Date(sortValue))}, ${params.add(id)})`);
    }
    const limitParam = params.add(page.limit + 1);
    const { rows } = await this.db.query(
      `select * from audit_logs ${where.sql} order by created_at desc, id desc limit ${limitParam}`,
      params.all,
    );
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit).map(toAuditLog);
    const last = data[data.length - 1];
    return { data, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }
}

export class ApiKeyRepository {
  constructor(private readonly db: SqlExecutor) {}

  async create(input: {
    organizationId: Id<'organization'>;
    name: string;
    prefix: string;
    hash: string;
    scopes: ApiScope[];
    createdBy: Id<'user'> | null;
    expiresAt: Date | null;
  }): Promise<ApiKeyRecord> {
    const { rows } = await this.db.query(
      `insert into api_keys (id, organization_id, name, prefix, hash, scopes, created_by, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        newId('apiKey'),
        input.organizationId,
        input.name,
        input.prefix,
        input.hash,
        input.scopes,
        input.createdBy,
        input.expiresAt,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to create API key.');
    return toApiKey(row);
  }

  /** Lookup by hash — the plaintext key is never stored or compared. */
  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    const { rows } = await this.db.query('select * from api_keys where hash = $1', [hash]);
    return rows[0] ? toApiKey(rows[0]) : null;
  }

  async list(organizationId: Id<'organization'>): Promise<ApiKeyRecord[]> {
    const { rows } = await this.db.query(
      'select * from api_keys where organization_id = $1 order by created_at desc',
      [organizationId],
    );
    return rows.map(toApiKey);
  }

  async revoke(organizationId: Id<'organization'>, keyId: Id<'apiKey'>): Promise<boolean> {
    const result = await this.db.query(
      `update api_keys set revoked_at = now()
        where organization_id = $1 and id = $2 and revoked_at is null`,
      [organizationId, keyId],
    );
    return result.rowCount > 0;
  }

  async touch(keyId: Id<'apiKey'>): Promise<void> {
    await this.db.query('update api_keys set last_used_at = now() where id = $1', [keyId]);
  }
}
