'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Card, CardBody, CardHeader, Note, cn } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface ServerOption {
  id: string;
  slug: string;
  name: string;
  versions: Array<{ id: string; version: string }>;
}

interface SuiteCase {
  suite: string;
  key: string;
  title: string;
  rationale: string;
}

export function RunTestsPanel({
  servers,
  suites,
}: {
  servers: ServerOption[];
  suites: SuiteCase[];
}) {
  const router = useRouter();
  const [serverSlug, setServerSlug] = useState(servers[0]?.slug ?? '');
  const server = servers.find((item) => item.slug === serverSlug);
  const [versionId, setVersionId] = useState(server?.versions[0]?.id ?? '');
  const suiteNames = [...new Set(suites.map((item) => item.suite))];
  const [selectedSuites, setSelectedSuites] = useState<string[]>(suiteNames);
  const [pending, setPending] = useState<'validate' | 'test' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (servers.length === 0) {
    return (
      <Card>
        <CardHeader title="Run tests" />
        <CardBody>
          <Note>
            No non-demo server has a version yet. Register one, or use the local example servers
            created by the seed.
          </Note>
        </CardBody>
      </Card>
    );
  }

  async function run(kind: 'validate' | 'test'): Promise<void> {
    setPending(kind);
    setMessage(null);
    try {
      if (kind === 'validate') {
        const result = await apiFetch<{
          outcome: string;
          errorCount: number;
          warningCount: number;
        }>(`/api/v1/servers/${serverSlug}/validate`, { method: 'POST' });
        setMessage({
          tone: result.outcome === 'error' ? 'error' : 'ok',
          text: `Validation ${result.outcome}: ${result.errorCount} error(s), ${result.warningCount} warning(s).`,
        });
      } else {
        const result = await apiFetch<{ id: string; passed: number; failed: number }>(
          `/api/v1/servers/${serverSlug}/test`,
          { method: 'POST', body: { versionId, suites: selectedSuites } },
        );
        setMessage({
          tone: result.failed > 0 ? 'error' : 'ok',
          text: `${result.passed} passed, ${result.failed} failed.`,
        });
        router.push(`/testing?run=${result.id}`);
      }
      router.refresh();
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'The run failed.',
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Run tests" description="Against a live server." />
      <CardBody className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="test-server">
            Server
          </label>
          <select
            id="test-server"
            value={serverSlug}
            onChange={(event) => {
              setServerSlug(event.target.value);
              const next = servers.find((item) => item.slug === event.target.value);
              setVersionId(next?.versions[0]?.id ?? '');
            }}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-fg-1"
          >
            {servers.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="test-version">
            Version
          </label>
          <select
            id="test-version"
            value={versionId}
            onChange={(event) => setVersionId(event.target.value)}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-sm text-fg-1"
          >
            {(server?.versions ?? []).map((version) => (
              <option key={version.id} value={version.id}>
                {version.version}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg-2">Suites</legend>
          <div className="space-y-1.5">
            {suiteNames.map((suite) => {
              const count = suites.filter((item) => item.suite === suite).length;
              return (
                <label key={suite} className="flex items-center gap-2 text-sm text-fg-2">
                  <input
                    type="checkbox"
                    checked={selectedSuites.includes(suite)}
                    onChange={(event) =>
                      setSelectedSuites((current) =>
                        event.target.checked
                          ? [...current, suite]
                          : current.filter((item) => item !== suite),
                      )
                    }
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  <span className="capitalize">{suite}</span>
                  <span className="text-xs text-fg-4">{count} case(s)</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null || selectedSuites.length === 0 || !versionId}
            onClick={() => void run('test')}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
          >
            {pending === 'test' ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            Run compatibility
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void run('validate')}
            className="rounded-md border border-border px-3 py-2 text-sm text-fg-2 hover:border-border-strong disabled:opacity-50"
          >
            {pending === 'validate' ? 'Validating…' : 'Validate metadata'}
          </button>
        </div>

        {message ? (
          <p
            role="status"
            className={cn('text-xs', message.tone === 'error' ? 'text-danger' : 'text-success')}
          >
            {message.text}
          </p>
        ) : null}

        <Note>
          Compatibility cases only read, or send deliberately invalid input to a tool that declares
          a required parameter. None of them can cause a side effect.
        </Note>
      </CardBody>
    </Card>
  );
}
