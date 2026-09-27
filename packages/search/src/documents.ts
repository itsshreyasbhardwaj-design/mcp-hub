import type { McpServerRecord, PromptRecord, ResourceRecord, ToolRecord } from '@mcp-hub/core';
import { effectiveRisk } from '@mcp-hub/core';
import type { IndexDocument } from './provider.js';

/**
 * Projects registry records into search documents.
 *
 * Body text is assembled from the fields a human would actually search on, so
 * that a query like "create an issue on github" finds `github.create_issue`
 * through the tool's own description rather than through the server name.
 */
export function serverDocument(server: McpServerRecord): IndexDocument {
  return {
    organizationId: server.organizationId,
    type: 'server',
    entityId: server.id,
    serverId: server.id,
    versionId: null,
    visibility: server.visibility,
    title: server.name,
    subtitle: server.category,
    body: [server.description ?? '', server.slug, server.maintainer ?? '', server.license ?? '']
      .filter(Boolean)
      .join(' · '),
    tags: server.tags,
    riskClass: null,
  };
}

export function toolDocument(tool: ToolRecord, server: McpServerRecord): IndexDocument {
  const schemaFields = Object.keys(
    (tool.inputSchema['properties'] as Record<string, unknown> | undefined) ?? {},
  );
  return {
    organizationId: tool.organizationId,
    type: 'tool',
    entityId: tool.id,
    serverId: tool.serverId,
    versionId: tool.versionId,
    visibility: server.visibility,
    title: tool.name,
    subtitle: `${server.name} · ${tool.title ?? tool.name}`,
    body: [tool.description ?? '', schemaFields.join(' '), server.name, server.slug]
      .filter(Boolean)
      .join(' · '),
    tags: server.tags,
    riskClass: effectiveRisk(tool),
  };
}

export function resourceDocument(resource: ResourceRecord, server: McpServerRecord): IndexDocument {
  return {
    organizationId: resource.organizationId,
    type: 'resource',
    entityId: resource.id,
    serverId: resource.serverId,
    versionId: resource.versionId,
    visibility: server.visibility,
    title: resource.name ?? resource.uri,
    subtitle: server.name,
    body: [resource.description ?? '', resource.uri, resource.mimeType ?? '']
      .filter(Boolean)
      .join(' · '),
    tags: server.tags,
    riskClass: null,
  };
}

export function promptDocument(prompt: PromptRecord, server: McpServerRecord): IndexDocument {
  return {
    organizationId: prompt.organizationId,
    type: 'prompt',
    entityId: prompt.id,
    serverId: prompt.serverId,
    versionId: prompt.versionId,
    visibility: server.visibility,
    title: prompt.name,
    subtitle: server.name,
    body: [prompt.description ?? '', prompt.arguments.map((a) => a.name).join(' ')]
      .filter(Boolean)
      .join(' · '),
    tags: server.tags,
    riskClass: null,
  };
}
