import { HubError, toApiError } from '@mcp-hub/core';
import { contextLogger, newRequestId, runWithContext } from '@mcp-hub/observability';
import { rateLimitStore } from '@mcp-hub/security';
import { getContext, type AppContext } from '../context.js';
import { resolvePrincipal } from '../auth/resolve.js';
import type { HttpMethod, HubRequest, HubResponse, RouteDefinition } from './types.js';

interface CompiledRoute extends RouteDefinition {
  regex: RegExp;
  paramNames: string[];
}

function compile(route: RouteDefinition): CompiledRoute {
  const paramNames: string[] = [];
  const pattern = route.path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return escapeRegex(segment);
      paramNames.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { ...route, paramNames, regex: new RegExp(`^${pattern}/?$`) };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Router {
  private readonly routes: CompiledRoute[];

  constructor(routes: readonly RouteDefinition[]) {
    this.routes = routes.map(compile);
  }

  /** The route table, published by `GET /api/v1` for discoverability. */
  describe(): Array<{ method: HttpMethod; path: string; summary: string }> {
    return this.routes.map(({ method, path, summary }) => ({ method, path, summary }));
  }

  match(
    method: HttpMethod,
    pathname: string,
  ): { route: CompiledRoute; params: Record<string, string> } | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const match = route.regex.exec(pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? '');
      });
      return { route, params };
    }
    if (pathMatched) {
      throw new HubError('BAD_REQUEST', `Method ${method} is not allowed for this path.`);
    }
    return null;
  }

  /**
   * Runs one request end to end.
   *
   * Every response carries a request id, every error is mapped through the
   * same envelope, and unexpected errors are logged with a stack server-side
   * but reported to the client as a bare INTERNAL.
   */
  async handle(request: HubRequest, appOverride?: AppContext): Promise<HubResponse> {
    const requestId = request.headers.get('x-request-id')?.slice(0, 64) || newRequestId();
    const route = `${request.method} ${request.url.pathname}`;

    return runWithContext({ requestId, route }, async () => {
      const started = performance.now();
      try {
        const matched = this.match(request.method, request.url.pathname);
        if (!matched) {
          throw HubError.notFound(`No route matches ${route}.`);
        }
        const app = appOverride ?? (await getContext());
        const withParams: HubRequest = { ...request, params: matched.params };

        await this.enforceRateLimit(app, withParams, matched.route.rateLimit ?? 'default');

        if (matched.route.public) {
          const response = await matched.route.handler({
            request: withParams,
            app,
            requestId,
            // Public routes never read the principal; a sentinel keeps the
            // handler signature uniform without making it nullable everywhere.
            principal: {
              kind: 'system',
              userId: null,
              organizationId: 'org_public' as never,
              role: 'viewer',
              scopes: [],
              displayName: 'anonymous',
            },
          });
          return finalize(response, requestId, started, route);
        }

        const { principal, authenticated } = await resolvePrincipal(app, withParams, {
          requestedOrganizationId: request.headers.get('x-organization-id'),
          requestedOrganizationSlug: request.headers.get('x-organization-slug'),
          allowWithoutOrganization: matched.route.requiresOrganization === false,
        });

        const response = await matched.route.handler({
          request: withParams,
          app,
          principal,
          requestId,
          user: authenticated,
        });
        return finalize(response, requestId, started, route, principal.organizationId);
      } catch (err) {
        const status = err instanceof HubError ? err.status : 500;
        if (status >= 500) {
          contextLogger().error('Request failed', {
            route,
            status,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        } else {
          contextLogger().info('Request rejected', {
            route,
            status,
            code: err instanceof HubError ? err.code : 'INTERNAL',
          });
        }
        return {
          status,
          headers: { 'x-request-id': requestId, 'content-type': 'application/json' },
          body: toApiError(err, requestId),
        };
      }
    });
  }

  private async enforceRateLimit(
    app: AppContext,
    request: HubRequest,
    kind: 'default' | 'execution',
  ): Promise<void> {
    const identity =
      request.headers.get('authorization')?.slice(-16) ??
      request.cookies.get('mcp_hub_session')?.slice(-16) ??
      request.ip ??
      'anonymous';
    const limit =
      kind === 'execution'
        ? app.config.rateLimit.maxToolExecutions
        : app.config.rateLimit.maxRequests;
    const decision = await rateLimitStore.hit(
      `${kind}:${identity}`,
      app.config.rateLimit.windowMs,
      limit,
    );
    if (!decision.allowed) {
      throw new HubError('RATE_LIMITED', 'Too many requests. Slow down and try again.', {
        details: { limit: decision.limit, resetAt: new Date(decision.resetAt).toISOString() },
      });
    }
  }
}

function finalize(
  response: HubResponse,
  requestId: string,
  started: number,
  route: string,
  organizationId?: string,
): HubResponse {
  const durationMs = Math.round(performance.now() - started);
  contextLogger().info('Request completed', {
    route,
    status: response.status,
    durationMs,
    ...(organizationId ? { organizationId } : {}),
  });
  return {
    ...response,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      'x-response-time': `${durationMs}ms`,
      ...response.headers,
    },
  };
}
