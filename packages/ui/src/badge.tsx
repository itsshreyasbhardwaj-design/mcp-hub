import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent'
  | 'muted';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-fg-2 ring-border',
  success: 'bg-success/10 text-success ring-success/25',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  danger: 'bg-danger/10 text-danger ring-danger/25',
  info: 'bg-info/10 text-info ring-info/25',
  accent: 'bg-accent/10 text-accent ring-accent/25',
  muted: 'bg-transparent text-fg-3 ring-border',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Renders a leading dot, useful for status badges. */
  dot?: boolean;
}

export function Badge({ tone = 'neutral', children, className, title, dot }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export type HealthStatus = 'healthy' | 'degraded' | 'failing' | 'unknown';

const HEALTH_TONES: Record<HealthStatus, BadgeTone> = {
  healthy: 'success',
  degraded: 'warning',
  failing: 'danger',
  unknown: 'muted',
};

const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failing: 'Failing',
  unknown: 'Unknown',
};

export function StatusBadge({ status, className }: { status: HealthStatus; className?: string }) {
  return (
    <Badge tone={HEALTH_TONES[status]} dot className={className}>
      {HEALTH_LABELS[status]}
    </Badge>
  );
}

export type RiskClass =
  | 'READ'
  | 'WRITE'
  | 'NETWORK'
  | 'CREDENTIAL'
  | 'DESTRUCTIVE'
  | 'ADMIN'
  | 'UNKNOWN';

const RISK_TONES: Record<RiskClass, BadgeTone> = {
  READ: 'success',
  WRITE: 'info',
  NETWORK: 'accent',
  CREDENTIAL: 'warning',
  DESTRUCTIVE: 'danger',
  ADMIN: 'danger',
  UNKNOWN: 'warning',
};

/** Explains the classification on hover, since it is a heuristic. */
const RISK_HINTS: Record<RiskClass, string> = {
  READ: 'Reads data. Allowed by default.',
  WRITE: 'Creates or modifies data.',
  NETWORK: 'Makes outbound network requests.',
  CREDENTIAL: 'Handles credentials. Requires approval by default.',
  DESTRUCTIVE: 'Can destroy data irreversibly. Requires approval by default.',
  ADMIN: 'Changes permissions or accounts. Requires approval by default.',
  UNKNOWN: 'Could not be classified, so it is treated as sensitive.',
};

export function RiskBadge({
  risk,
  overridden,
  className,
}: {
  risk: RiskClass;
  overridden?: boolean;
  className?: string;
}) {
  return (
    <Badge
      tone={RISK_TONES[risk]}
      className={cn('font-mono text-[11px] tracking-tight', className)}
      title={overridden ? `${RISK_HINTS[risk]} (overridden by an administrator)` : RISK_HINTS[risk]}
    >
      {risk}
      {overridden ? <span aria-label="overridden">*</span> : null}
    </Badge>
  );
}

export type Severity = 'error' | 'warning' | 'info';

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone: BadgeTone = severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info';
  return (
    <Badge tone={tone} className="uppercase tracking-wide text-[10px]">
      {severity}
    </Badge>
  );
}

/** Marks fictional data so it can never be mistaken for production telemetry. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge
      tone="accent"
      className={cn('uppercase tracking-widest text-[10px]', className)}
      title="Fictional data created by the seed script. This server does not exist and is never health-checked."
    >
      Demo data
    </Badge>
  );
}
