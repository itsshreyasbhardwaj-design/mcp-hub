'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';
import { Badge } from '@mcp-hub/ui';
import { apiFetch } from '@/lib/api';
import { CommandPalette } from '@/components/shell/command-palette';

interface TopBarProps {
  userName: string;
  userEmail: string;
  role: string;
  hasDemoData: boolean;
}

export function TopBar({ userName, userEmail, role, hasDemoData }: TopBarProps) {
  const router = useRouter();
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);

  function toggleTheme(): void {
    const next =
      (document.documentElement.dataset['theme'] ?? 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset['theme'] = next;
    setTheme(next);
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface-0/85 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="ml-10 min-w-0 flex-1 lg:ml-0">
        <CommandPalette />
      </div>

      {hasDemoData ? (
        <Badge
          tone="accent"
          className="hidden sm:inline-flex"
          title="This organization contains fictional servers created by the seed script. They are flagged DEMO DATA everywhere they appear and are never health-checked."
        >
          Demo data present
        </Badge>
      ) : null}

      <button
        type="button"
        onClick={toggleTheme}
        className="rounded-md p-2 text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1"
      >
        {theme === 'light' ? (
          <Moon className="size-4" aria-hidden />
        ) : (
          <Sun className="size-4" aria-hidden />
        )}
        <span className="sr-only">Switch to {theme === 'light' ? 'dark' : 'light'} theme</span>
      </button>

      <div className="hidden items-center gap-2 border-l border-border pl-3 sm:flex">
        <div className="text-right">
          <p className="max-w-40 truncate text-xs font-medium text-fg-2">{userName}</p>
          <p className="max-w-40 truncate text-[11px] text-fg-4">{userEmail}</p>
        </div>
        <Badge tone={role === 'owner' || role === 'admin' ? 'accent' : 'neutral'}>{role}</Badge>
      </div>

      <button
        type="button"
        title="Sign out"
        onClick={() => {
          void apiFetch('/api/v1/auth/sign-out', { method: 'POST' }).finally(() => {
            router.push('/sign-in');
            router.refresh();
          });
        }}
        className="rounded-md p-2 text-fg-3 transition-colors hover:bg-surface-2 hover:text-danger"
      >
        <LogOut className="size-4" aria-hidden />
        <span className="sr-only">Sign out</span>
      </button>
    </header>
  );
}
