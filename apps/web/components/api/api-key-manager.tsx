'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, Plus } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Note,
  formatRelative,
} from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface KeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const SCOPES = [
  'servers:read',
  'servers:write',
  'tools:read',
  'tools:execute',
  'validation:run',
  'testing:run',
  'health:read',
  'analytics:read',
  'audit:read',
  'admin',
] as const;

const READ_ONLY: string[] = ['servers:read', 'tools:read', 'health:read', 'analytics:read'];

/**
 * API key management.
 *
 * The plaintext key exists in exactly one place for exactly one moment: the
 * response to its creation. It is never stored, never re-shown and never
 * recoverable — the database holds only a scrypt hash.
 */
export function ApiKeyManager({ canManage, keys }: { canManage: boolean; keys: KeyView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(READ_ONLY);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!canManage) {
    return (
      <Card>
        <CardHeader title="API keys" />
        <CardBody>
          <Note>Only administrators can view or create API keys.</Note>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Each key carries its own scopes and is bound to this organization."
        action={
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-2 hover:border-border-strong"
          >
            <Plus className="size-3" aria-hidden />
            {open ? 'Cancel' : 'New key'}
          </button>
        }
      />

      {created ? (
        <CardBody className="border-b border-border">
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg-1">Copy this key now</p>
                <p className="mt-0.5 text-xs text-fg-3">
                  It is shown once and cannot be recovered. MCP Hub stores only a hash.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface-2 px-2 py-1.5 font-mono text-xs text-fg-1">
                    {created}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(created).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-fg-2"
                  >
                    {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setCreated(null)}
                  className="mt-2 text-xs text-fg-4 hover:text-fg-2"
                >
                  I have stored it
                </button>
              </div>
            </div>
          </div>
        </CardBody>
      ) : null}

      {open ? (
        <CardBody className="border-b border-border">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              void apiFetch<{ plaintext: string }>('/api/v1/api-keys', {
                method: 'POST',
                body: { name, scopes },
              })
                .then((result) => {
                  setCreated(result.plaintext);
                  setOpen(false);
                  setName('');
                  router.refresh();
                })
                .catch((err: unknown) =>
                  setError(err instanceof ApiError ? err.message : 'Could not create the key.'),
                )
                .finally(() => setPending(false));
            }}
          >
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="key-name">
                Name
              </label>
              <input
                id="key-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI pipeline"
                className="w-full rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm text-fg-1 placeholder:text-fg-4"
              />
            </div>
            <fieldset>
              <legend className="mb-1.5 text-xs text-fg-3">Scopes</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-1.5 text-xs text-fg-2">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(event) =>
                        setScopes((current) =>
                          event.target.checked
                            ? [...current, scope]
                            : current.filter((item) => item !== scope),
                        )
                      }
                      className="size-3.5 accent-[var(--color-accent)]"
                    />
                    <code className="font-mono text-[11px]">{scope}</code>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setScopes(READ_ONLY)}
                  className="text-[11px] text-accent hover:underline"
                >
                  Read-only preset
                </button>
                <button
                  type="button"
                  onClick={() => setScopes([])}
                  className="text-[11px] text-fg-4 hover:text-fg-2"
                >
                  Clear
                </button>
              </div>
            </fieldset>
            <button
              type="submit"
              disabled={pending || scopes.length === 0 || name.trim().length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 disabled:opacity-60"
            >
              {pending ? 'Creating…' : 'Create key'}
            </button>
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
          </form>
        </CardBody>
      ) : null}

      {keys.length === 0 ? (
        <CardBody>
          <EmptyState
            className="border-0 py-6"
            icon={<KeyRound className="size-7" />}
            title="No API keys"
            description="Create one to use the SDK, the REST API or MCP Hub's own MCP server."
          />
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {keys.map((key) => (
            <li key={key.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg-1">{key.name}</span>
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-3">
                  {key.prefix}…
                </code>
                {key.revokedAt ? <Badge tone="danger">revoked</Badge> : null}
                {key.expiresAt && new Date(key.expiresAt) < new Date() ? (
                  <Badge tone="warning">expired</Badge>
                ) : null}
                <span className="ml-auto text-xs text-fg-4">
                  last used {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'never'}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {key.scopes.map((scope) => (
                  <Badge key={scope} tone="muted" className="font-mono text-[10px]">
                    {scope}
                  </Badge>
                ))}
              </div>
              {!key.revokedAt ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void apiFetch<{ plaintext: string }>(`/api/v1/api-keys/${key.id}/rotate`, {
                        method: 'POST',
                      }).then((result) => {
                        setCreated(result.plaintext);
                        router.refresh();
                      });
                    }}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-3 hover:text-fg-1"
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void apiFetch(`/api/v1/api-keys/${key.id}`, { method: 'DELETE' }).then(() =>
                        router.refresh(),
                      );
                    }}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-3 hover:text-danger"
                  >
                    Revoke
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
