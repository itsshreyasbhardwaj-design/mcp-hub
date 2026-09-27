'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { Badge, Card, CardHeader, cn, formatDuration, formatRelative } from '@mcp-hub/ui';

interface CaseRow {
  id: string;
  suite: string;
  key: string;
  title: string;
  outcome: 'passed' | 'warning' | 'failed' | 'skipped';
  durationMs: number;
  message: string | null;
  evidence: Record<string, unknown> | null;
}

interface RunView {
  id: string;
  serverSlug: string;
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  durationMs: number;
  createdAt: string;
  cases: CaseRow[];
}

const ICONS: Record<CaseRow['outcome'], React.ReactNode> = {
  passed: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  warning: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  failed: <XCircle className="size-4 text-danger" aria-hidden />,
  skipped: <MinusCircle className="size-4 text-fg-4" aria-hidden />,
};

export function CompatibilityRunDetail({ run }: { run: RunView }) {
  const [filter, setFilter] = useState<'all' | CaseRow['outcome']>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const cases = filter === 'all' ? run.cases : run.cases.filter((item) => item.outcome === filter);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Run against <code className="font-mono">{run.serverSlug}</code>
          </span>
        }
        description={`${run.total} case(s) in ${formatDuration(run.durationMs)} · ${formatRelative(run.createdAt)}`}
        action={
          <div className="flex flex-wrap gap-1">
            {(['all', 'failed', 'warning', 'passed', 'skipped'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[11px] capitalize',
                  filter === option
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-fg-4 hover:text-fg-2',
                )}
              >
                {option}
                {option !== 'all' ? (
                  <span className="ml-1 tabular-nums">
                    {option === 'failed'
                      ? run.failed
                      : option === 'warning'
                        ? run.warnings
                        : option === 'passed'
                          ? run.passed
                          : run.skipped}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        }
      />
      <ul className="divide-y divide-border">
        {cases.map((testCase) => {
          const open = expanded === testCase.id;
          return (
            <li key={testCase.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : testCase.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2',
                  testCase.outcome === 'failed' && 'bg-danger/5',
                )}
              >
                <span className="mt-0.5 shrink-0">{ICONS[testCase.outcome]}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-fg-1">{testCase.title}</span>
                    <Badge tone="muted" className="text-[10px] capitalize">
                      {testCase.suite}
                    </Badge>
                  </span>
                  {testCase.message ? (
                    <span className="mt-0.5 block text-xs text-fg-3">{testCase.message}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-fg-4">
                  {formatDuration(testCase.durationMs)}
                </span>
              </button>
              {open ? (
                <div className="border-t border-border bg-surface-2/40 px-4 py-3">
                  <code className="mb-2 block font-mono text-[10px] text-fg-4">{testCase.key}</code>
                  {testCase.evidence ? (
                    <pre className="max-h-64 overflow-auto rounded border border-border bg-surface-1 p-2 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin">
                      {JSON.stringify(testCase.evidence, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-xs text-fg-4">No evidence recorded for this case.</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
