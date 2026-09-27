'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export function ResolveIncidentButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void apiFetch(`/api/v1/incidents/${incidentId}/resolve`, { method: 'POST' })
          .then(() => router.refresh())
          .finally(() => setPending(false));
      }}
      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-fg-3 hover:text-fg-1 disabled:opacity-50"
    >
      {pending ? 'Resolving…' : 'Resolve'}
    </button>
  );
}
