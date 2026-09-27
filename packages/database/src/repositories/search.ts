import { type Id, type Visibility, newId } from '@mcp-hub/core';
import type { SqlDriver, SqlExecutor } from '../driver.js';
import { Params, WhereBuilder } from '../sqlutil.js';

export type SearchDocType = 'server' | 'tool' | 'resource' | 'prompt';

export interface SearchDocumentInput {
  organizationId: Id<'organization'>;
  docType: SearchDocType;
  entityId: string;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  visibility: Visibility;
  title: string;
  subtitle: string | null;
  body: string;
  tags: string[];
  riskClass: string | null;
}

export interface SearchHitRow {
  docType: SearchDocType;
  entityId: string;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  title: string;
  subtitle: string | null;
  body: string;
  tags: string[];
  riskClass: string | null;
  /** Combined relevance score. Higher is better. */
  score: number;
  /** Which strategy produced the hit, surfaced in the UI for transparency. */
  matchKind: 'exact' | 'prefix' | 'fulltext' | 'fuzzy';
}

/**
 * Persistence for the denormalised search index. Ranking strategy lives in
 * `@mcp-hub/search`; this class only knows how to store and query rows.
 */
export class SearchRepository {
  constructor(private readonly db: SqlExecutor) {}

  async upsert(doc: SearchDocumentInput): Promise<void> {
    await this.db.query(
      `insert into search_documents (
         id, organization_id, doc_type, entity_id, server_id, version_id, visibility,
         title, subtitle, body, tags, risk_class, tsv, updated_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8::text,$9::text,$10::text,$11::text[],$12,
         setweight(to_tsvector('english', coalesce($8::text, '')), 'A') ||
         setweight(to_tsvector('english', coalesce($9::text, '')), 'B') ||
         setweight(to_tsvector('english', coalesce($10::text, '')), 'C') ||
         setweight(to_tsvector('english', array_to_string($11::text[], ' ')), 'B'),
         now()
       )
       on conflict (doc_type, entity_id) do update set
         organization_id = excluded.organization_id,
         server_id = excluded.server_id,
         version_id = excluded.version_id,
         visibility = excluded.visibility,
         title = excluded.title,
         subtitle = excluded.subtitle,
         body = excluded.body,
         tags = excluded.tags,
         risk_class = excluded.risk_class,
         tsv = excluded.tsv,
         updated_at = now()`,
      [
        newId('searchDoc'),
        doc.organizationId,
        doc.docType,
        doc.entityId,
        doc.serverId,
        doc.versionId,
        doc.visibility,
        doc.title,
        doc.subtitle,
        doc.body,
        doc.tags,
        doc.riskClass,
      ],
    );
  }

  async deleteByServer(serverId: Id<'server'>): Promise<void> {
    await this.db.query('delete from search_documents where server_id = $1', [serverId]);
  }

  async deleteByVersion(versionId: Id<'version'>): Promise<void> {
    await this.db.query('delete from search_documents where version_id = $1', [versionId]);
  }

  async deleteEntity(docType: SearchDocType, entityId: string): Promise<void> {
    await this.db.query('delete from search_documents where doc_type = $1 and entity_id = $2', [
      docType,
      entityId,
    ]);
  }

  async count(organizationId: Id<'organization'>): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      'select count(*)::int as count from search_documents where organization_id = $1',
      [organizationId],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Runs exact, prefix, full-text and (when pg_trgm is available) trigram
   * fuzzy matching in a single statement, keeping the best score per document.
   */
  async search(options: {
    organizationId: Id<'organization'>;
    query: string;
    docTypes?: SearchDocType[];
    riskClasses?: string[];
    /** Also match public documents owned by other organizations. */
    includePublic: boolean;
    limit: number;
    offset: number;
    trigram: boolean;
  }): Promise<{ hits: SearchHitRow[]; total: number }> {
    const params = new Params();
    const org = params.add(options.organizationId);
    const raw = options.query.trim();
    const q = params.add(raw);
    const prefix = params.add(`${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const tsQuery = params.add(toTsQuery(raw));

    const scope = new WhereBuilder(params);
    scope.and(
      options.includePublic
        ? `(organization_id = ${org} or visibility = 'public')`
        : `organization_id = ${org}`,
    );
    scope.in('doc_type', options.docTypes);
    scope.in('risk_class', options.riskClasses);

    const fuzzyScore = options.trigram ? `similarity(lower(title), lower(${q}))` : '0';
    const fuzzyPredicate = options.trigram ? `similarity(lower(title), lower(${q})) > 0.3` : 'false';

    const limitParam = params.add(options.limit);
    const offsetParam = params.add(options.offset);

    const sql = `
      with scored as (
        select
          doc_type, entity_id, server_id, version_id, title, subtitle, body, tags, risk_class,
          case
            when lower(title) = lower(${q}) then 1.0
            when lower(title) like lower(${prefix}) then 0.75
            else 0
          end as lexical_score,
          case when ${tsQuery} = '' then 0
               else ts_rank(tsv, to_tsquery('english', ${tsQuery})) end as text_score,
          ${fuzzyScore} as fuzzy_score
        from search_documents
        ${scope.sql}
      ),
      ranked as (
        select *,
          greatest(lexical_score, text_score * 2.0, fuzzy_score * 0.6) as score,
          case
            when lexical_score = 1.0 then 'exact'
            when lexical_score = 0.75 then 'prefix'
            when text_score > 0 then 'fulltext'
            else 'fuzzy'
          end as match_kind
        from scored
        where lexical_score > 0 or text_score > 0 or ${fuzzyPredicate}
      )
      select *, count(*) over ()::int as total_count
        from ranked
       order by score desc, title asc
       limit ${limitParam} offset ${offsetParam}`;

    const { rows } = await this.db.query<Record<string, unknown>>(sql, params.all);
    return {
      hits: rows.map((row) => ({
        docType: row['doc_type'] as SearchDocType,
        entityId: String(row['entity_id']),
        serverId: String(row['server_id']) as Id<'server'>,
        versionId: (row['version_id'] as Id<'version'> | null) ?? null,
        title: String(row['title']),
        subtitle: (row['subtitle'] as string | null) ?? null,
        body: String(row['body'] ?? ''),
        tags: Array.isArray(row['tags']) ? (row['tags'] as string[]) : [],
        riskClass: (row['risk_class'] as string | null) ?? null,
        score: Number(row['score'] ?? 0),
        matchKind: row['match_kind'] as SearchHitRow['matchKind'],
      })),
      total: rows[0] ? Number(rows[0]['total_count'] ?? rows.length) : 0,
    };
  }

  /** Autocomplete suggestions from indexed titles. */
  async suggest(
    organizationId: Id<'organization'>,
    query: string,
    limit: number,
  ): Promise<Array<{ title: string; docType: SearchDocType; entityId: string; serverId: string }>> {
    const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { rows } = await this.db.query(
      `select distinct on (title) title, doc_type, entity_id, server_id
         from search_documents
        where organization_id = $1 and lower(title) like lower($2)
        order by title asc
        limit $3`,
      [organizationId, `${escaped}%`, limit],
    );
    return rows.map((row) => ({
      title: String(row['title']),
      docType: row['doc_type'] as SearchDocType,
      entityId: String(row['entity_id']),
      serverId: String(row['server_id']),
    }));
  }
}

/**
 * Builds a safe `to_tsquery` expression. User input is never passed raw:
 * each term is stripped to word characters and joined with `&`, with the
 * final term made a prefix match so search-as-you-type works.
 */
export function toTsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return '';
  return terms.map((term, index) => (index === terms.length - 1 ? `${term}:*` : term)).join(' & ');
}

export function searchCapabilities(driver: SqlDriver): { trigram: boolean } {
  return driver.capabilities;
}
