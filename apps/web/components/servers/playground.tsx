'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Play, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  RiskBadge,
  cn,
  formatBytes,
  formatDuration,
  type RiskClass,
} from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { exampleFor } from '@/components/schema-inspector';

interface PlaygroundTool {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  riskClass: RiskClass;
}

interface Preview {
  riskClass: RiskClass;
  decision: { effect: 'allow' | 'require_approval' | 'deny'; reason: string; source: string };
  requiresAcknowledgement: boolean;
}

interface ExecutionResult {
  status: string;
  invocationId: string;
  durationMs: number;
  riskClass: RiskClass;
  decision: { effect: string; reason: string; source: string };
  result: {
    content: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
  } | null;
  error: { code: string; message: string } | null;
  requestBytes: number;
  responseBytes: number;
}

const SENSITIVE: RiskClass[] = ['DESTRUCTIVE', 'CREDENTIAL', 'ADMIN', 'UNKNOWN'];

/**
 * The playground.
 *
 * Before anything can run it asks the server what would happen, so the user
 * sees the permission decision — and the reason for it — before they commit.
 * Sensitive tools additionally require a typed confirmation, and the flag
 * that carries it is verified again server-side; unticking the box in the
 * browser is not what stops the call.
 */
export function Playground({
  versionId,
  versionLabel,
  tools,
}: {
  versionId: string;
  versionLabel: string;
  tools: PlaygroundTool[];
}) {
  const [selected, setSelected] = useState(tools[0]?.name ?? '');
  const tool = useMemo(() => tools.find((item) => item.name === selected), [tools, selected]);
  const [args, setArgs] = useState('{}');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalState, setApprovalState] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (!tool) return;
    setPreview(null);
    try {
      setPreview(
        await apiFetch<Preview>('/api/v1/tools/preview', {
          method: 'POST',
          body: { versionId, toolName: tool.name },
        }),
      );
    } catch {
      setPreview(null);
    }
  }, [tool, versionId]);

  useEffect(() => {
    if (!tool) return;
    setArgs(JSON.stringify(exampleFor(tool.inputSchema) ?? {}, null, 2));
    setResult(null);
    setError(null);
    setAcknowledged(false);
    setApprovalState(null);
    void loadPreview();
  }, [tool, loadPreview]);

  let parsedArgs: unknown;
  let parseError: string | null = null;
  try {
    parsedArgs = JSON.parse(args || '{}');
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'Invalid JSON';
  }

  const sensitive = tool ? SENSITIVE.includes(tool.riskClass) : false;
  const blocked = preview?.decision.effect === 'deny';
  const needsApproval = preview?.decision.effect === 'require_approval';
  const canRun =
    Boolean(tool) && !parseError && !running && !blocked && (!sensitive || acknowledged);

  async function run(): Promise<void> {
    if (!tool) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await apiFetch<ExecutionResult>('/api/v1/tools/execute', {
          method: 'POST',
          body: {
            versionId,
            toolName: tool.name,
            arguments: parsedArgs,
            acknowledgeRisk: acknowledged,
          },
        }),
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError('The call failed.');
      }
    } finally {
      setRunning(false);
    }
  }

  async function requestApproval(): Promise<void> {
    if (!tool) return;
    setApprovalState('requesting');
    try {
      await apiFetch('/api/v1/approvals', {
        method: 'POST',
        body: {
          versionId,
          toolName: tool.name,
          arguments: parsedArgs,
          reason: 'Requested from the playground',
        },
      });
      setApprovalState('requested');
    } catch (err) {
      setApprovalState(err instanceof ApiError ? err.message : 'Request failed.');
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Request"
          description={`Version ${versionLabel}`}
          action={tool ? <RiskBadge risk={tool.riskClass} /> : null}
        />
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="tool">
              Tool
            </label>
            <select
              id="tool"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-sm text-fg-1"
            >
              {tools.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} ({item.riskClass})
                </option>
              ))}
            </select>
            {tool?.description ? (
              <p className="mt-1.5 text-xs leading-relaxed text-fg-3">{tool.description}</p>
            ) : null}
          </div>

          {preview ? (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border p-3',
                blocked
                  ? 'border-danger/30 bg-danger/5'
                  : needsApproval
                    ? 'border-warning/30 bg-warning/5'
                    : 'border-success/30 bg-success/5',
              )}
            >
              {blocked ? (
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              ) : needsApproval ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              ) : (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-fg-1">
                  {blocked
                    ? 'This call would be denied'
                    : needsApproval
                      ? 'This call requires approval'
                      : 'This call is allowed'}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
                  {preview.decision.reason}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-fg-4">
                  decided by {preview.decision.source.replace('-', ' ')}
                </p>
              </div>
            </div>
          ) : null}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-2" htmlFor="arguments">
              Arguments
            </label>
            <textarea
              id="arguments"
              rows={10}
              spellCheck={false}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              aria-invalid={parseError !== null}
              aria-describedby={parseError ? 'arguments-error' : undefined}
              className={cn(
                'w-full rounded-md border bg-surface-1 px-3 py-2 font-mono text-xs leading-relaxed text-fg-1',
                parseError ? 'border-danger' : 'border-border',
              )}
            />
            {parseError ? (
              <p id="arguments-error" role="alert" className="mt-1 text-xs text-danger">
                {parseError}
              </p>
            ) : (
              <p className="mt-1 text-xs text-fg-4">
                Pre-filled from the tool&apos;s required parameters.
              </p>
            )}
          </div>

          {sensitive ? (
            <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-warning)]"
              />
              <span className="text-xs leading-relaxed text-fg-2">
                I understand <code className="font-mono">{tool?.name}</code> is classified{' '}
                <strong>{tool?.riskClass}</strong> and may have irreversible effects. The server
                re-checks this acknowledgement; unticking the box is not what prevents the call.
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canRun}
              onClick={() => void run()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
              {running ? 'Running…' : 'Run tool'}
            </button>

            {needsApproval ? (
              <button
                type="button"
                disabled={approvalState === 'requesting'}
                onClick={() => void requestApproval()}
                className="rounded-md border border-border px-3 py-2 text-sm text-fg-2 hover:border-border-strong"
              >
                {approvalState === 'requested' ? 'Approval requested' : 'Request approval'}
              </button>
            ) : null}
          </div>

          {approvalState && approvalState !== 'requesting' ? (
            <p className="text-xs text-fg-3">
              {approvalState === 'requested'
                ? 'An administrator must approve this exact payload. The approval is single-use and bound to these arguments.'
                : approvalState}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Response"
          action={
            result ? (
              <span className="flex items-center gap-2">
                <Badge
                  tone={
                    result.status === 'success'
                      ? 'success'
                      : result.status === 'denied' || result.status === 'blocked'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {result.status}
                </Badge>
                <span className="text-xs text-fg-4">{formatDuration(result.durationMs)}</span>
              </span>
            ) : null
          }
        />
        <CardBody>
          {error ? (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3">
              <p className="text-sm text-danger">{error}</p>
            </div>
          ) : !result ? (
            <p className="py-10 text-center text-sm text-fg-4">
              Run a tool to see the request, response and timing.
            </p>
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-fg-4">Duration</dt>
                  <dd className="text-fg-2">{formatDuration(result.durationMs)}</dd>
                </div>
                <div>
                  <dt className="text-fg-4">Request</dt>
                  <dd className="text-fg-2">{formatBytes(result.requestBytes)}</dd>
                </div>
                <div>
                  <dt className="text-fg-4">Response</dt>
                  <dd className="text-fg-2">{formatBytes(result.responseBytes)}</dd>
                </div>
                <div>
                  <dt className="text-fg-4">Invocation</dt>
                  <dd className="truncate font-mono text-[10px] text-fg-3">
                    {result.invocationId}
                  </dd>
                </div>
              </dl>

              {result.error ? (
                <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
                  <p className="font-mono text-xs text-danger">{result.error.code}</p>
                  <p className="mt-1 text-xs text-fg-2">{result.error.message}</p>
                </div>
              ) : null}

              {result.result?.structuredContent !== undefined ? (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                    Structured output
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-2/60 p-3 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin">
                    {JSON.stringify(result.result.structuredContent, null, 2)}
                  </pre>
                </div>
              ) : null}

              {result.result?.content?.length ? (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                    Content blocks
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-2/60 p-3 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin">
                    {JSON.stringify(result.result.content, null, 2)}
                  </pre>
                </div>
              ) : null}

              <p className="text-[11px] leading-relaxed text-fg-4">
                Tool output is untrusted input. It is redacted for credential-shaped values and
                rendered as text — never interpreted as instructions.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
