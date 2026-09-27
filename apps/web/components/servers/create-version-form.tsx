'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

export function CreateVersionForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [kind, setKind] = useState<'stdio' | 'streamable-http'>('streamable-http');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm text-fg-2 hover:border-border-strong"
      >
        Create a new version
      </button>
    );
  }

  const field =
    'w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4';

  return (
    <Card>
      <CardHeader
        title="New version"
        description="A new version starts as a draft with no capability surface. Run Discover to populate it."
      />
      <CardBody>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const transport =
              kind === 'stdio'
                ? {
                    kind: 'stdio' as const,
                    command,
                    args: args.split('\n').map((a) => a.trim()).filter(Boolean),
                    envKeys: [],
                  }
                : { kind: 'streamable-http' as const, url, headerKeys: [] };
            void apiFetch(`/api/v1/servers/${slug}/versions`, {
              method: 'POST',
              body: { version, transport, releaseNotes: notes || null },
            })
              .then(() => {
                setOpen(false);
                setVersion('');
                router.refresh();
              })
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.message : 'Could not create the version.'),
              )
              .finally(() => setPending(false));
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="new-version">
              Version
            </label>
            <input
              id="new-version"
              required
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="1.1.0"
              className={`${field} font-mono`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="new-transport">
              Transport
            </label>
            <select
              id="new-transport"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'stdio' | 'streamable-http')}
              className={field}
            >
              <option value="streamable-http">Streamable HTTP</option>
              <option value="stdio">stdio</option>
            </select>
          </div>
          {kind === 'stdio' ? (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="new-command">
                  Command
                </label>
                <input
                  id="new-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className={`${field} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="new-args">
                  Arguments (one per line)
                </label>
                <textarea
                  id="new-args"
                  rows={2}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  className={`${field} font-mono`}
                />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="new-url">
                Endpoint URL
              </label>
              <input
                id="new-url"
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className={`${field} font-mono`}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="new-notes">
              Release notes
            </label>
            <textarea
              id="new-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={field}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 disabled:opacity-60"
            >
              {pending ? 'Creating…' : 'Create version'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-3"
            >
              Cancel
            </button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
