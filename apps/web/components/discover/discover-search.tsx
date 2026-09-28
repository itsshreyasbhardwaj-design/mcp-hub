'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Badge, Card, EmptyState, Note, cn } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface Hit {
  type: 'server' | 'tool' | 'resource' | 'prompt';
  entityId: string;
  serverId: string;
  title: string;
  subtitle: string | null;
  snippet: string;
  tags: string[];
  riskClass: string | null;
  score: number;
  matchKind: 'exact' | 'prefix' | 'fulltext' | 'fuzzy';
}

interface SearchResponse {
  data: Hit[];
  total?: number;
  provider: string;
  fuzzyAvailable: boolean;
}

const TYPES = ['server', 'tool', 'resource', 'prompt'] as const;

const MATCH_LABELS: Record<Hit['matchKind'], string> = {
  exact: 'exact title match',
  prefix: 'title prefix match',
  fulltext: 'full-text match',
  fuzzy: 'fuzzy (trigram) match',
};

const EXAMPLES = [
  'database',
  'github',
  'postgres',
  'filesystem',
  'browser automation',
  'monitoring',
];

export function DiscoverSearch({
  initialQuery,
  fuzzyAvailable,
}: {
  initialQuery: string;
  fuzzyAvailable: boolean;
}) {
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [types, setTypes] = useState<string[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (term: string, selectedTypes: string[]): Promise<void> => {
    if (term.trim().length < 2) {
      setResponse(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams({ q: term, limit: '30' });
      for (const type of selectedTypes) search.append('type', type);
      setResponse(await apiFetch<SearchResponse>(`/api/v1/search?${search.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(query, types), 200);
    return () => clearTimeout(timer);
  }, [query, types, run]);

  useEffect(() => {
    const next = new URLSearchParams(params.toString());
    if (query) next.set('q', query);
    else next.delete('q');
    window.history.replaceState(null, '', `/discover${next.size > 0 ? `?${next.toString()}` : ''}`);
  }, [query, params]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-4"
          aria-hidden
        />
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the registry…"
          aria-label="Search the registry"
          className="w-full rounded-lg border border-border bg-surface-1 py-3 pl-10 pr-4 text-base text-fg-1 placeholder:text-fg-4"
        />
        {loading ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-fg-4"
            aria-hidden
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-4">Filter:</span>
        {TYPES.map((type) => {
          const active = types.includes(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setTypes((current) =>
                  current.includes(type)
                    ? current.filter((item) => item !== type)
                    : [...current, type],
                )
              }
              className={cn(
                'rounded-md border px-2 py-1 text-xs capitalize transition-colors',
                active
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-fg-3 hover:text-fg-1',
              )}
            >
              {type}s
            </button>
          );
        })}
        {response ? (
          <span className="ml-auto text-xs text-fg-4">
            {response.total ?? response.data.length} result(s) · {response.provider}
            {response.fuzzyAvailable ? ' · fuzzy on' : ' · fuzzy off'}
          </span>
        ) : null}
      </div>

      {!fuzzyAvailable ? (
        <Note>
          The pg_trgm extension is not available on this database, so typo-tolerant matching is
          disabled. Exact, prefix and full-text search still work.
        </Note>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {query.trim().length < 2 ? (
        <EmptyState
          icon={<Search className="size-8" />}
          title="Search the registry"
          description="Type at least two characters. Search covers names, descriptions, tool schemas, resource URIs and prompts."
          action={
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuery(example)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-fg-3 hover:text-fg-1"
                >
                  {example}
                </button>
              ))}
            </div>
          }
        />
      ) : response && response.data.length === 0 ? (
        <EmptyState
          title={`Nothing matched “${query}”`}
          description="Try a shorter term, or remove the type filters."
        />
      ) : response ? (
        <ul className="space-y-2">
          {response.data.map((hit) => (
            <li key={`${hit.type}:${hit.entityId}`}>
              <Card className="transition-colors hover:border-border-strong">
                <Link
                  href={
                    hit.type === 'server'
                      ? `/servers/${hit.serverId}`
                      : `/tools?q=${encodeURIComponent(hit.title)}`
                  }
                  className="block p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="muted" className="capitalize">
                      {hit.type}
                    </Badge>
                    <span className="font-medium text-fg-1">{hit.title}</span>
                    {hit.riskClass ? (
                      <Badge tone="neutral" className="font-mono text-[10px]">
                        {hit.riskClass}
                      </Badge>
                    ) : null}
                    <span
                      className="ml-auto text-[10px] text-fg-4"
                      title={`Relevance score ${hit.score}`}
                    >
                      {MATCH_LABELS[hit.matchKind]}
                    </span>
                  </div>
                  {hit.subtitle ? <p className="mt-1 text-xs text-fg-3">{hit.subtitle}</p> : null}
                  {hit.snippet ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-3">
                      {hit.snippet}
                    </p>
                  ) : null}
                  {hit.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {hit.tags.slice(0, 5).map((tag) => (
                        <Badge key={tag} tone="muted" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
