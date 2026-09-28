'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import * as Icons from 'lucide-react';
import { Badge, cn } from '@mcp-hub/ui';
import { NAVIGATION } from '@/lib/nav';

interface SidebarProps {
  organizationName: string;
  organizations: Array<{ organizationId: string; slug: string; name: string; role: string }>;
  badges: { approvals: number; incidents: number };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lucide's index is a name→component map.
const IconMap = Icons as unknown as Record<string, any>;

function NavIcon({ name }: { name: string }) {
  const Component = IconMap[name] ?? Icons.Circle;
  return <Component className="size-4 shrink-0" aria-hidden />;
}

export function Sidebar({ organizationName, organizations, badges }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const badgeFor = (href: string): number => {
    if (href === '/security') return badges.approvals;
    if (href === '/monitoring') return badges.incidents;
    return 0;
  };

  const nav = (
    <nav
      aria-label="Primary"
      className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 scrollbar-thin"
    >
      {NAVIGATION.map((section) => (
        <div key={section.label}>
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-4">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const count = badgeFor(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={item.description}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-surface-3 font-medium text-fg-1'
                        : 'text-fg-3 hover:bg-surface-2 hover:text-fg-2',
                    )}
                  >
                    <NavIcon name={item.icon} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {count > 0 ? (
                      <Badge tone={item.href === '/monitoring' ? 'danger' : 'warning'}>
                        {count}
                      </Badge>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="sidebar"
        className="fixed left-3 top-3 z-50 rounded-md border border-border bg-surface-2 p-2 text-fg-2 lg:hidden"
      >
        {open ? (
          <Icons.X className="size-4" aria-hidden />
        ) : (
          <Icons.Menu className="size-4" aria-hidden />
        )}
        <span className="sr-only">{open ? 'Close navigation' : 'Open navigation'}</span>
      </button>

      <aside
        id="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface-1 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-fg-1">MCP Hub</p>
            <p className="truncate text-[11px] text-fg-4" title={organizationName}>
              {organizationName}
            </p>
          </div>
        </div>

        {nav}

        <div className="border-t border-border px-3 py-3">
          {organizations.length > 1 ? (
            <p className="mb-2 px-2 text-[11px] text-fg-4">{organizations.length} organizations</p>
          ) : null}
          <a
            href="https://github.com/itsshreyasbhardwaj-design/mcp-hub"
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg-4 transition-colors hover:bg-surface-2 hover:text-fg-2"
          >
            <Icons.Code2 className="size-3.5" aria-hidden />
            Source
            <Icons.ExternalLink className="ml-auto size-3" aria-hidden />
          </a>
        </div>
      </aside>

      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}
    </>
  );
}
