'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, CardBody, CardHeader, Note } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

export function AddMemberForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Card>
      <CardHeader title="Add a member" />
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            void apiFetch('/api/v1/team/members', { method: 'POST', body: { email, role } })
              .then(() => {
                setEmail('');
                router.refresh();
              })
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.message : 'Could not add the member.'),
              )
              .finally(() => setPending(false));
          }}
        >
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs text-fg-3" htmlFor="member-email">
              Email
            </label>
            <input
              id="member-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@example.com"
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm text-fg-1 placeholder:text-fg-4"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fg-3" htmlFor="member-role">
              Role
            </label>
            <select
              id="member-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-1"
            >
              <option value="viewer">viewer</option>
              <option value="developer">developer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 disabled:opacity-60"
          >
            {pending ? 'Adding…' : 'Add'}
          </button>
        </form>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
        <Note className="mt-2">
          The person must have signed in at least once so MCP Hub knows who they are. With Clerk,
          membership normally comes from a Clerk organization invitation instead.
        </Note>
      </CardBody>
    </Card>
  );
}
