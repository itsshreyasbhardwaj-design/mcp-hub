'use client';

import { useRouter } from 'next/navigation';

export function ActivityFilters({
  actions,
  action,
  result,
}: {
  actions: Array<{ action: string; count: number }>;
  action: string;
  result: string;
}) {
  const router = useRouter();

  function apply(next: { action?: string; result?: string }): void {
    const params = new URLSearchParams();
    const merged = { action, result, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    router.push(`/activity${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  const select = 'rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-2';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="action-filter">
        Action
      </label>
      <select
        id="action-filter"
        value={action}
        onChange={(event) => apply({ action: event.target.value })}
        className={select}
      >
        <option value="">Any action</option>
        {actions.map((item) => (
          <option key={item.action} value={item.action}>
            {item.action} ({item.count})
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="result-filter">
        Result
      </label>
      <select
        id="result-filter"
        value={result}
        onChange={(event) => apply({ result: event.target.value })}
        className={select}
      >
        <option value="">Any result</option>
        <option value="allowed">allowed</option>
        <option value="denied">denied</option>
        <option value="error">error</option>
      </select>

      {action || result ? (
        <button
          type="button"
          onClick={() => router.push('/activity')}
          className="rounded-md border border-border px-2 py-1.5 text-xs text-fg-3 hover:text-fg-1"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
