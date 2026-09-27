import type { Id } from '@mcp-hub/core';
import {
  promptDocument,
  resourceDocument,
  serverDocument,
  toolDocument,
  type IndexDocument,
} from '@mcp-hub/search';
import type { AppContext } from '../context.js';

/**
 * Rebuilds the search index for one server.
 *
 * Indexing is a projection of the registry, so it is always rebuilt from the
 * current rows rather than patched incrementally — a stale index is a silent
 * failure, and correctness here is worth the extra writes.
 */
export async function reindexServer(
  context: AppContext,
  organizationId: Id<'organization'>,
  serverId: Id<'server'>,
): Promise<number> {
  const server = await context.repositories.registry.findServerById(organizationId, serverId);
  if (!server) {
    await context.searchProvider.removeServer(serverId);
    return 0;
  }

  const documents: IndexDocument[] = [serverDocument(server)];
  const version = await context.repositories.registry.findPreferredVersion(
    organizationId,
    serverId,
  );

  await context.searchProvider.removeServer(serverId);

  if (version) {
    const [tools, resources, prompts] = await Promise.all([
      context.repositories.registry.listTools(organizationId, version.id),
      context.repositories.registry.listResources(organizationId, version.id),
      context.repositories.registry.listPrompts(organizationId, version.id),
    ]);
    for (const tool of tools) documents.push(toolDocument(tool, server));
    for (const resource of resources) documents.push(resourceDocument(resource, server));
    for (const prompt of prompts) documents.push(promptDocument(prompt, server));
  }

  await context.searchProvider.index(documents);
  return documents.length;
}

/** Rebuilds the whole index for an organization. Used by the worker. */
export async function reindexOrganization(
  context: AppContext,
  organizationId: Id<'organization'>,
): Promise<{ servers: number; documents: number }> {
  let cursor: string | undefined;
  let servers = 0;
  let documents = 0;
  for (;;) {
    const page = await context.repositories.registry.listServers(
      organizationId,
      {},
      { limit: 50, ...(cursor ? { cursor } : {}) },
    );
    for (const server of page.data) {
      documents += await reindexServer(context, organizationId, server.id);
      servers += 1;
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { servers, documents };
}
