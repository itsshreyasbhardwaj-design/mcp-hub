'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, cn } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface GeneratedConfig {
  format: string;
  filename: string;
  language: 'json' | 'bash';
  content: string;
  placeholders: string[];
  notes: string[];
}

const FORMATS = [
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'mcp-json', label: 'Generic mcp.json' },
  { value: 'env', label: 'Environment file' },
  { value: 'raw', label: 'Raw metadata' },
] as const;

/**
 * Generates client configuration.
 *
 * Credential values never appear here: the server emits `${NAME}` tokens and
 * lists what the operator must supply, so the output is safe to commit.
 */
export function ConfigGenerator({
  slug,
  versions,
  defaultVersionId,
}: {
  slug: string;
  versions: Array<{ id: string; version: string; deprecated: boolean }>;
  defaultVersionId: string;
}) {
  const [versionId, setVersionId] = useState(defaultVersionId);
  const [format, setFormat] = useState<string>('claude-desktop');
  const [config, setConfig] = useState<GeneratedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(
        await apiFetch<GeneratedConfig>(`/api/v1/servers/${slug}/config`, {
          method: 'POST',
          body: { versionId, format },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate configuration.');
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [slug, versionId, format]);

  useEffect(() => {
    void generate();
  }, [generate]);

  function download(): void {
    if (!config) return;
    const blob = new Blob([config.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = config.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader
        title="Client configuration"
        description="Generated from the stored transport. Credential values are never written into the output."
        action={
          config ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(config.content).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg-3 hover:text-fg-1"
              >
                {copied ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  <Copy className="size-3" aria-hidden />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={download}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg-3 hover:text-fg-1"
              >
                <Download className="size-3" aria-hidden />
                Download
              </button>
            </div>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-3" htmlFor="config-version">
              Version
            </label>
            <select
              id="config-version"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-1"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.version}
                  {version.deprecated ? ' (deprecated)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-3" htmlFor="config-format">
              Format
            </label>
            <select
              id="config-format"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-1"
            >
              {FORMATS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : loading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-fg-4">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Generating…
          </p>
        ) : config ? (
          <>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5">
                <code className="font-mono text-xs text-fg-3">{config.filename}</code>
                <Badge tone="muted" className="text-[10px]">
                  {config.language}
                </Badge>
              </div>
              <pre
                className={cn(
                  'max-h-96 overflow-auto bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin',
                )}
              >
                {config.content}
              </pre>
            </div>

            {config.placeholders.length > 0 ? (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-medium text-fg-2">Fill these in before use</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {config.placeholders.map((placeholder) => (
                    <code
                      key={placeholder}
                      className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-2"
                    >
                      ${'{'}
                      {placeholder}
                      {'}'}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}

            {config.notes.length > 0 ? (
              <ul className="space-y-1">
                {config.notes.map((note) => (
                  <li key={note} className="text-xs leading-relaxed text-fg-3">
                    · {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
