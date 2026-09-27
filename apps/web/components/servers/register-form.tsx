'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

type TransportKind = 'stdio' | 'streamable-http';

interface Props {
  stdioAllowed: boolean;
  allowedCommands: string[];
  privateNetworkAllowed: boolean;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function RegisterServerForm({ stdioAllowed, allowedCommands, privateNetworkAllowed }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState('organization');
  const [kind, setKind] = useState<TransportKind>(stdioAllowed ? 'stdio' : 'streamable-http');
  const [version, setVersion] = useState('1.0.0');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envKeys, setEnvKeys] = useState('');
  const [healthInterval, setHealthInterval] = useState('900');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [pending, setPending] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const keys = envKeys
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setIssues([]);

    const transport =
      kind === 'stdio'
        ? {
            kind: 'stdio' as const,
            command: command.trim(),
            args: args.split('\n').map((a) => a.trim()).filter(Boolean),
            envKeys: keys,
          }
        : { kind: 'streamable-http' as const, url: url.trim(), headerKeys: keys };

    try {
      const result = await apiFetch<{ server: { slug: string } }>('/api/v1/servers', {
        method: 'POST',
        body: {
          name: name.trim(),
          slug: effectiveSlug,
          description: description.trim() || null,
          repositoryUrl: repositoryUrl.trim() || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          visibility,
          status: 'draft',
          healthIntervalSeconds: healthInterval ? Number.parseInt(healthInterval, 10) : null,
          version: {
            version: version.trim(),
            transport,
            environment: keys.map((key) => ({
              key,
              description: null,
              required: true,
              secret: /key|token|secret|password|auth/i.test(key),
            })),
          },
        },
      });
      router.push(`/servers/${result.server.slug}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues((err.details?.['issues'] as Array<{ path: string; message: string }>) ?? []);
      } else {
        setError('Registration failed.');
      }
    } finally {
      setPending(false);
    }
  }

  const field =
    'w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4';
  const label = 'mb-1.5 block text-sm font-medium text-fg-2';
  const hint = 'mt-1 text-xs text-fg-4';

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-3">
      <Card>
        <CardHeader title="Identity" description="How this server appears in the registry." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="name">
              Name
            </label>
            <input
              id="name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="GitHub MCP Server"
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="slug">
              Slug
            </label>
            <input
              id="slug"
              value={effectiveSlug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="github-mcp-server"
              className={`${field} font-mono`}
            />
            <p className={hint}>Used in URLs and generated configuration. Must be unique.</p>
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              rows={2}
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this server does and when to reach for it."
              className={field}
            />
            <p className={hint}>Search ranks heavily on this text.</p>
          </div>
          <div>
            <label className={label} htmlFor="repository">
              Repository URL
            </label>
            <input
              id="repository"
              type="url"
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder="https://github.com/org/repo"
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="tags">
              Tags
            </label>
            <input
              id="tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="git, code-review"
              className={field}
            />
            <p className={hint}>Comma separated.</p>
          </div>
          <div>
            <label className={label} htmlFor="visibility">
              Visibility
            </label>
            <select
              id="visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value)}
              className={field}
            >
              <option value="private">Private — only people you name</option>
              <option value="organization">Organization — everyone in this organization</option>
              <option value="public">Public — discoverable by other organizations</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="interval">
              Health-check interval
            </label>
            <select
              id="interval"
              value={healthInterval}
              onChange={(event) => setHealthInterval(event.target.value)}
              className={field}
            >
              <option value="">Manual only</option>
              <option value="300">Every 5 minutes</option>
              <option value="900">Every 15 minutes</option>
              <option value="3600">Every hour</option>
            </select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="First version"
          description="How MCP Hub connects when you ask it to discover, test or execute."
        />
        <CardBody className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="version">
                Version
              </label>
              <input
                id="version"
                required
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="1.0.0"
                className={`${field} font-mono`}
              />
            </div>
            <div>
              <label className={label} htmlFor="transport">
                Transport
              </label>
              <select
                id="transport"
                value={kind}
                onChange={(event) => setKind(event.target.value as TransportKind)}
                className={field}
              >
                <option value="streamable-http">Streamable HTTP</option>
                <option value="stdio" disabled={!stdioAllowed}>
                  stdio {stdioAllowed ? '' : '(disabled on this deployment)'}
                </option>
              </select>
            </div>
          </div>

          {kind === 'stdio' ? (
            <>
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <p className="text-xs leading-relaxed text-fg-3">
                  A stdio server runs as a local process. MCP Hub only launches executables on the
                  allowlist:{' '}
                  <code className="font-mono text-fg-2">{allowedCommands.join(', ')}</code>. Nothing
                  is executed at registration time.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="command">
                    Command
                  </label>
                  <input
                    id="command"
                    required
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    className={`${field} font-mono`}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="args">
                    Arguments
                  </label>
                  <textarea
                    id="args"
                    rows={3}
                    value={args}
                    onChange={(event) => setArgs(event.target.value)}
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/tmp'}
                    className={`${field} font-mono`}
                  />
                  <p className={hint}>One argument per line. Never a shell string.</p>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className={label} htmlFor="url">
                Endpoint URL
              </label>
              <input
                id="url"
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className={`${field} font-mono`}
              />
              <p className={hint}>
                {privateNetworkAllowed
                  ? 'Private addresses are permitted on this deployment (MCP_HUB_ALLOW_PRIVATE_NETWORK=true).'
                  : 'Endpoints resolving to private, loopback or metadata addresses are refused.'}
              </p>
            </div>
          )}

          <div>
            <label className={label} htmlFor="env">
              {kind === 'stdio' ? 'Environment variables' : 'Header names'}
            </label>
            <input
              id="env"
              value={envKeys}
              onChange={(event) => setEnvKeys(event.target.value)}
              placeholder={kind === 'stdio' ? 'GITHUB_TOKEN, API_BASE' : 'Authorization'}
              className={`${field} font-mono`}
            />
            <div className="mt-1 flex items-start gap-1.5">
              <Info className="mt-0.5 size-3 shrink-0 text-fg-4" aria-hidden />
              <p className="text-xs text-fg-4">
                Names only. Values are stored separately, encrypted, after registration.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3">
          <p className="text-sm font-medium text-danger">{error}</p>
          {issues.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`} className="text-xs text-fg-3">
                  <code className="font-mono text-fg-2">{issue.path}</code> — {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || name.trim().length === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-0 transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {pending ? 'Registering…' : 'Register server'}
        </button>
        <p className="text-xs text-fg-4">
          Discovery, validation and testing are separate, explicit actions afterwards.
        </p>
      </div>
    </form>
  );
}
