import { type Id, HubError } from '@mcp-hub/core';
import { contextLogger } from '@mcp-hub/observability';
import type { IdentityRepository } from '@mcp-hub/database';
import type { AuthProvider, AuthRequest, AuthenticatedUser } from './provider.js';

interface ClerkSessionClaims {
  sub: string;
  email?: string;
  name?: string;
  image_url?: string;
  /** Active organization, when the user is acting inside one. */
  org_id?: string;
  org_slug?: string;
  org_role?: string;
}

const CLERK_ROLE_MAP: Record<string, 'owner' | 'admin' | 'developer' | 'viewer'> = {
  'org:admin': 'admin',
  'org:owner': 'owner',
  'org:member': 'developer',
  'org:viewer': 'viewer',
  admin: 'admin',
  owner: 'owner',
  member: 'developer',
  viewer: 'viewer',
};

/**
 * Clerk-backed authentication.
 *
 * Verification is delegated to Clerk's backend SDK, which is loaded lazily so
 * that a local installation never needs the dependency resolved. Clerk users
 * and organizations are mirrored into MCP Hub's own tables on first sight, so
 * that foreign keys, audit rows and tenant scoping all work against local ids.
 */
export class ClerkAuthProvider implements AuthProvider {
  readonly name = 'clerk' as const;

  constructor(
    private readonly identity: IdentityRepository,
    private readonly secretKey: string,
  ) {}

  async authenticate(request: AuthRequest): Promise<AuthenticatedUser | null> {
    const claims = await this.verify(request);
    if (!claims) return null;

    const user = await this.identity.upsertUser({
      externalId: claims.sub,
      email: claims.email ?? `${claims.sub}@users.noreply.clerk.dev`,
      name: claims.name ?? null,
      avatarUrl: claims.image_url ?? null,
    });

    const memberships: AuthenticatedUser['memberships'] = [];
    if (claims.org_id) {
      const role = CLERK_ROLE_MAP[claims.org_role ?? ''] ?? 'viewer';
      const organization =
        (await this.identity.findOrganizationByExternalId(claims.org_id)) ??
        (await this.identity.createOrganization({
          name: claims.org_slug ?? claims.org_id,
          slug: claims.org_slug ?? claims.org_id.toLowerCase(),
          externalId: claims.org_id,
        }));
      await this.identity.addMember(organization.id, user.id, role);
      memberships.push({
        organizationId: organization.id,
        slug: organization.slug,
        name: organization.name,
        role,
      });
    }

    for (const row of await this.identity.listMemberships(user.id)) {
      if (memberships.some((m) => m.organizationId === row.organization.id)) continue;
      memberships.push({
        organizationId: row.organization.id as Id<'organization'>,
        slug: row.organization.slug,
        name: row.organization.name,
        role: row.membership.role,
      });
    }

    return { user, memberships };
  }

  private async verify(request: AuthRequest): Promise<ClerkSessionClaims | null> {
    try {
      // Imported lazily: installations using the dev provider never resolve it.
      // The specifier is built at runtime so bundlers and `tsc` do not try to
      // resolve an optional dependency that most installations never need.
      const specifier = ['@clerk', 'backend'].join('/');
      const clerk = (await import(/* webpackIgnore: true */ specifier)) as unknown as {
        createClerkClient: (options: { secretKey: string }) => {
          authenticateRequest: (
            req: Request,
            options?: Record<string, unknown>,
          ) => Promise<{
            isSignedIn: boolean;
            toAuth: () => { sessionClaims?: ClerkSessionClaims } | null;
          }>;
        };
      };
      const client = clerk.createClerkClient({ secretKey: this.secretKey });
      const state = await client.authenticateRequest(
        new Request('https://mcp-hub.local/', { headers: request.headers }),
      );
      if (!state.isSignedIn) return null;
      return state.toAuth()?.sessionClaims ?? null;
    } catch (err) {
      if (err instanceof Error && /Cannot find module/.test(err.message)) {
        throw HubError.internal(
          'MCP_HUB_AUTH_PROVIDER=clerk requires @clerk/backend. Install it with `pnpm add @clerk/backend -w apps/web`.',
        );
      }
      contextLogger().warn('Clerk request authentication failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
