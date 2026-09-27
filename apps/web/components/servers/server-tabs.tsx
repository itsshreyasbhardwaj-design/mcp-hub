'use client';

import Link from 'next/link';
import { cn } from '@mcp-hub/ui';

export type ServerTab =
  | 'overview'
  | 'tools'
  | 'capabilities'
  | 'versions'
  | 'health'
  | 'security'
  | 'playground'
  | 'config';

const LABELS: Record<ServerTab, string> = {
  overview: 'Overview',
  tools: 'Tools',
  capabilities: 'Resources & prompts',
  versions: 'Versions',
  health: 'Health',
  security: 'Security',
  playground: 'Playground',
  config: 'Configuration',
};

export function ServerTabs({
  slug,
  active,
  counts,
  versionId,
}: {
  slug: string;
  active: ServerTab;
  counts: { tools: number; capabilities: number; versions: number };
  versionId: string | null;
}) {
  const countFor = (tab: ServerTab): number | null => {
    if (tab === 'tools') return counts.tools;
    if (tab === 'capabilities') return counts.capabilities;
    if (tab === 'versions') return counts.versions;
    return null;
  };

  return (
    <nav
      aria-label="Server sections"
      className="flex gap-1 overflow-x-auto border-b border-border scrollbar-thin"
    >
      {(Object.keys(LABELS) as ServerTab[]).map((tab) => {
        const count = countFor(tab);
        const href = `/servers/${slug}?tab=${tab}${versionId ? `&versionId=${versionId}` : ''}`;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active === tab ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active === tab
                ? 'border-accent font-medium text-fg-1'
                : 'border-transparent text-fg-3 hover:border-border-strong hover:text-fg-2',
            )}
          >
            {LABELS[tab]}
            {count !== null ? (
              <span className="ml-1.5 text-xs text-fg-4 tabular-nums">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
