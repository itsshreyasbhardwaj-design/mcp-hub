import type { Principal } from '@mcp-hub/core';
import type { AppContext } from '../context.js';
import type { AuthenticatedUser } from '../auth/provider.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface HubRequest {
  method: HttpMethod;
  url: URL;
  headers: Headers;
  cookies: Map<string, string>;
  /** Parsed JSON body, or undefined for bodyless requests. */
  body: unknown;
  /** Raw body text, retained for content-length accounting. */
  rawBody: string;
  /** Path parameters extracted by the router. */
  params: Record<string, string>;
  /** Best-effort client address, used for rate-limit keys. */
  ip: string | null;
}

export interface HubResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface RouteContext {
  request: HubRequest;
  app: AppContext;
  principal: Principal;
  requestId: string;
  /**
   * The signed-in account, when the route authenticated a browser session.
   * Absent for API-key callers and for public routes.
   */
  user?: AuthenticatedUser | undefined;
}

export type RouteHandler = (context: RouteContext) => Promise<HubResponse> | HubResponse;

export interface RouteDefinition {
  method: HttpMethod;
  /** Express-style pattern, e.g. `/api/v1/servers/:server/tools`. */
  path: string;
  handler: RouteHandler;
  /** Skips authentication. Used only by /health and the dev sign-in routes. */
  public?: boolean;
  /**
   * Set false for routes a user must reach before they belong to an
   * organization — creating the first one, and reading their own session.
   */
  requiresOrganization?: boolean;
  /** Tightens the rate limit for expensive or dangerous operations. */
  rateLimit?: 'default' | 'execution';
  summary: string;
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): HubResponse {
  return { status, headers, body };
}

export function noContent(): HubResponse {
  return { status: 204, headers: {}, body: null };
}
