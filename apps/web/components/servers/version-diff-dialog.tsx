'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, Minus, Plus, X } from 'lucide-react';
import { Badge, cn } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface VersionChange {
  kind: string;
  path: string;
  subject: string;
  breaking: boolean;
  rule: string;
  detail: string;
}

interface VersionDiff {
  fromVersion: string;
  toVersion: string;
  toolsAdded: number;
  toolsRemoved: number;
  toolsRenamed: number;
  schemasChanged: number;
  breakingChanges: number;
  changes: VersionChange[];
}

const KIND_ICONS: Record<string, React.ReactNode> = {
  tool_added: <Plus className="size-3.5 text-success" aria-hidden />,
  tool_removed: <Minus className="size-3.5 text-danger" aria-hidden />,
  tool_renamed: <ArrowRight className="size-3.5 text-warning" aria-hidden />,
};

/**
 * Shows a structured diff between two versions.
 *
 * Each change states the rule that classified it, so "breaking" is a claim a
 * reviewer can check rather than a verdict they have to trust.
 */
export function VersionDiffDialog({
  fromVersionId,
  toVersionId,
  onClose,
}: {
  fromVersionId: string;
  toVersionId: string;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<VersionDiff>(`/api/v1/versions/${fromVersionId}/compare/${toVersionId}`)
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Comparison failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [fromVersionId, toVersionId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version comparison"
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border-strong bg-surface-1 text-left shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-fg-1">
              {diff ? (
                <>
                  <code className="font-mono">{diff.fromVersion}</code>
                  <ArrowRight className="mx-1.5 inline size-3.5" aria-hidden />
                  <code className="font-mono">{diff.toVersion}</code>
                </>
              ) : (
                'Comparing versions'
              )}
            </h2>
            {diff ? (
              <p className="mt-0.5 text-xs text-fg-3">
                +{diff.toolsAdded} tool(s) · −{diff.toolsRemoved} tool(s) · {diff.toolsRenamed}{' '}
                renamed · ~{diff.schemasChanged} schema(s)
                {diff.breakingChanges > 0 ? (
                  <span className="ml-1 text-danger">({diff.breakingChanges} breaking)</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg-1"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {error ? (
            <p role="alert" className="p-6 text-sm text-danger">
              {error}
            </p>
          ) : !diff ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-fg-4">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Comparing…
            </p>
          ) : diff.changes.length === 0 ? (
            <p className="p-10 text-center text-sm text-fg-4">
              No capability differences between these versions.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {diff.changes.map((change, index) => (
                <li
                  key={`${change.path}-${index}`}
                  className={cn('px-4 py-3', change.breaking && 'bg-danger/5')}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      {KIND_ICONS[change.kind] ?? (
                        <span className="block size-3.5 rounded-full border border-border" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-xs text-fg-1">{change.subject}</code>
                        {change.breaking ? (
                          <Badge tone="danger" className="text-[10px]">
                            <AlertTriangle className="size-2.5" aria-hidden />
                            breaking
                          </Badge>
                        ) : null}
                        <code className="font-mono text-[10px] text-fg-4">{change.rule}</code>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-fg-3">{change.detail}</p>
                      <code className="mt-1 block truncate font-mono text-[10px] text-fg-4">
                        {change.path}
                      </code>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
