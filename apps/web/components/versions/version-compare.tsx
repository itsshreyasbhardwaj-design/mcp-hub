'use client';

import { useState } from 'react';
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import { Card, CardBody, CardHeader, Note } from '@mcp-hub/ui';
import { VersionDiffDialog } from '@/components/servers/version-diff-dialog';

interface ServerOption {
  slug: string;
  name: string;
  versions: Array<{ id: string; version: string }>;
}

export function VersionCompare({ servers }: { servers: ServerOption[] }) {
  const [slug, setSlug] = useState(servers[0]?.slug ?? '');
  const server = servers.find((item) => item.slug === slug);
  const [from, setFrom] = useState(server?.versions[1]?.id ?? '');
  const [to, setTo] = useState(server?.versions[0]?.id ?? '');
  const [open, setOpen] = useState(false);

  if (servers.length === 0) {
    return (
      <Card>
        <CardHeader title="Compare versions" />
        <CardBody>
          <Note>
            No server has two versions yet. Create a second version and run Discover against it to
            see a diff.
          </Note>
        </CardBody>
      </Card>
    );
  }

  const select = 'rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-1';

  return (
    <Card>
      <CardHeader
        title="Compare versions"
        description="Added, removed and renamed tools, plus every schema change, with breaking changes identified by rule."
      />
      <CardBody>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-3" htmlFor="compare-server">
              Server
            </label>
            <select
              id="compare-server"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                const next = servers.find((item) => item.slug === event.target.value);
                setFrom(next?.versions[1]?.id ?? '');
                setTo(next?.versions[0]?.id ?? '');
              }}
              className={select}
            >
              {servers.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-3" htmlFor="compare-from">
              From
            </label>
            <select
              id="compare-from"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={`${select} font-mono`}
            >
              {(server?.versions ?? []).map((version) => (
                <option key={version.id} value={version.id}>
                  {version.version}
                </option>
              ))}
            </select>
          </div>
          <ArrowRight className="mb-2 size-4 text-fg-4" aria-hidden />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-3" htmlFor="compare-to">
              To
            </label>
            <select
              id="compare-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={`${select} font-mono`}
            >
              {(server?.versions ?? []).map((version) => (
                <option key={version.id} value={version.id}>
                  {version.version}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!from || !to || from === to}
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
          >
            <GitCompareArrows className="size-3.5" aria-hidden />
            Compare
          </button>
        </div>
      </CardBody>

      {open ? (
        <VersionDiffDialog fromVersionId={from} toVersionId={to} onClose={() => setOpen(false)} />
      ) : null}
    </Card>
  );
}
