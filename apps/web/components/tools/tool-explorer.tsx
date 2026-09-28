'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight, Search, Wrench } from 'lucide-react';
import { Badge, Card, EmptyState, RiskBadge, cn, type RiskClass } from '@mcp-hub/ui';
import { SchemaInspector } from '@/components/schema-inspector';

interface ToolRow {
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown>;
  riskClass: RiskClass;
  riskReason: string;
  riskOverridden: boolean;
  serverId: string;
  serverSlug: string;
  serverName: string;
  versionId: string;
  version: string;
}

const RISKS: RiskClass[] = [
  'READ',
  'WRITE',
  'NETWORK',
  'CREDENTIAL',
  'DESTRUCTIVE',
  'ADMIN',
  'UNKNOWN',
];

export function ToolExplorer({
  rows,
  total,
  page,
  limit,
  query,
  risk,
}: {
  rows: ToolRow[];
  total: number;
  page: number;
  limit: number;
  query: string;
  risk: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [expanded, setExpanded] = useState<string | null>(null);
  const selectedRisks = risk ? risk.split(',') : [];

  function navigate(next: { q?: string; risk?: string[]; page?: number }): void {
    const params = new URLSearchParams();
    const q = next.q ?? value;
    const risks = next.risk ?? selectedRisks;
    if (q) params.set('q', q);
    if (risks.length > 0) params.set('risk', risks.join(','));
    if (next.page) params.set('page', String(next.page));
    router.push(`/tools${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[240px] flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ q: value, page: 0 });
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
            placeholder="Search tool names and descriptions, e.g. create_issue"
            aria-label="Search tools"
            className="w-full rounded-md border border-border bg-surface-1 py-1.5 pl-8 pr-3 text-sm text-fg-1 placeholder:text-fg-4"
          />
        </form>
        <div className="flex flex-wrap gap-1">
          {RISKS.map((option) => {
            const active = selectedRisks.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  navigate({
                    risk: active
                      ? selectedRisks.filter((item) => item !== option)
                      : [...selectedRisks, option],
                    page: 0,
                  })
                }
                className={cn(
                  'rounded border px-1.5 py-1 font-mono text-[10px] transition-colors',
                  active
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-fg-4 hover:text-fg-2',
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-fg-4">{total} tool(s)</span>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            className="border-0"
            icon={<Wrench className="size-8" />}
            title="No tools match"
            description="Discover a server's capability surface, or relax the filters."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((tool) => {
              const open = expanded === tool.id;
              return (
                <li key={tool.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`Toggle schema for ${tool.name}`}
                      onClick={() => setExpanded(open ? null : tool.id)}
                      className="mt-0.5 rounded p-0.5 text-fg-4 hover:text-fg-1"
                    >
                      <ChevronRight
                        className={cn('size-4 transition-transform', open && 'rotate-90')}
                        aria-hidden
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-sm text-fg-1">
                          <span className="text-fg-4">{tool.serverSlug}.</span>
                          {tool.name}
                        </code>
                        <RiskBadge risk={tool.riskClass} overridden={tool.riskOverridden} />
                        <Badge tone="muted" className="font-mono text-[10px]">
                          v{tool.version}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-fg-3">
                        {tool.description ?? <span className="text-warning">No description.</span>}
                      </p>
                    </div>
                    <Link
                      href={`/servers/${tool.serverSlug}?tab=playground`}
                      className="shrink-0 text-xs text-accent hover:underline"
                    >
                      Open
                    </Link>
                  </div>
                  {open ? (
                    <div className="space-y-3 border-t border-border bg-surface-2/40 px-4 py-3">
                      <p className="text-xs text-fg-3">{tool.riskReason}</p>
                      <SchemaInspector schema={tool.inputSchema} title="Input schema" />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {total > limit ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => navigate({ page: page - 1 })}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-3 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-fg-4">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            type="button"
            disabled={(page + 1) * limit >= total}
            onClick={() => navigate({ page: page + 1 })}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-3 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
