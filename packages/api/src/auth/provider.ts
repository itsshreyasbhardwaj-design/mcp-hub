import type { Id, OrgRole, Principal, UserRecord } from '@mcp-hub/core';

export interface AuthenticatedUser {
  user: UserRecord;
  /** Organizations the user belongs to, with their role in each. */
  memberships: Array<{
    organizationId: Id<'organization'>;
    slug: string;
    name: string;
    role: OrgRole;
  }>;
}

export interface AuthRequest {
  headers: Headers;
  cookies: Map<string, string>;
}

/**
 * The authentication seam.
 *
 * Two implementations ship: Clerk for hosted deployments, and a local
 * development provider so that `pnpm dev` works with an empty environment.
 * The dev provider refuses to load under NODE_ENV=production — see
 * `@mcp-hub/config`, which fails at boot rather than at first request.
 */
export interface AuthProvider {
  readonly name: 'dev' | 'clerk';
  /** Resolves the caller, or null when the request is unauthenticated. */
  authenticate(request: AuthRequest): Promise<AuthenticatedUser | null>;
}

export function principalForMembership(
  user: UserRecord,
  organizationId: Id<'organization'>,
  role: OrgRole,
  scopes: readonly string[],
): Principal {
  return {
    kind: 'user',
    userId: user.id,
    organizationId,
    role,
    scopes,
    displayName: user.name ?? user.email,
  };
}
