import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Principal } from '@mcp-hub/core';
import { HubError } from '@mcp-hub/core';
import { getContext, resolvePrincipal, type AppContext, type AuthenticatedUser } from '@mcp-hub/api';

export interface Session {
  app: AppContext;
  principal: Principal;
  user: AuthenticatedUser | undefined;
}

/**
 * Resolves the caller for a server component.
 *
 * Server components read data through the same services the API uses, with
 * the same principal resolution — there is no second, looser path to the
 * database just because the caller happens to be a React tree.
 *
 * `cache` deduplicates this within one render pass so a page with ten
 * components does not authenticate ten times.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const app = await getContext();
  const cookieStore = await cookies();
  const headerStore = await headers();

  const cookieMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  const requestHeaders = new Headers();
  for (const [key, value] of headerStore.entries()) requestHeaders.set(key, value);

  try {
    const { principal, authenticated } = await resolvePrincipal(
      app,
      { headers: requestHeaders, cookies: cookieMap },
      { allowWithoutOrganization: true },
    );
    return { app, principal, user: authenticated };
  } catch (err) {
    if (err instanceof HubError && err.code === 'UNAUTHENTICATED') return null;
    throw err;
  }
});

/** For pages that require a signed-in user inside an organization. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  if (session.principal.organizationId === 'org_none') redirect('/onboarding');
  return session;
}

export async function getAppContext(): Promise<AppContext> {
  return getContext();
}
