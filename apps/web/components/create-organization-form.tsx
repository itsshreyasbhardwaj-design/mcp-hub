'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void apiFetch('/api/v1/organizations', { method: 'POST', body: { name } })
          .then(() => {
            router.push('/');
            router.refresh();
          })
          .catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : 'Could not create the organization.');
          })
          .finally(() => setPending(false));
      }}
    >
      <div>
        <label htmlFor="org-name" className="mb-1.5 block text-sm font-medium text-fg-2">
          Organization name
        </label>
        <input
          id="org-name"
          required
          minLength={1}
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Robotics"
          className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4"
        />
      </div>
      <button
        type="submit"
        disabled={pending || name.trim().length === 0}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 transition-colors hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create organization'}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
