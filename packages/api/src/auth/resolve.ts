import {
  type ApiScope,
  type Id,
  type OrgRole,
  type Principal,
  HubError,
  scopesForRole,
} from '@mcp-hub/core';
import { hashApiKey, API_KEY_PREFIX } from '@mcp-hub/security';
import type { AppContext } from '../context.js';
import type { AuthProvider, AuthRequest, AuthenticatedUser } from './provider.js';
import { DevAuthProvider } from './dev.js';
import { ClerkAuthProvider } from './clerk.js';

export function createAuthProvider(context: AppContext): AuthProvider {
  if (context.config.auth.provider === 'clerk') {
    return new ClerkAuthProvider(
      context.repositories.identity,
      context.config.auth.clerkSecretKey ?? '',
    );
  }
  return new DevAuthProvider(
    context.repositories.identity,
    context.repositories.sessions,
    context.config.nodeEnv === 'production',
  );
}

export interface ResolvedAuth {
  principal: Principal;
  /** Present for browser sessions; absent for API-key callers. */
  authenticated?: AuthenticatedUser;
}

export interface ResolveOptions {
  /** Organization the caller asked to act in, from a header or path. */
  requestedOrganizationId?: string | null;
  requestedOrganizationSlug?: string | null;
  /**
   * Permits a signed-in account that belongs to no organization yet. Only the
   * session and organization-creation routes set this.
   */
  allowWithoutOrganization?: boolean;
}

/**
 * Establishes who is calling and in which organization.
 *
 * API keys are checked first because they carry their own organization and
 * scopes. Everything downstream receives a `Principal` and never sees a raw
 * header again — which is what keeps tenant scoping in one place.
 */
export async function resolvePrincipal(
  context: AppContext,
  request: AuthRequest,
  options: ResolveOptions = {},
): Promise<ResolvedAuth> {
  const apiKeyPrincipal = await resolveApiKey(context, request);
  if (apiKeyPrincipal) return { principal: apiKeyPrincipal };

  const provider = createAuthProvider(context);
  const authenticated = await provider.authenticate(request);
  if (!authenticated) throw HubError.unauthenticated();

  if (authenticated.memberships.length === 0) {
    if (!options.allowWithoutOrganization) {
      throw HubError.forbidden(
        'This account does not belong to an organization yet. Create one to continue.',
      );
    }
    return {
      principal: {
        kind: 'user',
        userId: authenticated.user.id,
        // No organization yet: the sentinel can never match a stored row, so
        // any query that slips through returns nothing rather than leaking.
        organizationId: 'org_none' as Id<'organization'>,
        role: 'viewer',
        scopes: [],
        displayName: authenticated.user.name ?? authenticated.user.email,
      },
      authenticated,
    };
  }

  const membership = selectMembership(authenticated, options);
  return {
    principal: {
      kind: 'user',
      userId: authenticated.user.id,
      organizationId: membership.organizationId,
      role: membership.role,
      scopes: scopesForRole(membership.role),
      displayName: authenticated.user.name ?? authenticated.user.email,
    },
    authenticated,
  };
}

function selectMembership(
  authenticated: AuthenticatedUser,
  options: ResolveOptions,
): AuthenticatedUser['memberships'][number] {
  const { requestedOrganizationId, requestedOrganizationSlug } = options;
  if (requestedOrganizationId || requestedOrganizationSlug) {
    const match = authenticated.memberships.find(
      (m) =>
        (requestedOrganizationId && m.organizationId === requestedOrganizationId) ||
        (requestedOrganizationSlug && m.slug === requestedOrganizationSlug),
    );
    if (!match) {
      // Deliberately NOT_FOUND rather than FORBIDDEN: confirming that an
      // organization exists to someone outside it is itself a disclosure.
      throw HubError.notFound('That organization does not exist or you do not have access to it.');
    }
    return match;
  }
  const first = authenticated.memberships[0];
  if (!first) throw HubError.forbidden('No organization membership.');
  return first;
}

async function resolveApiKey(context: AppContext, request: AuthRequest): Promise<Principal | null> {
  const header = request.headers.get('authorization');
  const raw = header?.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : (request.headers.get('x-api-key') ?? '').trim();
  if (!raw || !raw.startsWith(API_KEY_PREFIX)) return null;

  const record = await context.repositories.apiKeys.findByHash(hashApiKey(raw));
  if (!record) throw HubError.unauthenticated('That API key is not valid.');
  if (record.revokedAt) throw HubError.unauthenticated('That API key has been revoked.');
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    throw HubError.unauthenticated('That API key has expired.');
  }

  // Best-effort; a failed touch must never block the request.
  void context.repositories.apiKeys.touch(record.id).catch(() => undefined);

  return {
    kind: 'api_key',
    userId: null,
    organizationId: record.organizationId,
    role: record.scopes.includes('admin') ? 'admin' : 'developer',
    scopes: record.scopes,
    apiKeyId: record.id,
    displayName: `API key ${record.prefix}…`,
  };
}

// --- Authorisation helpers -------------------------------------------------

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

export function requireRole(principal: Principal, role: OrgRole): void {
  if (ROLE_RANK[principal.role] < ROLE_RANK[role]) {
    throw HubError.forbidden(`This action requires the ${role} role; you have ${principal.role}.`);
  }
}

export function requireScope(principal: Principal, scope: ApiScope): void {
  if (principal.scopes.includes('admin') || principal.scopes.includes(scope)) return;
  throw HubError.forbidden(`This action requires the "${scope}" scope.`);
}

export function requireUser(principal: Principal): Id<'user'> {
  if (!principal.userId) {
    throw HubError.forbidden('This action must be performed by a signed-in user, not an API key.');
  }
  return principal.userId;
}
