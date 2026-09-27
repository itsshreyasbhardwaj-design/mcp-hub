import { HubError, scopesForRole } from '@mcp-hub/core';
import { DevAuthProvider, DEV_SESSION_COOKIE } from '../auth/dev.js';
import { createAuthProvider } from '../auth/resolve.js';
import * as services from '../services/index.js';
import { json, noContent, type RouteDefinition } from './types.js';
import { parse, createOrganizationSchema, devSignInSchema } from './schemas.js';

function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [
    `${DEV_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Expires=${expiresAt.toUTCString()}`,
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Session and bootstrap routes.
 *
 * The dev sign-in route is the only unauthenticated write in the product. It
 * refuses to exist under the Clerk provider, and `@mcp-hub/config` refuses to
 * boot the dev provider in production at all — two independent guards, because
 * one misconfiguration here would be an authentication bypass.
 */
export const authRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/auth/session',
    requiresOrganization: false,
    summary: 'Current session, memberships and effective scopes',
    handler: async ({ app, principal, user }) => {
      if (!user) {
        // API-key callers have no session; report the principal they carry.
        return json({
          user: null,
          organizations: [],
          active: { organizationId: principal.organizationId, role: principal.role },
          scopes: principal.scopes,
          authProvider: app.config.auth.provider,
        });
      }
      return json({
        user: {
          id: user.user.id,
          email: user.user.email,
          name: user.user.name,
          avatarUrl: user.user.avatarUrl,
        },
        organizations: user.memberships,
        active:
          user.memberships.length > 0
            ? { organizationId: principal.organizationId, role: principal.role }
            : null,
        scopes: user.memberships.length > 0 ? scopesForRole(principal.role) : [],
        authProvider: app.config.auth.provider,
      });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/auth/dev/sign-in',
    public: true,
    summary: 'Sign in as a seeded user (development auth provider only)',
    handler: async ({ app, request }) => {
      if (app.config.auth.provider !== 'dev') {
        throw new HubError(
          'NOT_IMPLEMENTED',
          'This deployment uses Clerk. Sign in through the Clerk flow.',
        );
      }
      const provider = createAuthProvider(app);
      if (!(provider instanceof DevAuthProvider)) {
        throw HubError.internal('The development auth provider is not active.');
      }
      const input = parse(devSignInSchema, request.body);
      const session = await provider.signIn(input.email);
      return json(
        { signedIn: true, expiresAt: session.expiresAt },
        200,
        {
          'set-cookie': sessionCookie(
            session.token,
            session.expiresAt,
            app.config.appUrl.startsWith('https://'),
          ),
        },
      );
    },
  },
  {
    method: 'POST',
    path: '/api/v1/auth/sign-out',
    public: true,
    summary: 'Clear the current session',
    handler: async ({ app, request }) => {
      const token = request.cookies.get(DEV_SESSION_COOKIE);
      if (token && app.config.auth.provider === 'dev') {
        const provider = createAuthProvider(app);
        if (provider instanceof DevAuthProvider) await provider.signOut(token);
      }
      return json({ signedOut: true }, 200, {
        'set-cookie': `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/v1/auth/dev/users',
    public: true,
    summary: 'List seeded users available to the development sign-in screen',
    handler: async ({ app }) => {
      if (app.config.auth.provider !== 'dev') return json({ users: [] });
      const { rows } = await app.db.query<{
        email: string;
        name: string | null;
        role: string;
        organization: string;
      }>(
        `select u.email, u.name, m.role, o.name as organization
           from users u
           join organization_members m on m.user_id = u.id
           join organizations o on o.id = m.organization_id
          order by case m.role
                     when 'owner' then 0 when 'admin' then 1
                     when 'developer' then 2 else 3 end, u.email
          limit 20`,
      );
      return json({ users: rows });
    },
  },
  {
    method: 'POST',
    path: '/api/v1/organizations',
    requiresOrganization: false,
    summary: 'Create an organization and become its owner',
    handler: async ({ app, request, user }) => {
      if (!user) {
        throw HubError.forbidden('Only a signed-in user can create an organization.');
      }
      const input = parse(createOrganizationSchema, request.body);
      const created = await services.createOrganization(app, user.user, input);
      return json(created, 201);
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/auth/session',
    public: true,
    summary: 'Alias of sign-out for REST clients',
    handler: async () => noContent(),
  },
];
