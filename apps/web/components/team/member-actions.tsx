'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

const ROLES = ['viewer', 'developer', 'admin', 'owner'] as const;

export function MemberActions({
  userId,
  role,
  isSelf,
  canManageOwners,
}: {
  userId: string;
  role: string;
  isSelf: boolean;
  canManageOwners: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`role-${userId}`}>
          Role
        </label>
        <select
          id={`role-${userId}`}
          value={role}
          disabled={pending || isSelf}
          onChange={(event) => {
            setPending(true);
            setError(null);
            void apiFetch(`/api/v1/team/members/${userId}`, {
              method: 'PATCH',
              body: { role: event.target.value },
            })
              .then(() => router.refresh())
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.message : 'Could not change the role.'),
              )
              .finally(() => setPending(false));
          }}
          className="rounded border border-border bg-surface-1 px-1.5 py-1 text-xs text-fg-2 disabled:opacity-50"
        >
          {ROLES.filter((option) => option !== 'owner' || canManageOwners).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={pending || isSelf}
          onClick={() => {
            setPending(true);
            setError(null);
            void apiFetch(`/api/v1/team/members/${userId}`, { method: 'DELETE' })
              .then(() => router.refresh())
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.message : 'Could not remove the member.'),
              )
              .finally(() => setPending(false));
          }}
          className="rounded border border-border px-1.5 py-1 text-xs text-fg-4 hover:text-danger disabled:opacity-40"
          title={isSelf ? 'You cannot remove yourself.' : 'Remove from the organization'}
        >
          Remove
        </button>
      </div>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
