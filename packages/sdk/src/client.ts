import { errorFromResponse, McpHubError, RateLimitError } from './errors.js';
import type * as T from './types.js';

export interface McpHubOptions {
  /** API key created in Settings → API. Never a user session token. */
  apiKey: string;
  /** Defaults to https://localhost:3000 for local development. */
  baseUrl?: string;
  /** Act inside a specific organization when the key spans several. */
  organizationId?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Retries for transient failures (429, 502, 503, 504). Default 2. */
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  body?: unknown;
  /** Retries are unsafe for non-idempotent calls unless explicitly allowed. */
  retryable?: boolean;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * The MCP Hub API client.
 *
 * Retries are deliberately conservative: GET requests retry on transient
 * status codes with exponential backoff, and mutations do not retry unless a
 * call opts in, because replaying a tool execution is not safe by default.
 */
export class MCPHub {
  readonly servers: ServersResource;
  readonly versions: VersionsResource;
  readonly tools: ToolsResource;
  readonly validation: ValidationResource;
  readonly testing: TestingResource;
  readonly health: HealthResource;
  readonly approvals: ApprovalsResource;
  readonly permissions: PermissionsResource;
  readonly analytics: AnalyticsResource;
  readonly search: SearchResource;
  readonly apiKeys: ApiKeysResource;
  readonly assistant: AssistantResource;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly organizationId: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;

  constructor(options: McpHubOptions) {
    if (!options.apiKey) {
      throw new McpHubError({
        code: 'UNAUTHENTICATED',
        message: 'An API key is required. Create one in Settings → API.',
        status: 401,
      });
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
    this.organizationId = options.organizationId;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = options.userAgent ?? '@mcp-hub/sdk/0.1.0';

    this.servers = new ServersResource(this);
    this.versions = new VersionsResource(this);
    this.tools = new ToolsResource(this);
    this.validation = new ValidationResource(this);
    this.testing = new TestingResource(this);
    this.health = new HealthResource(this);
    this.approvals = new ApprovalsResource(this);
    this.permissions = new PermissionsResource(this);
    this.analytics = new AnalyticsResource(this);
    this.search = new SearchResource(this);
    this.apiKeys = new ApiKeysResource(this);
    this.assistant = new AssistantResource(this);
  }

  /** Escape hatch for endpoints the typed resources do not cover yet. */
  async request<TResult>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<TResult> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const retryable = options.retryable ?? method === 'GET';
    let lastError: unknown;

    for (let attempt = 0; attempt <= (retryable ? this.maxRetries : 0); attempt += 1) {
      if (attempt > 0) await sleep(Math.min(250 * 2 ** (attempt - 1), 4000));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': this.userAgent,
            ...(this.organizationId ? { 'x-organization-id': this.organizationId } : {}),
          },
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
          signal: controller.signal,
        });

        const requestId = response.headers.get('x-request-id');
        if (response.status === 204) return undefined as TResult;

        const text = await response.text();
        const payload: unknown = text.length > 0 ? safeParse(text) : null;

        if (!response.ok) {
          const error = errorFromResponse(response.status, payload, requestId);
          if (retryable && RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
            lastError = error;
            continue;
          }
          throw error;
        }
        return payload as TResult;
      } catch (err) {
        if (err instanceof McpHubError && !(err instanceof RateLimitError)) throw err;
        lastError = err;
        if (err instanceof Error && err.name === 'AbortError' && !options.signal?.aborted) {
          lastError = new McpHubError({
            code: 'UPSTREAM_TIMEOUT',
            message: `The request timed out after ${this.timeoutMs}ms.`,
            status: 504,
          });
        }
        if (attempt >= (retryable ? this.maxRetries : 0)) break;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof McpHubError
      ? lastError
      : new McpHubError({
          code: 'UPSTREAM_ERROR',
          message: lastError instanceof Error ? lastError.message : 'The request failed.',
          status: 502,
        });
  }

  /**
   * Walks every page of a cursor-paginated endpoint.
   *
   * ```ts
   * for await (const server of hub.paginate((cursor) => hub.servers.list({ cursor }))) {
   *   console.log(server.slug);
   * }
   * ```
   */
  async *paginate<TItem>(
    fetchPage: (cursor?: string) => Promise<T.Page<TItem>>,
  ): AsyncGenerator<TItem, void, undefined> {
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchPage(cursor);
      for (const item of page.data) yield item;
      if (!page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: 'INTERNAL', message: 'The response was not valid JSON.' } };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

abstract class Resource {
  constructor(protected readonly hub: MCPHub) {}
}

export class ServersResource extends Resource {
  list(options: {
    cursor?: string;
    limit?: number;
    status?: T.ServerStatus[];
    health?: T.HealthStatus[];
    tag?: string;
    q?: string;
  } = {}): Promise<T.Page<T.McpServer>> {
    return this.hub.request('GET', '/api/v1/servers', { query: { ...options } });
  }

  get(idOrSlug: string, versionId?: string): Promise<T.ServerDetail> {
    return this.hub.request('GET', `/api/v1/servers/${encodeURIComponent(idOrSlug)}`, {
      query: versionId ? { versionId } : {},
    });
  }

  create(input: {
    name: string;
    slug?: string;
    description?: string;
    tags?: string[];
    visibility?: T.Visibility;
    status?: T.ServerStatus;
    version?: { version: string; transport: T.Transport; environment?: T.EnvironmentRequirement[] };
  }): Promise<{ server: T.McpServer; versionId: string | null }> {
    return this.hub.request('POST', '/api/v1/servers', { body: input });
  }

  update(idOrSlug: string, patch: Partial<{ name: string; description: string; tags: string[]; status: T.ServerStatus; visibility: T.Visibility }>): Promise<T.McpServer> {
    return this.hub.request('PATCH', `/api/v1/servers/${encodeURIComponent(idOrSlug)}`, { body: patch });
  }

  delete(idOrSlug: string): Promise<void> {
    return this.hub.request('DELETE', `/api/v1/servers/${encodeURIComponent(idOrSlug)}`);
  }

  listTools(idOrSlug: string, versionId?: string): Promise<{ version: T.ServerVersion | null; tools: T.Tool[] }> {
    return this.hub.request('GET', `/api/v1/servers/${encodeURIComponent(idOrSlug)}/tools`, {
      query: versionId ? { versionId } : {},
    });
  }

  listVersions(idOrSlug: string): Promise<{ versions: T.ServerVersion[] }> {
    return this.hub.request('GET', `/api/v1/servers/${encodeURIComponent(idOrSlug)}/versions`);
  }

  createVersion(
    idOrSlug: string,
    input: { version: string; transport: T.Transport; environment?: T.EnvironmentRequirement[]; releaseNotes?: string },
  ): Promise<T.ServerVersion> {
    return this.hub.request('POST', `/api/v1/servers/${encodeURIComponent(idOrSlug)}/versions`, {
      body: input,
    });
  }

  generateConfig(
    idOrSlug: string,
    input: { versionId: string; format: 'claude-desktop' | 'mcp-json' | 'env' | 'vscode' | 'raw' },
  ): Promise<T.GeneratedConfig> {
    return this.hub.request('POST', `/api/v1/servers/${encodeURIComponent(idOrSlug)}/config`, {
      body: input,
    });
  }
}

export class VersionsResource extends Resource {
  discover(versionId: string, environmentId?: string): Promise<{ toolCount: number; resourceCount: number; promptCount: number; protocolVersion: string | null }> {
    return this.hub.request('POST', `/api/v1/versions/${versionId}/discover`, {
      body: { environmentId: environmentId ?? null },
    });
  }

  publish(versionId: string, markRecommended = true): Promise<{ version: T.ServerVersion; diff: T.VersionDiff | null }> {
    return this.hub.request('POST', `/api/v1/versions/${versionId}/publish`, {
      body: { markRecommended },
    });
  }

  update(versionId: string, flags: { deprecated?: boolean; recommended?: boolean }): Promise<T.ServerVersion> {
    return this.hub.request('PATCH', `/api/v1/versions/${versionId}`, { body: flags });
  }

  compare(fromVersionId: string, toVersionId: string): Promise<T.VersionDiff> {
    return this.hub.request('GET', `/api/v1/versions/${fromVersionId}/compare/${toVersionId}`);
  }
}

export class ToolsResource extends Resource {
  list(options: { q?: string; risk?: T.RiskClass[]; serverId?: string; limit?: number; offset?: number } = {}): Promise<{
    rows: Array<T.Tool & { serverSlug: string; serverName: string; version: string }>;
    total: number;
  }> {
    return this.hub.request('GET', '/api/v1/tools', { query: { ...options } });
  }

  /** Shows what the permission engine would decide, without executing. */
  preview(input: { versionId: string; toolName: string; environmentId?: string }): Promise<{
    riskClass: T.RiskClass;
    decision: { effect: T.PermissionEffect; reason: string; source: string };
    requiresAcknowledgement: boolean;
  }> {
    return this.hub.request('POST', '/api/v1/tools/preview', { body: input });
  }

  /**
   * Executes a tool. Never retried automatically: a repeated destructive call
   * is worse than a failed one.
   */
  execute(input: {
    versionId: string;
    toolName: string;
    arguments?: unknown;
    environmentId?: string;
    acknowledgeRisk?: boolean;
    approvalId?: string;
  }): Promise<T.ExecutionResult> {
    return this.hub.request('POST', '/api/v1/tools/execute', { body: input, retryable: false });
  }

  overrideRisk(toolId: string, input: { riskClass: T.RiskClass | null; reason: string }): Promise<void> {
    return this.hub.request('POST', `/api/v1/tools/${toolId}/risk`, { body: input });
  }
}

export class ValidationResource extends Resource {
  run(serverIdOrSlug: string, versionId?: string): Promise<T.ValidationRun> {
    return this.hub.request('POST', `/api/v1/servers/${encodeURIComponent(serverIdOrSlug)}/validate`, {
      query: versionId ? { versionId } : {},
    });
  }

  rules(): Promise<{ version: string; rules: Array<{ id: string; title: string; severity: T.Severity }> }> {
    return this.hub.request('GET', '/api/v1/meta/rules');
  }
}

export class TestingResource extends Resource {
  run(serverIdOrSlug: string, input: { versionId: string; suites?: string[]; environmentId?: string }): Promise<T.CompatibilityRun> {
    return this.hub.request('POST', `/api/v1/servers/${encodeURIComponent(serverIdOrSlug)}/test`, {
      body: input,
      retryable: false,
    });
  }

  catalogue(): Promise<{ cases: Array<{ suite: string; key: string; title: string; rationale: string }> }> {
    return this.hub.request('GET', '/api/v1/meta/suites');
  }
}

export class HealthResource extends Resource {
  check(serverIdOrSlug: string): Promise<{ status: T.HealthStatus; incidentsOpened: number }> {
    return this.hub.request('POST', `/api/v1/servers/${encodeURIComponent(serverIdOrSlug)}/health-check`, {
      retryable: false,
    });
  }

  history(serverIdOrSlug: string, range: '24h' | '7d' | '30d' | '90d' = '24h'): Promise<{
    summary: { checks: number; uptimePercent: number | null; p95LatencyMs: number | null };
    checks: Array<{ status: T.HealthStatus; latencyMs: number | null; checkedAt: string }>;
    incidents: T.Incident[];
  }> {
    return this.hub.request('GET', `/api/v1/servers/${encodeURIComponent(serverIdOrSlug)}/health`, {
      query: { range },
    });
  }

  incidents(status?: Array<'investigating' | 'ongoing' | 'resolved'>): Promise<{ incidents: T.Incident[] }> {
    return this.hub.request('GET', '/api/v1/incidents', { query: { status } });
  }

  status(): Promise<{ status: string; version: string; database: { driver: string; latencyMs: number } }> {
    return this.hub.request('GET', '/api/v1/health');
  }
}

export class ApprovalsResource extends Resource {
  list(status?: Array<'pending' | 'approved' | 'denied' | 'expired' | 'consumed'>): Promise<{ approvals: T.Approval[] }> {
    return this.hub.request('GET', '/api/v1/approvals', { query: { status } });
  }

  request(input: { versionId: string; toolName: string; arguments?: unknown; reason?: string }): Promise<T.Approval> {
    return this.hub.request('POST', '/api/v1/approvals', { body: input, retryable: false });
  }

  decide(approvalId: string, decision: 'approved' | 'denied', reason?: string): Promise<T.Approval> {
    return this.hub.request('POST', `/api/v1/approvals/${approvalId}/decision`, {
      body: { decision, reason: reason ?? null },
      retryable: false,
    });
  }
}

export class PermissionsResource extends Resource {
  list(): Promise<{ rules: Array<{ id: string; effect: T.PermissionEffect; toolName: string | null; riskClass: T.RiskClass | null; priority: number; description: string | null }> }> {
    return this.hub.request('GET', '/api/v1/permissions');
  }

  create(input: {
    effect: T.PermissionEffect;
    subjectUserId?: string | null;
    subjectRole?: string | null;
    serverId?: string | null;
    toolName?: string | null;
    riskClass?: T.RiskClass | null;
    priority?: number;
    description?: string;
  }): Promise<{ id: string }> {
    return this.hub.request('POST', '/api/v1/permissions', { body: input });
  }

  delete(ruleId: string): Promise<void> {
    return this.hub.request('DELETE', `/api/v1/permissions/${ruleId}`);
  }
}

export class AnalyticsResource extends Resource {
  overview(range: '24h' | '7d' | '30d' | '90d' = '24h'): Promise<T.DashboardMetrics> {
    return this.hub.request('GET', '/api/v1/analytics', { query: { range } });
  }

  server(serverIdOrSlug: string, range: '24h' | '7d' | '30d' | '90d' = '7d'): Promise<Record<string, unknown>> {
    return this.hub.request('GET', `/api/v1/servers/${encodeURIComponent(serverIdOrSlug)}/analytics`, {
      query: { range },
    });
  }

  activity(options: { cursor?: string; limit?: number; action?: string } = {}): Promise<T.Page<Record<string, unknown>>> {
    return this.hub.request('GET', '/api/v1/activity', { query: { ...options } });
  }

  invocations(options: { cursor?: string; limit?: number; serverId?: string; tool?: string } = {}): Promise<T.Page<Record<string, unknown>>> {
    return this.hub.request('GET', '/api/v1/invocations', { query: { ...options } });
  }
}

export class SearchResource extends Resource {
  query(text: string, options: { type?: Array<'server' | 'tool' | 'resource' | 'prompt'>; limit?: number; offset?: number } = {}): Promise<T.Page<T.SearchHit> & { provider: string; fuzzyAvailable: boolean }> {
    return this.hub.request('GET', '/api/v1/search', { query: { q: text, ...options } });
  }

  suggest(prefix: string): Promise<{ suggestions: string[] }> {
    return this.hub.request('GET', '/api/v1/search/suggest', { query: { q: prefix } });
  }
}

export class ApiKeysResource extends Resource {
  list(): Promise<{ keys: Array<{ id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null }> }> {
    return this.hub.request('GET', '/api/v1/api-keys');
  }

  /** The plaintext key is returned exactly once and cannot be recovered. */
  create(input: { name: string; scopes: string[]; expiresInDays?: number }): Promise<{ key: { id: string; prefix: string }; plaintext: string }> {
    return this.hub.request('POST', '/api/v1/api-keys', { body: input, retryable: false });
  }

  revoke(keyId: string): Promise<void> {
    return this.hub.request('DELETE', `/api/v1/api-keys/${keyId}`);
  }
}

export class AssistantResource extends Resource {
  ask(question: string): Promise<T.AssistantAnswer> {
    return this.hub.request('POST', '/api/v1/assistant', { body: { question }, retryable: false });
  }
}
