'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, FileJson, ShieldAlert } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Note } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface Candidate {
  key: string;
  name: string;
  slug: string;
  transport: Record<string, unknown> & { kind: string };
  environment: Array<{
    key: string;
    description: string | null;
    required: boolean;
    secret: boolean;
  }>;
  summary: string;
  warnings: string[];
  alreadyRegistered: boolean;
}

interface Preview {
  source: string;
  candidates: Candidate[];
  errors: string[];
}

const EXAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": { "LOG_LEVEL": "info" }
    },
    "remote-api": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "\${API_TOKEN}" }
    }
  }
}`;

/**
 * The import pipeline: parse → validate → preview → confirm → register.
 *
 * The preview step is the point of the feature. An operator sees which
 * entries would launch a local process and which literal credential values
 * would be dropped, before anything is written.
 */
export function ImportWizard({ stdioAllowed }: { stdioAllowed: boolean }) {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function parse(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await apiFetch<Preview>('/api/v1/import/preview', {
        method: 'POST',
        body: { content },
      });
      setPreview(result);
      setSelected(
        new Set(
          result.candidates.filter((candidate) => !candidate.alreadyRegistered).map((c) => c.key),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not parse the file.');
    } finally {
      setPending(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      const candidates = preview.candidates
        .filter((candidate) => selected.has(candidate.key))
        .map((candidate) => ({
          slug: candidate.slug,
          name: candidate.name,
          transport: candidate.transport,
          environment: candidate.environment,
        }));
      await apiFetch('/api/v1/import/confirm', { method: 'POST', body: { candidates } });
      router.push('/servers');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid max-w-5xl gap-3">
      <Card>
        <CardHeader title="1. Paste the file" />
        <CardBody className="space-y-3">
          <label className="sr-only" htmlFor="import-content">
            Configuration file contents
          </label>
          <textarea
            id="import-content"
            rows={12}
            spellCheck={false}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={EXAMPLE}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-xs leading-relaxed text-fg-1 placeholder:text-fg-4"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || content.trim().length < 2}
              onClick={() => void parse()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 disabled:opacity-50"
            >
              <FileJson className="size-3.5" aria-hidden />
              {pending ? 'Parsing…' : 'Parse'}
            </button>
            <button
              type="button"
              onClick={() => setContent(EXAMPLE)}
              className="text-xs text-accent hover:underline"
            >
              Use an example
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {preview ? (
        <Card>
          <CardHeader
            title="2. Review what would be registered"
            description={`Detected format: ${preview.source}. ${preview.candidates.length} entr(y/ies) found.`}
          />
          <CardBody className="space-y-3">
            {preview.errors.length > 0 ? (
              <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
                <p className="text-xs font-medium text-danger">Problems in the file</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.errors.map((message) => (
                    <li key={message} className="text-xs text-fg-3">
                      · {message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview.candidates.length === 0 ? (
              <Note>No importable entries were found.</Note>
            ) : (
              <ul className="space-y-2">
                {preview.candidates.map((candidate) => {
                  const isStdio = candidate.transport.kind === 'stdio';
                  const checked = selected.has(candidate.key);
                  return (
                    <li
                      key={candidate.key}
                      className="rounded-md border border-border bg-surface-2/40 p-3"
                    >
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={candidate.alreadyRegistered}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(candidate.key);
                              else next.delete(candidate.key);
                              return next;
                            })
                          }
                          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <code className="font-mono text-sm text-fg-1">{candidate.slug}</code>
                            <Badge
                              tone={isStdio ? 'warning' : 'info'}
                              className="font-mono text-[10px]"
                            >
                              {candidate.transport.kind}
                            </Badge>
                            {candidate.alreadyRegistered ? (
                              <Badge tone="muted">already registered</Badge>
                            ) : null}
                          </span>
                          <code className="mt-1 block break-all font-mono text-[11px] text-fg-3">
                            {candidate.summary}
                          </code>
                          {candidate.environment.length > 0 ? (
                            <span className="mt-1.5 flex flex-wrap gap-1">
                              {candidate.environment.map((requirement) => (
                                <code
                                  key={requirement.key}
                                  className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-fg-2"
                                >
                                  {requirement.key}
                                  {requirement.secret ? ' 🔒' : ''}
                                </code>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </label>

                      {candidate.warnings.length > 0 ? (
                        <ul className="mt-2 space-y-1 border-t border-border pt-2">
                          {candidate.warnings.map((warning) => (
                            <li key={warning} className="flex items-start gap-1.5">
                              {warning.includes('local process') ? (
                                <ShieldAlert
                                  className="mt-0.5 size-3 shrink-0 text-warning"
                                  aria-hidden
                                />
                              ) : (
                                <AlertTriangle
                                  className="mt-0.5 size-3 shrink-0 text-warning"
                                  aria-hidden
                                />
                              )}
                              <span className="text-[11px] leading-relaxed text-fg-3">
                                {warning}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {!stdioAllowed && preview.candidates.some((c) => c.transport.kind === 'stdio') ? (
              <Note>
                stdio transports are disabled on this deployment. Those entries will be registered
                as metadata, but MCP Hub will refuse to launch them until an operator enables
                MCP_HUB_ALLOW_STDIO and allowlists the command.
              </Note>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {preview && preview.candidates.length > 0 ? (
        <Card>
          <CardHeader title="3. Confirm" />
          <CardBody className="space-y-3">
            <Note>
              Selected servers are registered as drafts with no capability surface. Discovery stays
              a separate, explicit action — importing a file never causes a connection.
            </Note>
            <button
              type="button"
              disabled={pending || selected.size === 0}
              onClick={() => void confirm()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
            >
              {pending ? 'Importing…' : `Import ${selected.size} server(s)`}
            </button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
