import type { Id, Page } from '@mcp-hub/core';

export type SearchEntityType = 'server' | 'tool' | 'resource' | 'prompt';

export interface SearchQuery {
  organizationId: Id<'organization'>;
  text: string;
  types?: SearchEntityType[];
  riskClasses?: string[];
  /** Include public servers owned by other organizations. */
  includePublic?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  type: SearchEntityType;
  entityId: string;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  title: string;
  subtitle: string | null;
  snippet: string;
  tags: string[];
  riskClass: string | null;
  score: number;
  /** Which matching strategy produced the hit. Surfaced in the UI. */
  matchKind: 'exact' | 'prefix' | 'fulltext' | 'fuzzy';
}

export interface IndexDocument {
  organizationId: Id<'organization'>;
  type: SearchEntityType;
  entityId: string;
  serverId: Id<'server'>;
  versionId: Id<'version'> | null;
  visibility: 'public' | 'organization' | 'private';
  title: string;
  subtitle: string | null;
  body: string;
  tags: string[];
  riskClass: string | null;
}

/**
 * The search seam.
 *
 * PostgreSQL full-text search is the shipped implementation and is sufficient
 * well past the registry sizes this product targets. The interface exists so
 * that a deployment can move to a dedicated engine without touching any
 * calling code — not because a second engine is planned.
 */
export interface SearchProvider {
  readonly name: string;
  searchServers(query: SearchQuery): Promise<Page<SearchResult>>;
  searchTools(query: SearchQuery): Promise<Page<SearchResult>>;
  searchAll(query: SearchQuery): Promise<Page<SearchResult>>;
  suggest(organizationId: Id<'organization'>, prefix: string, limit?: number): Promise<string[]>;
  index(documents: readonly IndexDocument[]): Promise<void>;
  removeServer(serverId: Id<'server'>): Promise<void>;
  removeVersion(versionId: Id<'version'>): Promise<void>;
}
