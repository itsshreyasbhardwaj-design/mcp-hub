'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search, X } from 'lucide-react';

const STATUSES = ['', 'draft', 'active', 'deprecated', 'archived'];
const HEALTH = ['', 'healthy', 'degraded', 'failing', 'unknown'];

export function ServerFilters({
  query,
  status,
  health,
  total,
}: {
  query: string;
  status: string;
  health: string;
  total: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);

  function apply(next: Partial<{ q: string; status: string; health: string }>): void {
    const params = new URLSearchParams();
    const merged = { q: value, status, health, ...next };
    for (const [key, item] of Object.entries(merged)) {
      if (item) params.set(key, item);
    }
    router.push(`/servers${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  const hasFilters = Boolean(query || status || health);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-[220px] flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: value });
        }}
      >
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-4"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Filter by name, slug or description"
          aria-label="Filter servers"
          className="w-full rounded-md border border-border bg-surface-1 py-1.5 pl-8 pr-3 text-sm text-fg-1 placeholder:text-fg-4"
        />
      </form>

      <label className="sr-only" htmlFor="status-filter">
        Status
      </label>
      <select
        id="status-filter"
        value={status}
        onChange={(event) => apply({ status: event.target.value })}
        className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-2"
      >
        {STATUSES.map((option) => (
          <option key={option} value={option}>
            {option === '' ? 'Any status' : option}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="health-filter">
        Health
      </label>
      <select
        id="health-filter"
        value={health}
        onChange={(event) => apply({ health: event.target.value })}
        className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-2"
      >
        {HEALTH.map((option) => (
          <option key={option} value={option}>
            {option === '' ? 'Any health' : option}
          </option>
        ))}
      </select>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            router.push('/servers');
          }}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-fg-3 hover:text-fg-1"
        >
          <X className="size-3" aria-hidden />
          Clear
        </button>
      ) : null}

      <span className="ml-auto text-xs text-fg-4">{total} server(s)</span>
    </div>
  );
}
