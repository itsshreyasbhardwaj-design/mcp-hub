'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, ShieldQuestion } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Note,
  RiskBadge,
  formatRelative,
  type RiskClass,
} from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface ApprovalView {
  id: string;
  toolName: string;
  riskClass: RiskClass;
  status: string;
  reason: string | null;
  argumentsJson: Record<string, unknown>;
  requestedBy: string;
  decidedBy: string | null;
  expiresAt: string;
  createdAt: string;
  serverSlug: string;
}

/**
 * The approval queue.
 *
 * An approval authorises one execution of one tool with one exact argument
 * payload, which is why the arguments are shown in full: the reviewer is
 * approving that payload, not the tool.
 */
export function ApprovalQueue({
  approvals,
  canDecide,
  currentUserId,
}: {
  approvals: ApprovalView[];
  canDecide: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function decide(id: string, decision: 'approved' | 'denied'): Promise<void> {
    setPending(id);
    setError(null);
    try {
      await apiFetch(`/api/v1/approvals/${id}/decision`, {
        method: 'POST',
        body: { decision, reason: reasons[id] ?? null },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The decision failed.');
    } finally {
      setPending(null);
    }
  }

  const waiting = approvals.filter((approval) => approval.status === 'pending');

  return (
    <Card>
      <CardHeader
        title="Approvals"
        description="Each approval is single-use and bound to a hash of the exact arguments."
      />
      {approvals.length === 0 ? (
        <CardBody>
          <EmptyState
            className="border-0 py-6"
            icon={<ShieldQuestion className="size-7" />}
            title="No approval requests"
            description="Sensitive tools generate a request here when someone tries to run them."
          />
        </CardBody>
      ) : (
        <ul className="max-h-[420px] divide-y divide-border overflow-y-auto scrollbar-thin">
          {approvals.map((approval) => {
            const isSelf = approval.requestedBy === currentUserId;
            const decidable = canDecide && approval.status === 'pending' && !isSelf;
            return (
              <li key={approval.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      approval.status === 'pending'
                        ? 'warning'
                        : approval.status === 'approved'
                          ? 'success'
                          : approval.status === 'consumed'
                            ? 'muted'
                            : 'danger'
                    }
                  >
                    {approval.status}
                  </Badge>
                  <code className="font-mono text-xs text-fg-1">
                    <span className="text-fg-4">{approval.serverSlug}.</span>
                    {approval.toolName}
                  </code>
                  <RiskBadge risk={approval.riskClass} />
                  <span className="ml-auto text-xs text-fg-4">
                    {formatRelative(approval.createdAt)}
                  </span>
                </div>

                {approval.reason ? (
                  <p className="mt-1 text-xs text-fg-3">“{approval.reason}”</p>
                ) : null}

                <pre className="mt-2 max-h-28 overflow-auto rounded border border-border bg-surface-2/60 p-2 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin">
                  {JSON.stringify(approval.argumentsJson, null, 2)}
                </pre>

                {approval.status === 'pending' ? (
                  <p className="mt-1 text-[11px] text-fg-4">
                    Expires {formatRelative(approval.expiresAt)}
                  </p>
                ) : null}

                {decidable ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`reason-${approval.id}`}>
                      Decision reason
                    </label>
                    <input
                      id={`reason-${approval.id}`}
                      value={reasons[approval.id] ?? ''}
                      onChange={(event) =>
                        setReasons((current) => ({ ...current, [approval.id]: event.target.value }))
                      }
                      placeholder="Reason (recorded in the audit log)"
                      className="min-w-[180px] flex-1 rounded border border-border bg-surface-1 px-2 py-1 text-xs text-fg-1 placeholder:text-fg-4"
                    />
                    <button
                      type="button"
                      disabled={pending === approval.id}
                      onClick={() => void decide(approval.id, 'approved')}
                      className="inline-flex items-center gap-1 rounded bg-success/15 px-2 py-1 text-xs font-medium text-success hover:bg-success/25 disabled:opacity-50"
                    >
                      <CheckCircle2 className="size-3" aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={pending === approval.id}
                      onClick={() => void decide(approval.id, 'denied')}
                      className="rounded bg-danger/15 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/25 disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                ) : approval.status === 'pending' ? (
                  <p className="mt-2 text-[11px] text-fg-4">
                    {isSelf
                      ? 'You requested this, so someone else has to decide it.'
                      : 'Only an administrator can decide this request.'}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <div className="border-t border-border px-4 py-2">
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        </div>
      ) : null}
      {waiting.length > 0 ? (
        <div className="border-t border-border px-4 py-2">
          <Note>{waiting.length} request(s) waiting on a decision.</Note>
        </div>
      ) : null}
    </Card>
  );
}
