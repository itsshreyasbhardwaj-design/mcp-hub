'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { RiskBadge, cn, type RiskClass } from '@mcp-hub/ui';
import { SchemaInspector } from '@/components/schema-inspector';
import { ApiError, apiFetch } from '@/lib/api';

export interface ToolRow {
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  riskClass: RiskClass;
  heuristicRisk: RiskClass;
  riskReason: string;
  overridden: boolean;
  overrideReason: string | null;
}

const RISK_OPTIONS: RiskClass[] = [
  'READ',
  'WRITE',
  'NETWORK',
  'CREDENTIAL',
  'DESTRUCTIVE',
  'ADMIN',
  'UNKNOWN',
];

export function ToolList({ tools, canOverride }: { tools: ToolRow[]; canOverride: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-border">
      {tools.map((tool) => {
        const open = expanded === tool.id;
        return (
          <li key={tool.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : tool.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <ChevronRight
                className={cn(
                  'mt-0.5 size-4 shrink-0 text-fg-4 transition-transform',
                  open && 'rotate-90',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-sm font-medium text-fg-1">{tool.name}</code>
                  <RiskBadge risk={tool.riskClass} overridden={tool.overridden} />
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-fg-3">
                  {tool.description ?? (
                    <span className="text-warning">
                      No description — clients and models rely on this.
                    </span>
                  )}
                </span>
              </span>
            </button>

            {open ? (
              <div className="space-y-4 border-t border-border bg-surface-2/40 px-4 py-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                    Why it was classified {tool.riskClass}
                  </p>
                  <p className="text-xs leading-relaxed text-fg-3">{tool.riskReason}</p>
                  {tool.overridden ? (
                    <p className="mt-1.5 text-xs text-warning">
                      Overridden by an administrator (heuristic said {tool.heuristicRisk})
                      {tool.overrideReason ? `: ${tool.overrideReason}` : '.'}
                    </p>
                  ) : null}
                </div>

                <SchemaInspector schema={tool.inputSchema} title="Input schema" />
                {tool.outputSchema ? (
                  <SchemaInspector schema={tool.outputSchema} title="Output schema" />
                ) : null}

                {canOverride ? <RiskOverride toolId={tool.id} current={tool.riskClass} /> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function RiskOverride({ toolId, current }: { toolId: string; current: RiskClass }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<RiskClass>(current);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-accent hover:underline"
      >
        Override classification
      </button>
    );
  }

  return (
    <form
      className="space-y-2 rounded-md border border-border bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void apiFetch(`/api/v1/tools/${toolId}/risk`, {
          method: 'POST',
          body: { riskClass: value, reason },
        })
          .then(() => {
            setOpen(false);
            router.refresh();
          })
          .catch((err: unknown) =>
            setError(err instanceof ApiError ? err.message : 'The override failed.'),
          )
          .finally(() => setPending(false));
      }}
    >
      <p className="text-xs text-fg-3">
        The original heuristic verdict, your reason and your identity are all recorded.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`risk-${toolId}`}>
          Risk classification
        </label>
        <select
          id={`risk-${toolId}`}
          value={value}
          onChange={(event) => setValue(event.target.value as RiskClass)}
          className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs text-fg-1"
        >
          {RISK_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          required
          minLength={5}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this classification wrong?"
          className="min-w-[200px] flex-1 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs text-fg-1 placeholder:text-fg-4"
        />
        <button
          type="submit"
          disabled={pending || reason.trim().length < 5}
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-surface-0 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-3"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
