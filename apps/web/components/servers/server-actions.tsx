'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface Props {
  serverSlug: string;
  serverId: string;
  versionId: string;
  published: boolean;
  isDemo: boolean;
}

type Action = 'discover' | 'validate' | 'test' | 'health';

const LABELS: Record<Action, string> = {
  discover: 'Discover',
  validate: 'Validate',
  test: 'Run tests',
  health: 'Check health',
};

/**
 * The four operations that touch a live server, kept together so the state
 * of each is visible while it runs. Discovery is disabled for published
 * versions because a published capability surface is immutable.
 */
export function ServerActions({ serverSlug, versionId, published, isDemo }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function run(action: Action): Promise<void> {
    setRunning(action);
    setMessage(null);
    try {
      if (action === 'discover') {
        const result = await apiFetch<{
          toolCount: number;
          resourceCount: number;
          promptCount: number;
        }>(`/api/v1/versions/${versionId}/discover`, { method: 'POST', body: {} });
        setMessage({
          tone: 'ok',
          text: `Discovered ${result.toolCount} tool(s), ${result.resourceCount} resource(s), ${result.promptCount} prompt(s).`,
        });
      } else if (action === 'validate') {
        const result = await apiFetch<{
          outcome: string;
          errorCount: number;
          warningCount: number;
        }>(`/api/v1/servers/${serverSlug}/validate`, { method: 'POST' });
        setMessage({
          tone: result.outcome === 'error' ? 'error' : 'ok',
          text: `Validation ${result.outcome}: ${result.errorCount} error(s), ${result.warningCount} warning(s).`,
        });
      } else if (action === 'test') {
        const result = await apiFetch<{ passed: number; warnings: number; failed: number }>(
          `/api/v1/servers/${serverSlug}/test`,
          { method: 'POST', body: { versionId } },
        );
        setMessage({
          tone: result.failed > 0 ? 'error' : 'ok',
          text: `${result.passed} passed, ${result.warnings} warning(s), ${result.failed} failed.`,
        });
      } else {
        const result = await apiFetch<{ status: string; incidentsOpened: number }>(
          `/api/v1/servers/${serverSlug}/health-check`,
          { method: 'POST' },
        );
        setMessage({
          tone: result.status === 'failing' ? 'error' : 'ok',
          text: `Health check: ${result.status}${
            result.incidentsOpened > 0 ? `, ${result.incidentsOpened} incident(s) opened` : ''
          }.`,
        });
      }
      router.refresh();
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'The action failed.',
      });
    } finally {
      setRunning(null);
    }
  }

  const buttons: Array<{
    action: Action;
    icon: React.ReactNode;
    disabled?: boolean;
    title?: string;
  }> = [
    {
      action: 'discover',
      icon: <RefreshCw className="size-3.5" aria-hidden />,
      disabled: published || isDemo,
      title: published
        ? 'This version is published, so its capability surface is immutable. Create a new version.'
        : isDemo
          ? 'Demo servers are fictional and cannot be connected to.'
          : 'Connect and record the tools, resources and prompts this server exposes.',
    },
    {
      action: 'validate',
      icon: <ShieldCheck className="size-3.5" aria-hidden />,
      title: 'Run the validation rules against the stored metadata.',
    },
    {
      action: 'test',
      icon: <Zap className="size-3.5" aria-hidden />,
      disabled: isDemo,
      title: isDemo
        ? 'Demo servers cannot be connected to.'
        : 'Run the compatibility suites against the live server.',
    },
    {
      action: 'health',
      icon: <CheckCircle2 className="size-3.5" aria-hidden />,
      disabled: isDemo,
      title: isDemo ? 'Demo servers are never health-checked.' : 'Run a health check now.',
    },
  ];

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-1.5">
        {buttons.map((button) => (
          <button
            key={button.action}
            type="button"
            title={button.title}
            disabled={button.disabled || running !== null}
            onClick={() => void run(button.action)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors',
              'hover:border-border-strong hover:text-fg-1 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {running === button.action ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              button.icon
            )}
            {LABELS[button.action]}
          </button>
        ))}
      </div>
      {message ? (
        <p
          role="status"
          className={cn('text-xs', message.tone === 'error' ? 'text-danger' : 'text-success')}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
