'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDuration, formatNumber } from '@mcp-hub/ui';

export interface SeriesPoint {
  bucket: string;
  value: number;
}

/**
 * Chart primitives.
 *
 * All of them accept already-aggregated series from the API. Nothing here
 * computes a metric, interpolates a gap or extends a line past the last
 * recorded bucket — gaps are filled with explicit zeros server-side, so a
 * flat line means "no events", not "we guessed".
 */

const AXIS = {
  stroke: 'var(--color-fg-4)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function useBuckets(series: Record<string, SeriesPoint[]>, keys: string[]) {
  return useMemo(() => {
    const base = series[keys[0] ?? ''] ?? [];
    return base.map((point, index) => {
      const row: Record<string, string | number> = { bucket: point.bucket };
      for (const key of keys) row[key] = series[key]?.[index]?.value ?? 0;
      return row;
    });
  }, [series, keys]);
}

function formatBucket(value: string, dense: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dense
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/**
 * Recharts types its tooltip callbacks very loosely (values can be arrays or
 * undefined), so the adapters below narrow once instead of at each call site.
 */
function labelFormatter(value: unknown): string {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toLocaleString('en-GB');
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationFormatter(value: unknown): string {
  return formatDuration(toNumber(value));
}

function countFormatter(value: unknown, name: unknown): [string, string] {
  return [formatNumber(toNumber(value)), String(name ?? '')];
}

function failureFormatter(value: unknown, name: unknown): [string, string] {
  return name === 'rate'
    ? [`${toNumber(value)}%`, 'Error rate']
    : [formatNumber(toNumber(value)), 'Failures'];
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--color-fg-1)',
} as const;

export function RequestsChart({
  series,
  dense = true,
  height = 220,
}: {
  series: Record<string, SeriesPoint[]>;
  dense?: boolean;
  height?: number;
}) {
  const data = useBuckets(series, ['succeeded', 'failed', 'denied']);
  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="fill-success" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(value: string) => formatBucket(value, dense)}
          {...AXIS}
          minTickGap={32}
        />
        <YAxis
          {...AXIS}
          width={44}
          tickFormatter={(value: number) => formatNumber(value)}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={labelFormatter} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-fg-3)' }} />
        <Area
          type="monotone"
          dataKey="succeeded"
          name="Succeeded"
          stackId="1"
          stroke="var(--color-success)"
          fill="url(#fill-success)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="failed"
          name="Failed"
          stackId="1"
          stroke="var(--color-danger)"
          fill="var(--color-danger)"
          fillOpacity={0.2}
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="denied"
          name="Denied"
          stackId="1"
          stroke="var(--color-warning)"
          fill="var(--color-warning)"
          fillOpacity={0.2}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LatencyChart({
  series,
  dense = true,
  height = 220,
}: {
  series: Record<string, SeriesPoint[]>;
  dense?: boolean;
  height?: number;
}) {
  const data = useBuckets(series, ['avgLatencyMs', 'p95LatencyMs']);
  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(value: string) => formatBucket(value, dense)}
          {...AXIS}
          minTickGap={32}
        />
        <YAxis {...AXIS} width={52} tickFormatter={(value: number) => formatDuration(value)} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={durationFormatter}
          labelFormatter={labelFormatter}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-fg-3)' }} />
        <Line
          type="monotone"
          dataKey="avgLatencyMs"
          name="Average"
          stroke="var(--color-accent)"
          strokeWidth={1.75}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="p95LatencyMs"
          name="p95"
          stroke="var(--color-info)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HealthChart({
  series,
  dense = true,
  height = 200,
}: {
  series: Record<string, SeriesPoint[]>;
  dense?: boolean;
  height?: number;
}) {
  const data = useBuckets(series, ['healthy', 'degraded', 'failing']);
  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(value: string) => formatBucket(value, dense)}
          {...AXIS}
          minTickGap={32}
        />
        <YAxis {...AXIS} width={40} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={labelFormatter} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-fg-3)' }} />
        <Bar dataKey="healthy" name="Healthy" stackId="h" fill="var(--color-success)" />
        <Bar dataKey="degraded" name="Degraded" stackId="h" fill="var(--color-warning)" />
        <Bar dataKey="failing" name="Failing" stackId="h" fill="var(--color-danger)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ToolUsageChart({
  rows,
  height = 260,
}: {
  rows: Array<{ toolName: string; serverSlug: string; calls: number; errors: number }>;
  height?: number;
}) {
  if (rows.length === 0) return <ChartEmpty height={height} />;
  const data = rows.map((row) => ({
    name: row.toolName,
    server: row.serverSlug,
    calls: row.calls,
    errors: row.errors,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...AXIS} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          {...AXIS}
          tick={{ fontSize: 11, fill: 'var(--color-fg-3)' }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={countFormatter} />
        <Bar dataKey="calls" name="Calls" fill="var(--color-accent)" radius={[0, 3, 3, 0]} />
        <Bar dataKey="errors" name="Errors" fill="var(--color-danger)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FailuresChart({
  rows,
  height = 200,
}: {
  rows: Array<{ serverSlug: string; failures: number; total: number }>;
  height?: number;
}) {
  if (rows.length === 0) return <ChartEmpty height={height} />;
  const data = rows.map((row) => ({
    name: row.serverSlug,
    failures: row.failures,
    rate: row.total === 0 ? 0 : Math.round((row.failures / row.total) * 1000) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" {...AXIS} interval={0} angle={-20} textAnchor="end" height={54} />
        <YAxis {...AXIS} width={40} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={failureFormatter} />
        <Bar dataKey="failures" name="failures" radius={[3, 3, 0, 0]}>
          {data.map((row) => (
            <Cell
              key={row.name}
              fill={row.rate > 25 ? 'var(--color-danger)' : 'var(--color-warning)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-fg-4"
    >
      No events recorded in this window.
    </div>
  );
}
