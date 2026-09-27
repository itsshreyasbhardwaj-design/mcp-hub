import type { ReactNode } from 'react';
import { cn } from './cn.js';
import { formatNumber } from './format.js';

export interface MetricCardProps {
  label: string;
  value: number | string | null;
  /** Rendered under the value; use it to say where the number comes from. */
  hint?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
  className?: string;
}

const VALUE_TONES = {
  default: 'text-fg-1',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export function MetricCard({ label, value, hint, tone = 'default', icon, className }: MetricCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface-1 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-4">{label}</p>
        {icon ? <span className="text-fg-4" aria-hidden>{icon}</span> : null}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', VALUE_TONES[tone])}>
        {typeof value === 'number' ? formatNumber(value) : (value ?? '—')}
      </p>
      {hint ? <div className="mt-1 text-xs text-fg-3">{hint}</div> : null}
    </div>
  );
}

/** A horizontal bar used for distributions where a chart would be overkill. */
export function Meter({
  segments,
  className,
}: {
  segments: Array<{ label: string; value: number; className: string }>;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return <div className={cn('h-2 w-full rounded-full bg-surface-3', className)} />;
  }
  return (
    <div
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
    >
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
    </div>
  );
}
