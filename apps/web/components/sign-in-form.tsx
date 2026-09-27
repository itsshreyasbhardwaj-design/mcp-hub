'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface SeededUser {
  email: string;
  name: string | null;
  role: string;
  organization: string;
}

/**
 * Development sign-in.
 *
 * There is no password: this exists so a developer can move between the
 * seeded roles and see how the permission model behaves from each side. The
 * route it calls refuses to work under the Clerk provider, and the config
 * layer refuses to boot the dev provider in production at all.
 */
export function SignInForm({ users }: { users: SeededUser[] }) {
  const router = useRouter();
  const [email, setEmail] = useState(users[0]?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function signIn(target: string): Promise<void> {
    setError(null);
    try {
      await apiFetch('/api/v1/auth/dev/sign-in', { method: 'POST', body: { email: target } });
      startTransition(() => {
        router.push('/');
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    }
  }

  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <p className="text-sm font-medium text-fg-2">No users have been seeded yet.</p>
        <p className="mt-2 text-sm leading-relaxed text-fg-3">
          Run{' '}
          <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs">pnpm db:seed</code>{' '}
          to create the demo organization and its four users, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-4">
            Seeded accounts
          </p>
        </div>
        <ul className="divide-y divide-border">
          {users.map((user) => (
            <li key={user.email}>
              <button
                type="button"
                disabled={pending}
                onClick={() => void signIn(user.email)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg-1">
                    {user.name ?? user.email}
                  </span>
                  <span className="block truncate font-mono text-xs text-fg-3">{user.email}</span>
                </span>
                <Badge tone={user.role === 'owner' ? 'accent' : 'neutral'}>{user.role}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email);
        }}
      >
        <label className="sr-only" htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-fg-4">
        Development sign-in is only available with{' '}
        <code className="font-mono">MCP_HUB_AUTH_PROVIDER=dev</code>. Production deployments use
        Clerk, and MCP Hub refuses to boot the development provider when{' '}
        <code className="font-mono">NODE_ENV=production</code>.
      </p>
    </div>
  );
}
