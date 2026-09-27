import { type Id, HubError } from '@mcp-hub/core';
import type { IdentityRepository, SessionRepository } from '@mcp-hub/database';
import type { AuthProvider, AuthRequest, AuthenticatedUser } from './provider.js';

export const DEV_SESSION_COOKIE = 'mcp_hub_session';
export const DEV_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Local development authentication.
 *
 * Sessions are opaque random tokens; only their SHA-256 is stored, so the
 * table cannot be replayed as a login. There is no password: the point is to
 * let a developer switch between the seeded users and exercise every role
 * without standing up an identity provider.
 */
export class DevAuthProvider implements AuthProvider {
  readonly name = 'dev' as const;

  constructor(
    private readonly identity: IdentityRepository,
    private readonly sessions: SessionRepository,
    private readonly isProduction: boolean,
  ) {
    if (isProduction) {
      throw HubError.internal('The development auth provider must not be used in production.');
    }
  }

  async authenticate(request: AuthRequest): Promise<AuthenticatedUser | null> {
    const token = request.cookies.get(DEV_SESSION_COOKIE);
    if (!token) return null;
    const session = await this.sessions.resolve(token);
    if (!session) return null;
    const user = await this.identity.findUserById(session.userId);
    if (!user) return null;
    return { user, memberships: await this.loadMemberships(user.id) };
  }

  /** Signs in as a seeded user. Exposed only by the dev sign-in route. */
  async signIn(email: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.identity.findUserByEmail(email);
    if (!user) {
      throw HubError.notFound(
        `No seeded user with the email "${email}". Run \`pnpm db:seed\` to create the demo users.`,
      );
    }
    return this.sessions.create(user.id, DEV_SESSION_TTL_MS);
  }

  async signOut(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }

  private async loadMemberships(userId: Id<'user'>): Promise<AuthenticatedUser['memberships']> {
    const rows = await this.identity.listMemberships(userId);
    return rows.map((row) => ({
      organizationId: row.organization.id,
      slug: row.organization.slug,
      name: row.organization.name,
      role: row.membership.role,
    }));
  }
}
