'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@mcp-hub/ui';

const RANGES = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
] as const;

/** Time-range selector. The range lives in the URL so views are shareable. */
export function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-md border border-border bg-surface-1 p-0.5"
    >
      {RANGES.map((range) => {
        const active = current === range.value;
        return (
          <button
            key={range.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set('range', range.value);
              router.push(`${pathname}?${next.toString()}`);
            }}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active ? 'bg-surface-3 text-fg-1' : 'text-fg-3 hover:text-fg-1',
            )}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
