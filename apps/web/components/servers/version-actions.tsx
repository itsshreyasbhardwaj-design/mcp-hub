'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { VersionDiffDialog } from '@/components/servers/version-diff-dialog';

interface Props {
  slug: string;
  versionId: string;
  published: boolean;
  deprecated: boolean;
  recommended: boolean;
  comparableVersions: Array<{ id: string; version: string }>;
}

export function VersionActions({
  versionId,
  published,
  deprecated,
  recommended,
  comparableVersions,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string | null>(null);

  async function act(
    label: string,
    call: () => Promise<unknown>,
  ): Promise<void> {
    setPending(label);
    setError(null);
    try {
      await call();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The action failed.');
    } finally {
      setPending(null);
    }
  }

  const button =
    'rounded border border-border px-2 py-1 text-[11px] text-fg-3 transition-colors hover:border-border-strong hover:text-fg-1 disabled:opacity-50';

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {!published ? (
          <button
            type="button"
            disabled={pending !== null}
            className={button}
            title="Publishing freezes this version's capability surface."
            onClick={() =>
              void act('publish', () =>
                apiFetch(`/api/v1/versions/${versionId}/publish`, { method: 'POST', body: {} }),
              )
            }
          >
            {pending === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        ) : null}

        {!recommended ? (
          <button
            type="button"
            disabled={pending !== null}
            className={button}
            onClick={() =>
              void act('recommend', () =>
                apiFetch(`/api/v1/versions/${versionId}`, {
                  method: 'PATCH',
                  body: { recommended: true },
                }),
              )
            }
          >
            Recommend
          </button>
        ) : null}

        <button
          type="button"
          disabled={pending !== null}
          className={button}
          onClick={() =>
            void act('deprecate', () =>
              apiFetch(`/api/v1/versions/${versionId}`, {
                method: 'PATCH',
                body: { deprecated: !deprecated },
              }),
            )
          }
        >
          {deprecated ? 'Undeprecate' : 'Deprecate'}
        </button>

        {comparableVersions.length > 0 ? (
          <>
            <label className="sr-only" htmlFor={`compare-${versionId}`}>
              Compare with
            </label>
            <select
              id={`compare-${versionId}`}
              value=""
              onChange={(event) => setCompareWith(event.target.value || null)}
              className="rounded border border-border bg-surface-1 px-1.5 py-1 text-[11px] text-fg-3"
            >
              <option value="">Compare…</option>
              {comparableVersions.map((other) => (
                <option key={other.id} value={other.id}>
                  vs {other.version}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {error ? <p className="text-[11px] text-danger">{error}</p> : null}

      {compareWith ? (
        <VersionDiffDialog
          fromVersionId={compareWith}
          toVersionId={versionId}
          onClose={() => setCompareWith(null)}
        />
      ) : null}
    </div>
  );
}
