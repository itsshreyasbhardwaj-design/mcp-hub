'use client';

import { useState } from 'react';
import { Badge, DataTable, cn } from '@mcp-hub/ui';

interface Route {
  method: string;
  path: string;
  summary: string;
}

const METHOD_TONES: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  GET: 'success',
  POST: 'info',
  PATCH: 'warning',
  PUT: 'warning',
  DELETE: 'danger',
};

export function RouteTable({ routes }: { routes: Route[] }) {
  const [filter, setFilter] = useState('');
  const visible = filter
    ? routes.filter(
        (route) =>
          route.path.toLowerCase().includes(filter.toLowerCase()) ||
          route.summary.toLowerCase().includes(filter.toLowerCase()),
      )
    : routes;

  return (
    <>
      <div className="border-b border-border px-4 py-2">
        <label className="sr-only" htmlFor="route-filter">
          Filter endpoints
        </label>
        <input
          id="route-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter endpoints…"
          className="w-full max-w-xs rounded-md border border-border bg-surface-1 px-2 py-1 text-xs text-fg-1 placeholder:text-fg-4"
        />
      </div>
      <DataTable
        caption="API endpoints"
        rows={visible}
        rowKey={(route) => `${route.method} ${route.path}`}
        columns={[
          {
            key: 'method',
            header: 'Method',
            width: '90px',
            render: (route) => (
              <Badge tone={METHOD_TONES[route.method] ?? 'neutral'} className="font-mono text-[10px]">
                {route.method}
              </Badge>
            ),
          },
          {
            key: 'path',
            header: 'Path',
            width: '380px',
            render: (route) => (
              <code className={cn('font-mono text-xs text-fg-1')}>{route.path}</code>
            ),
          },
          {
            key: 'summary',
            header: 'Description',
            render: (route) => <span className="text-xs text-fg-3">{route.summary}</span>,
          },
        ]}
      />
    </>
  );
}
