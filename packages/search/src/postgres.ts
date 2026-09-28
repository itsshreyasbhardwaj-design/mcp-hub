import { type Id, type Page, truncate } from '@mcp-hub/core';
import { type SearchRepository, type SearchHitRow } from '@mcp-hub/database';
import type {
  IndexDocument,
  SearchEntityType,
  SearchProvider,
  SearchQuery,
  SearchResult,
} from './provider.js';

const DEFAULT_LIMIT = 20;

/**
 * PostgreSQL-backed search.
 *
 * Four strategies run in one statement and the best score per document wins:
 * exact title match, title prefix, weighted `tsvector` full text, and
 * trigram similarity for typos. Trigram matching depends on `pg_trgm`; when
 * the extension is unavailable the provider reports that and the other three
 * strategies still apply, rather than silently returning worse results.
 */
export class PostgresSearchProvider implements SearchProvider {
  readonly name = 'postgres';

  constructor(
    private readonly repository: SearchRepository,
    private readonly capabilities: { trigram: boolean },
  ) {}

  get supportsFuzzy(): boolean {
    return this.capabilities.trigram;
  }

  async searchServers(query: SearchQuery): Promise<Page<SearchResult>> {
    return this.run({ ...query, types: ['server'] });
  }

  async searchTools(query: SearchQuery): Promise<Page<SearchResult>> {
    return this.run({ ...query, types: ['tool'] });
  }

  async searchAll(query: SearchQuery): Promise<Page<SearchResult>> {
    return this.run(query);
  }

  private async run(query: SearchQuery): Promise<Page<SearchResult>> {
    const text = query.text.trim();
    if (text.length === 0) return { data: [], nextCursor: null, total: 0 };

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 100);
    const offset = query.offset ?? 0;
    const { hits, total } = await this.repository.search({
      organizationId: query.organizationId,
      query: text,
      ...(query.types ? { docTypes: query.types } : {}),
      ...(query.riskClasses ? { riskClasses: query.riskClasses } : {}),
      includePublic: query.includePublic ?? false,
      limit,
      offset,
      trigram: this.capabilities.trigram,
    });

    return {
      data: hits.map((hit) => toResult(hit, text)),
      nextCursor: offset + hits.length < total ? String(offset + limit) : null,
      total,
    };
  }

  async suggest(organizationId: Id<'organization'>, prefix: string, limit = 8): Promise<string[]> {
    if (prefix.trim().length === 0) return [];
    const rows = await this.repository.suggest(organizationId, prefix.trim(), limit);
    return [...new Set(rows.map((row) => row.title))];
  }

  async index(documents: readonly IndexDocument[]): Promise<void> {
    for (const document of documents) {
      await this.repository.upsert({
        organizationId: document.organizationId,
        docType: document.type,
        entityId: document.entityId,
        serverId: document.serverId,
        versionId: document.versionId,
        visibility: document.visibility,
        title: document.title,
        subtitle: document.subtitle,
        body: document.body,
        tags: document.tags,
        riskClass: document.riskClass,
      });
    }
  }

  async removeServer(serverId: Id<'server'>): Promise<void> {
    await this.repository.deleteByServer(serverId);
  }

  async removeVersion(versionId: Id<'version'>): Promise<void> {
    await this.repository.deleteByVersion(versionId);
  }
}

function toResult(hit: SearchHitRow, query: string): SearchResult {
  return {
    type: hit.docType as SearchEntityType,
    entityId: hit.entityId,
    serverId: hit.serverId,
    versionId: hit.versionId,
    title: hit.title,
    subtitle: hit.subtitle,
    snippet: snippetAround(hit.body || hit.subtitle || '', query),
    tags: hit.tags,
    riskClass: hit.riskClass,
    score: Math.round(hit.score * 1000) / 1000,
    matchKind: hit.matchKind,
  };
}

/** Extracts a short window of body text around the first query term. */
export function snippetAround(body: string, query: string, width = 160): string {
  if (!body) return '';
  const firstTerm = query
    .split(/\s+/)
    .find((t) => t.length > 2)
    ?.toLowerCase();
  if (!firstTerm) return truncate(body, width);
  const index = body.toLowerCase().indexOf(firstTerm);
  if (index === -1) return truncate(body, width);
  const start = Math.max(0, index - Math.floor(width / 3));
  return `${start > 0 ? '…' : ''}${truncate(body.slice(start), width)}`;
}
