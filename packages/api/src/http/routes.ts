import { type Id, HubError, normalizeLimit, ruleCatalogueVersion } from '@mcp-hub/core';
import { resolveWindow } from '@mcp-hub/analytics';
import { ruleCatalogue } from '@mcp-hub/validator';
import { suiteCatalogue } from '@mcp-hub/testing';
import { ask } from '@mcp-hub/assistant';
import * as services from '../services/index.js';
import { requireRole, requireScope } from '../auth/resolve.js';
import { json, noContent, type RouteDefinition } from './types.js';
import * as schemas from './schemas.js';
import { parse } from './schemas.js';

/** Reads a required path parameter. */
function param(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (!value) throw HubError.badRequest(`Missing path parameter "${name}".`);
  return value;
}

function listParam(url: URL, name: string): string[] | undefined {
  const values = url.searchParams.getAll(name).flatMap((v) => v.split(','));
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function pageFrom(url: URL): { cursor?: string | undefined; limit: number } {
  return {
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: normalizeLimit(url.searchParams.get('limit')),
  };
}

function windowFrom(url: URL): ReturnType<typeof resolveWindow> {
  return resolveWindow({
    range: url.searchParams.get('range'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
}

export const routes: RouteDefinition[] = [
  // --- meta ---------------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/health',
    public: true,
    summary: 'Liveness and readiness probe',
    handler: async ({ app }) => {
      const started = performance.now();
      await app.db.query('select 1');
      return json({
        status: 'ok',
        version: '0.1.0',
        database: {
          driver: app.db.kind,
          latencyMs: Math.round(performance.now() - started),
          fuzzySearch: app.db.capabilities.trigram,
        },
        auth: app.config.auth.provider,
        assistant: app.llm.name,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/v1/meta/rules',
    summary: 'Validation rule catalogue',
    handler: async () => json({ version: ruleCatalogueVersion, rules: ruleCatalogue() }),
  },
  {
    method: 'GET',
    path: '/api/v1/meta/suites',
    summary: 'Compatibility test catalogue',
    handler: async () => json({ cases: suiteCatalogue() }),
  },

  // --- servers ------------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/servers',
    summary: 'List registered MCP servers',
    handler: async ({ app, principal, request }) => {
      const url = request.url;
      const page = await services.listServers(
        app,
        principal,
        {
          status: listParam(url, 'status') as never,
          visibility: listParam(url, 'visibility') as never,
          healthStatus: listParam(url, 'health') as never,
          category: url.searchParams.get('category'),
          tag: url.searchParams.get('tag'),
          query: url.searchParams.get('q'),
          includeDemo: url.searchParams.get('demo') !== 'false',
          sort: (url.searchParams.get('sort') ?? 'updated') as 'updated' | 'created' | 'name',
        },
        pageFrom(url),
      );
      return json(page);
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers',
    summary: 'Register a new MCP server',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.registerServerSchema, request.body);
      const result = await services.registerServer(app, principal, input);
      return json(result, 201);
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server',
    summary: 'Fetch a server with its current capability surface',
    handler: async ({ app, principal, request }) => {
      const versionId = request.url.searchParams.get('versionId');
      const detail = await services.getServerDetail(
        app,
        principal,
        param(request.params, 'server'),
        versionId as Id<'version'> | null,
      );
      return json(detail);
    },
  },
  {
    method: 'PATCH',
    path: '/api/v1/servers/:server',
    summary: 'Update server metadata',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.updateServerSchema, request.body);
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json(await services.updateServer(app, principal, server.id, input));
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/servers/:server',
    summary: 'Delete a server and everything it owns',
    handler: async ({ app, principal, request }) => {
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      await services.deleteServer(app, principal, server.id);
      return noContent();
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server/tools',
    summary: 'List the tools exposed by a server version',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'tools:read');
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      const versionId = request.url.searchParams.get('versionId') as Id<'version'> | null;
      const detail = await app.repositories.registry.getServerDetail(
        principal.organizationId,
        server.id,
        versionId,
      );
      return json({
        version: detail.latestVersion,
        tools: detail.tools,
        resources: detail.resources,
        prompts: detail.prompts,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server/versions',
    summary: 'List server versions',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'servers:read');
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json({
        versions: await app.repositories.registry.listVersions(principal.organizationId, server.id),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers/:server/versions',
    summary: 'Create a new version',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.createVersionSchema, request.body);
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json(
        await services.createVersion(app, principal, { serverId: server.id, ...input }),
        201,
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers/:server/validate',
    summary: 'Run the validation engine against a server',
    handler: async ({ app, principal, request }) => {
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      const versionId = request.url.searchParams.get('versionId') as Id<'version'> | null;
      return json(await services.runValidation(app, principal, server.id, versionId));
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers/:server/test',
    rateLimit: 'execution',
    summary: 'Run compatibility tests against a live server',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.compatibilitySchema, request.body);
      return json(
        await services.runCompatibilityTests(app, principal, {
          versionId: input.versionId as Id<'version'>,
          environmentId: (input.environmentId ?? null) as Id<'environment'> | null,
          ...(input.suites ? { suites: input.suites } : {}),
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers/:server/health-check',
    rateLimit: 'execution',
    summary: 'Run a health check now',
    handler: async ({ app, principal, request }) => {
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json(await services.runHealthCheck(app, principal, server.id));
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server/health',
    summary: 'Health history, uptime and incidents for a server',
    handler: async ({ app, principal, request }) => {
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      const window = windowFrom(request.url);
      return json(await services.getHealthOverview(app, principal, server.id, window.from));
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server/analytics',
    summary: 'Usage analytics for one server',
    handler: async ({ app, principal, request }) => {
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json(
        await services.getServerAnalytics(app, principal, server.id, windowFrom(request.url)),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server/security',
    summary: 'Security findings for a server',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'servers:read');
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json({
        findings: await app.repositories.governance.listSecurityFindings(principal.organizationId, {
          serverId: server.id,
          limit: 100,
        }),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/v1/servers/:server/environments',
    summary: 'List execution environments for a server',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'servers:read');
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      const [environments, secretKeys] = await Promise.all([
        app.repositories.registry.listEnvironments(principal.organizationId, server.id),
        app.repositories.secrets.listKeys(principal.organizationId, server.id),
      ]);
      // Key names only: credential values never leave the server.
      return json({ environments, secretKeys });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers/:server/environments',
    summary: 'Create an execution environment',
    handler: async ({ app, principal, request }) => {
      requireRole(principal, 'developer');
      const input = parse(schemas.environmentSchema, request.body);
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      return json(
        await app.repositories.registry.createEnvironment({
          organizationId: principal.organizationId,
          serverId: server.id,
          name: input.name,
          description: input.description ?? null,
          transportOverride: input.transportOverride ?? null,
        }),
        201,
      );
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/servers/:server/secrets',
    summary: 'Store an encrypted credential for a server',
    handler: async ({ app, principal, request }) => {
      requireRole(principal, 'admin');
      const input = parse(schemas.secretSchema, request.body);
      const server = await app.repositories.registry.resolveServer(
        principal.organizationId,
        param(request.params, 'server'),
      );
      await services.storeSecret(app, {
        organizationId: principal.organizationId,
        serverId: server.id,
        environmentId: (input.environmentId ?? null) as Id<'environment'> | null,
        key: input.key,
        value: input.value,
        createdBy: principal.userId,
      });
      await services.audit(app, principal, {
        action: 'secret.stored',
        resourceType: 'server',
        resourceId: server.id,
        metadata: { key: input.key },
      });
      return json({ stored: input.key });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/servers/:server/config',
    summary: 'Generate client configuration with credential placeholders',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.configSchema, request.body);
      return json(
        await services.generateConfig(app, principal, {
          versionId: input.versionId as Id<'version'>,
          format: input.format,
          environmentId: (input.environmentId ?? null) as Id<'environment'> | null,
          ...(input.serverKey ? { serverKey: input.serverKey } : {}),
        }),
      );
    },
  },

  // --- versions -----------------------------------------------------------
  {
    method: 'POST',
    path: '/api/v1/versions/:version/discover',
    rateLimit: 'execution',
    summary: 'Connect to the server and record its capability surface',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.discoverSchema, request.body ?? {});
      return json(
        await services.discoverCapabilities(
          app,
          principal,
          param(request.params, 'version') as Id<'version'>,
          { environmentId: (input.environmentId ?? null) as Id<'environment'> | null },
        ),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/versions/:version/publish',
    summary: 'Publish a version, freezing its capability surface',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.publishVersionSchema, request.body ?? {});
      return json(
        await services.publishVersion(
          app,
          principal,
          param(request.params, 'version') as Id<'version'>,
          input,
        ),
      );
    },
  },
  {
    method: 'PATCH',
    path: '/api/v1/versions/:version',
    summary: 'Deprecate a version or mark it recommended',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.versionFlagsSchema, request.body);
      return json(
        await services.setVersionFlags(
          app,
          principal,
          param(request.params, 'version') as Id<'version'>,
          input,
        ),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/versions/:version/compare/:other',
    summary: 'Structured diff between two versions',
    handler: async ({ app, principal, request }) =>
      json(
        await services.compareVersions(
          app,
          principal,
          param(request.params, 'version') as Id<'version'>,
          param(request.params, 'other') as Id<'version'>,
        ),
      ),
  },

  // --- tools & execution --------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/tools',
    summary: 'Search tools across every registered server',
    handler: async ({ app, principal, request }) => {
      const url = request.url;
      const limit = normalizeLimit(url.searchParams.get('limit'));
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
      return json(
        await services.exploreTools(app, principal, {
          query: url.searchParams.get('q'),
          ...(listParam(url, 'risk') ? { riskClass: listParam(url, 'risk') } : {}),
          serverId: url.searchParams.get('serverId'),
          preferredVersionsOnly: url.searchParams.get('allVersions') !== 'true',
          limit,
          offset,
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/tools/preview',
    summary: 'Show what the permission engine would decide, without executing',
    handler: async ({ app, principal, request }) => {
      const input = parse(
        schemas.executeToolSchema.pick({ versionId: true, toolName: true, environmentId: true }),
        request.body,
      );
      return json(
        await services.previewExecution(app, principal, {
          versionId: input.versionId as Id<'version'>,
          toolName: input.toolName,
          environmentId: (input.environmentId ?? null) as Id<'environment'> | null,
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/tools/execute',
    rateLimit: 'execution',
    summary: 'Execute a tool through the permission and approval gates',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.executeToolSchema, request.body);
      const result = await services.executeTool(app, principal, {
        versionId: input.versionId as Id<'version'>,
        toolName: input.toolName,
        arguments: input.arguments ?? {},
        environmentId: (input.environmentId ?? null) as Id<'environment'> | null,
        ...(input.acknowledgeRisk !== undefined ? { acknowledgeRisk: input.acknowledgeRisk } : {}),
        approvalId: (input.approvalId ?? null) as Id<'approval'> | null,
      });
      // A refusal is a 200 with a refusal body only for the playground's
      // benefit; API clients get the proper status code.
      const status = result.status === 'denied' ? 403 : result.status === 'blocked' ? 428 : 200;
      return json(result, status);
    },
  },

  // --- approvals ----------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/approvals',
    summary: 'List approval requests',
    handler: async ({ app, principal, request }) =>
      json({
        approvals: await services.listApprovals(
          app,
          principal,
          listParam(request.url, 'status') as never,
          normalizeLimit(request.url.searchParams.get('limit'), 50),
        ),
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/approvals',
    summary: 'Request approval for a specific tool call',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.requestApprovalSchema, request.body);
      return json(
        await services.requestApproval(app, principal, {
          versionId: input.versionId as Id<'version'>,
          toolName: input.toolName,
          arguments: input.arguments ?? {},
          reason: input.reason ?? null,
        }),
        201,
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/approvals/:approval/decision',
    summary: 'Approve or deny a pending request',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.decideApprovalSchema, request.body);
      return json(
        await services.decideApproval(
          app,
          principal,
          param(request.params, 'approval') as Id<'approval'>,
          input.decision,
          input.reason ?? null,
        ),
      );
    },
  },

  // --- permissions --------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/permissions',
    summary: 'List permission rules',
    handler: async ({ app, principal }) =>
      json({ rules: await services.listRules(app, principal) }),
  },
  {
    method: 'POST',
    path: '/api/v1/permissions',
    summary: 'Create a permission rule',
    handler: async ({ app, principal, request }) =>
      json(
        await services.createRule(
          app,
          principal,
          parse(schemas.permissionRuleSchema, request.body),
        ),
        201,
      ),
  },
  {
    method: 'DELETE',
    path: '/api/v1/permissions/:rule',
    summary: 'Delete a permission rule',
    handler: async ({ app, principal, request }) => {
      await services.deleteRule(app, principal, param(request.params, 'rule'));
      return noContent();
    },
  },
  {
    method: 'POST',
    path: '/api/v1/tools/:tool/risk',
    summary: 'Override a tool risk classification',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.riskOverrideSchema, request.body);
      await services.overrideToolRisk(app, principal, {
        toolId: param(request.params, 'tool'),
        riskClass: input.riskClass,
        reason: input.reason,
      });
      return json({ ok: true });
    },
  },

  // --- discovery ----------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/search',
    summary: 'Search servers, tools, resources and prompts',
    handler: async ({ app, principal, request }) => {
      const url = request.url;
      return json(
        await services.search(app, principal, {
          text: url.searchParams.get('q') ?? '',
          types: listParam(url, 'type') as never,
          ...(listParam(url, 'risk') ? { riskClasses: listParam(url, 'risk') } : {}),
          includePublic: url.searchParams.get('public') !== 'false',
          limit: normalizeLimit(url.searchParams.get('limit')),
          offset: Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/search/suggest',
    summary: 'Autocomplete suggestions',
    handler: async ({ app, principal, request }) =>
      json({
        suggestions: await services.suggest(
          app,
          principal,
          request.url.searchParams.get('q') ?? '',
        ),
      }),
  },

  // --- observability ------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/analytics',
    summary: 'Organization dashboard metrics and series',
    handler: async ({ app, principal, request }) => {
      const window = windowFrom(request.url);
      const dashboard = await services.getDashboard(app, principal, window);
      return json({ ...dashboard, window: { ...window } });
    },
  },
  {
    method: 'GET',
    path: '/api/v1/incidents',
    summary: 'List incidents',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'health:read');
      return json({
        incidents: await app.repositories.governance.listIncidents(principal.organizationId, {
          status: listParam(request.url, 'status') as never,
          limit: normalizeLimit(request.url.searchParams.get('limit'), 50),
        }),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/incidents/:incident/resolve',
    summary: 'Resolve an incident',
    handler: async ({ app, principal, request }) => {
      requireRole(principal, 'developer');
      const incident = await app.repositories.governance.resolveIncident(
        principal.organizationId,
        param(request.params, 'incident') as Id<'incident'>,
      );
      if (!incident)
        throw HubError.notFound('That incident does not exist or is already resolved.');
      await services.audit(app, principal, {
        action: 'incident.resolved',
        resourceType: 'incident',
        resourceId: incident.id,
      });
      return json(incident);
    },
  },
  {
    method: 'GET',
    path: '/api/v1/activity',
    summary: 'Audit log',
    handler: async ({ app, principal, request }) => {
      const url = request.url;
      const since = url.searchParams.get('since');
      return json(
        await services.getActivity(
          app,
          principal,
          {
            action: url.searchParams.get('action'),
            resourceType: url.searchParams.get('resourceType'),
            resourceId: url.searchParams.get('resourceId'),
            result: listParam(url, 'result') as never,
            ...(since ? { since: new Date(since) } : {}),
          },
          pageFrom(url),
        ),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/invocations',
    summary: 'Tool invocation history',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'analytics:read');
      const url = request.url;
      const since = url.searchParams.get('since');
      return json(
        await app.repositories.governance.listInvocations(
          principal.organizationId,
          {
            serverId: url.searchParams.get('serverId') as Id<'server'> | null,
            toolName: url.searchParams.get('tool'),
            status: listParam(url, 'status') as never,
            ...(since ? { since: new Date(since) } : {}),
          },
          pageFrom(url),
        ),
      );
    },
  },

  // --- organization -------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/team',
    summary: 'List organization members and teams',
    handler: async ({ app, principal }) =>
      json({
        members: await services.listMembers(app, principal),
        teams: await services.listTeams(app, principal),
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/team/members',
    summary: 'Add a member to the organization',
    handler: async ({ app, principal, request }) =>
      json(
        await services.addMember(app, principal, parse(schemas.memberSchema, request.body)),
        201,
      ),
  },
  {
    method: 'PATCH',
    path: '/api/v1/team/members/:user',
    summary: 'Change a member role',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.roleChangeSchema, request.body);
      return json(
        await services.changeRole(app, principal, {
          userId: param(request.params, 'user'),
          role: input.role,
        }),
      );
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/team/members/:user',
    summary: 'Remove a member',
    handler: async ({ app, principal, request }) => {
      await services.removeMember(app, principal, param(request.params, 'user'));
      return noContent();
    },
  },
  {
    method: 'POST',
    path: '/api/v1/team/teams',
    summary: 'Create a team',
    handler: async ({ app, principal, request }) =>
      json(await services.createTeam(app, principal, parse(schemas.teamSchema, request.body)), 201),
  },

  // --- API keys -----------------------------------------------------------
  {
    method: 'GET',
    path: '/api/v1/api-keys',
    summary: 'List API keys (never their secrets)',
    handler: async ({ app, principal }) =>
      json({
        keys: (await services.listApiKeys(app, principal)).map((key) => ({
          ...key,
          hash: undefined,
        })),
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/api-keys',
    summary: 'Create an API key; the secret is returned exactly once',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.apiKeySchema, request.body);
      const created = await services.createApiKey(app, principal, input);
      return json(
        { key: { ...created.record, hash: undefined }, plaintext: created.plaintext },
        201,
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/api-keys/:key/rotate',
    summary: 'Revoke a key and issue a replacement',
    handler: async ({ app, principal, request }) => {
      const created = await services.rotateApiKey(
        app,
        principal,
        param(request.params, 'key') as Id<'apiKey'>,
      );
      return json({ key: { ...created.record, hash: undefined }, plaintext: created.plaintext });
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/api-keys/:key',
    summary: 'Revoke an API key',
    handler: async ({ app, principal, request }) => {
      await services.revokeApiKey(app, principal, param(request.params, 'key') as Id<'apiKey'>);
      return noContent();
    },
  },

  // --- import -------------------------------------------------------------
  {
    method: 'POST',
    path: '/api/v1/import/preview',
    summary: 'Parse a client configuration file without registering anything',
    handler: async ({ app, principal, request }) => {
      requireRole(principal, 'developer');
      const input = parse(schemas.importPreviewSchema, request.body);
      const preview = services.previewImport(input.content);
      return json(await services.annotateImport(app, principal, preview));
    },
  },
  {
    method: 'POST',
    path: '/api/v1/import/confirm',
    summary: 'Register the confirmed servers from an import preview',
    handler: async ({ app, principal, request }) => {
      const input = parse(schemas.importConfirmSchema, request.body);
      return json({ imported: await services.confirmImport(app, principal, input) }, 201);
    },
  },

  // --- assistant ----------------------------------------------------------
  {
    method: 'POST',
    path: '/api/v1/assistant',
    rateLimit: 'execution',
    summary: 'Ask a question answered strictly from recorded data',
    handler: async ({ app, principal, request }) => {
      requireScope(principal, 'analytics:read');
      const input = parse(schemas.assistantSchema, request.body);
      const answer = await ask({
        organizationId: principal.organizationId,
        question: input.question,
        repositories: {
          registry: app.repositories.registry,
          governance: app.repositories.governance,
          analytics: app.repositories.analytics,
          search: app.repositories.search,
        },
        provider: app.llm,
        trigram: app.db.capabilities.trigram,
      });
      await services.emit(app, principal, {
        type: 'assistant.answered',
        status: answer.intent,
        value: answer.evidence.length,
      });
      return json(answer);
    },
  },
];
