import { type Page, type Principal } from '@mcp-hub/core';
import type { SearchResult } from '@mcp-hub/search';
import type { AppContext } from '../context.js';
import { requireScope } from '../auth/resolve.js';
import { emit } from './audit.js';

export interface SearchInput {
  text: string;
  types?: Array<'server' | 'tool' | 'resource' | 'prompt'>;
  riskClasses?: string[];
  includePublic?: boolean;
  limit?: number;
  offset?: number;
}

export async function search(
  context: AppContext,
  principal: Principal,
  input: SearchInput,
): Promise<Page<SearchResult> & { provider: string; fuzzyAvailable: boolean }> {
  requireScope(principal, 'servers:read');

  const page = await context.searchProvider.searchAll({
    organizationId: principal.organizationId,
    text: input.text,
    ...(input.types ? { types: input.types } : {}),
    ...(input.riskClasses ? { riskClasses: input.riskClasses } : {}),
    includePublic: input.includePublic ?? true,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
  });

  await emit(context, principal, {
    type: 'search.performed',
    value: page.total ?? page.data.length,
    metadata: { queryLength: input.text.length, types: input.types ?? 'all' },
  });

  return {
    ...page,
    provider: context.searchProvider.name,
    fuzzyAvailable: context.db.capabilities.trigram,
  };
}

export async function suggest(
  context: AppContext,
  principal: Principal,
  prefix: string,
): Promise<string[]> {
  requireScope(principal, 'servers:read');
  return context.searchProvider.suggest(principal.organizationId, prefix, 8);
}

export interface ToolExplorerInput {
  query?: string | null;
  riskClass?: string[];
  serverId?: string | null;
  preferredVersionsOnly?: boolean;
  limit: number;
  offset: number;
}

/**
 * The global tool explorer: tools addressed independently of their server, so
 * that "which of my servers can create an issue?" is one query rather than a
 * tour of every server page.
 */
export async function exploreTools(
  context: AppContext,
  principal: Principal,
  input: ToolExplorerInput,
): Promise<{
  rows: Array<Record<string, unknown>>;
  total: number;
}> {
  requireScope(principal, 'tools:read');
  const { rows, total } = await context.repositories.registry.searchToolsAcrossServers(
    principal.organizationId,
    {
      query: input.query ?? null,
      ...(input.riskClass
        ? { riskClass: input.riskClass as Parameters<typeof context.repositories.registry.searchToolsAcrossServers>[1]['riskClass'] }
        : {}),
      serverId: (input.serverId ?? null) as never,
      preferredVersionsOnly: input.preferredVersionsOnly ?? true,
      limit: input.limit,
      offset: input.offset,
    },
  );

  return {
    total,
    rows: rows.map((tool) => ({
      id: tool.id,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      riskClass: tool.riskOverride ?? tool.riskClass,
      riskReason: tool.riskReason,
      riskOverridden: tool.riskOverride !== null,
      serverId: tool.serverId,
      serverSlug: tool.serverSlug,
      serverName: tool.serverName,
      versionId: tool.versionId,
      version: tool.versionName,
    })),
  };
}
