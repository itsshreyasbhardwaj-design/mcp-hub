'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@mcp-hub/ui';
import { ALL_NAV_ITEMS } from '@/lib/nav';
import { apiFetch } from '@/lib/api';

interface SearchHit {
  type: 'server' | 'tool' | 'resource' | 'prompt';
  entityId: string;
  serverId: string;
  title: string;
  subtitle: string | null;
  matchKind: string;
}

interface Result {
  key: string;
  label: string;
  hint: string;
  href: string;
  group: string;
}

/**
 * Search across the registry and the application itself.
 *
 * Results come from the same `/api/v1/search` endpoint the Discover page
 * uses, so relevance behaves identically in both places. Queries are
 * debounced and the in-flight request is aborted when the term changes.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const search = useCallback(async (term: string): Promise<void> => {
    const navMatches: Result[] = ALL_NAV_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(term.toLowerCase()) ||
        item.description.toLowerCase().includes(term.toLowerCase()),
    ).map((item) => ({
      key: `nav:${item.href}`,
      label: item.label,
      hint: item.description,
      href: item.href,
      group: 'Navigate',
    }));

    if (term.trim().length < 2) {
      setResults(navMatches.slice(0, 6));
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const response = await apiFetch<{ data: SearchHit[] }>(
        `/api/v1/search?q=${encodeURIComponent(term)}&limit=8`,
        { signal: controller.signal },
      );
      const hits: Result[] = response.data.map((hit) => ({
        key: `${hit.type}:${hit.entityId}`,
        label: hit.title,
        hint: hit.subtitle ?? hit.type,
        href:
          hit.type === 'server'
            ? `/servers/${hit.serverId}`
            : `/tools?q=${encodeURIComponent(hit.title)}`,
        group: hit.type === 'server' ? 'Servers' : 'Tools & resources',
      }));
      setResults([...navMatches.slice(0, 3), ...hits]);
      setActive(0);
    } catch {
      setResults(navMatches.slice(0, 6));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void search(query), 150);
    return () => clearTimeout(timer);
  }, [query, open, search]);

  function choose(result: Result | undefined): void {
    if (!result) return;
    setOpen(false);
    setQuery('');
    router.push(result.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-left text-sm text-fg-4 transition-colors hover:border-border-strong"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search servers, tools and pages…</span>
        <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-4 sm:inline">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="w-full max-w-xl overflow-hidden rounded-lg border border-border-strong bg-surface-1 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-fg-4" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActive((index) => Math.min(index + 1, results.length - 1));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActive((index) => Math.max(index - 1, 0));
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    choose(results[active]);
                  }
                }}
                placeholder="Search servers, tools and pages…"
                aria-label="Search"
                className="w-full bg-transparent py-3 text-sm text-fg-1 outline-none placeholder:text-fg-4"
              />
              {loading ? <span className="text-xs text-fg-4">…</span> : null}
            </div>

            {results.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-fg-4">
                {query.trim().length < 2 ? 'Type at least two characters.' : 'No matches.'}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1 scrollbar-thin">
                {results.map((result, index) => (
                  <li key={result.key}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(result)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left',
                        index === active ? 'bg-surface-3' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg-1">{result.label}</span>
                        <span className="block truncate text-xs text-fg-4">{result.hint}</span>
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg-4">
                        {result.group}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
