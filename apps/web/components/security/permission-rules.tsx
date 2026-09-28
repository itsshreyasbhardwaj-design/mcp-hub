'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Note,
  RiskBadge,
  type RiskClass,
} from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface RuleView {
  id: string;
  effect: 'allow' | 'require_approval' | 'deny';
  subjectRole: string | null;
  subjectUserId: string | null;
  serverId: string | null;
  toolName: string | null;
  riskClass: RiskClass | null;
  priority: number;
  description: string | null;
  serverSlug: string | null;
}

const EFFECT_TONES = {
  allow: 'success',
  require_approval: 'warning',
  deny: 'danger',
} as const;

const RISKS: RiskClass[] = [
  'READ',
  'WRITE',
  'NETWORK',
  'CREDENTIAL',
  'DESTRUCTIVE',
  'ADMIN',
  'UNKNOWN',
];

/**
 * Permission rules.
 *
 * Resolution is by specificity, not by list order, so the table shows the
 * scope of each rule rather than implying that the first match wins.
 */
export function PermissionRules({
  rules,
  servers,
  canEdit,
}: {
  rules: RuleView[];
  servers: Array<{ id: string; slug: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [effect, setEffect] = useState<RuleView['effect']>('require_approval');
  const [role, setRole] = useState('');
  const [serverId, setServerId] = useState('');
  const [toolName, setToolName] = useState('');
  const [riskClass, setRiskClass] = useState('');
  const [priority, setPriority] = useState('0');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const field = 'rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg-1';

  return (
    <Card>
      <CardHeader
        title="Permission rules"
        description="The most specific matching rule wins. With no match, sensitive risk classes require approval and everything else is allowed."
        action={
          canEdit ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-2 hover:border-border-strong"
            >
              <Plus className="size-3" aria-hidden />
              {open ? 'Cancel' : 'New rule'}
            </button>
          ) : null
        }
      />

      {open ? (
        <CardBody className="border-b border-border">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              void apiFetch('/api/v1/permissions', {
                method: 'POST',
                body: {
                  effect,
                  subjectRole: role || null,
                  serverId: serverId || null,
                  toolName: toolName || null,
                  riskClass: riskClass || null,
                  priority: Number.parseInt(priority, 10) || 0,
                  description: description || null,
                },
              })
                .then(() => {
                  setOpen(false);
                  setToolName('');
                  setDescription('');
                  router.refresh();
                })
                .catch((err: unknown) =>
                  setError(err instanceof ApiError ? err.message : 'Could not create the rule.'),
                )
                .finally(() => setPending(false));
            }}
          >
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-effect">
                Effect
              </label>
              <select
                id="rule-effect"
                value={effect}
                onChange={(event) => setEffect(event.target.value as RuleView['effect'])}
                className={field}
              >
                <option value="allow">allow</option>
                <option value="require_approval">require approval</option>
                <option value="deny">deny</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-role">
                Role
              </label>
              <select
                id="rule-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className={field}
              >
                <option value="">any role</option>
                <option value="viewer">viewer</option>
                <option value="developer">developer</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-server">
                Server
              </label>
              <select
                id="rule-server"
                value={serverId}
                onChange={(event) => setServerId(event.target.value)}
                className={field}
              >
                <option value="">any server</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.slug}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-tool">
                Tool
              </label>
              <input
                id="rule-tool"
                value={toolName}
                onChange={(event) => setToolName(event.target.value)}
                placeholder="any · delete_*"
                className={`${field} w-32 font-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-risk">
                Risk
              </label>
              <select
                id="rule-risk"
                value={riskClass}
                onChange={(event) => setRiskClass(event.target.value)}
                className={field}
              >
                <option value="">any risk</option>
                {RISKS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-priority">
                Priority
              </label>
              <input
                id="rule-priority"
                type="number"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className={`${field} w-20`}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs text-fg-3" htmlFor="rule-description">
                Description
              </label>
              <input
                id="rule-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Why this rule exists"
                className={`${field} w-full`}
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 disabled:opacity-60"
            >
              {pending ? 'Adding…' : 'Add rule'}
            </button>
            {error ? (
              <p role="alert" className="w-full text-xs text-danger">
                {error}
              </p>
            ) : null}
          </form>
        </CardBody>
      ) : null}

      <DataTable
        caption="Permission rules"
        rows={rules}
        rowKey={(rule) => rule.id}
        empty={
          <div className="px-4 py-8">
            <Note>
              No explicit rules. The default policy applies: sensitive tools require approval,
              everything else is allowed for developers and above.
            </Note>
          </div>
        }
        columns={[
          {
            key: 'effect',
            header: 'Effect',
            width: '150px',
            render: (rule) => (
              <Badge tone={EFFECT_TONES[rule.effect]}>{rule.effect.replace('_', ' ')}</Badge>
            ),
          },
          {
            key: 'subject',
            header: 'Who',
            width: '130px',
            render: (rule) => (
              <span className="text-xs text-fg-3">
                {rule.subjectUserId
                  ? 'a specific user'
                  : rule.subjectRole
                    ? `role: ${rule.subjectRole}`
                    : 'anyone'}
              </span>
            ),
          },
          {
            key: 'scope',
            header: 'What',
            render: (rule) => (
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
                {rule.serverSlug ? (
                  <code className="font-mono text-fg-2">{rule.serverSlug}</code>
                ) : (
                  <span>any server</span>
                )}
                {rule.toolName ? (
                  <code className="font-mono text-fg-2">{rule.toolName}</code>
                ) : null}
                {rule.riskClass ? <RiskBadge risk={rule.riskClass} /> : null}
              </span>
            ),
          },
          {
            key: 'priority',
            header: 'Priority',
            align: 'right',
            width: '80px',
            render: (rule) => <span className="text-xs tabular-nums">{rule.priority}</span>,
          },
          {
            key: 'description',
            header: 'Why',
            render: (rule) => <span className="text-xs text-fg-3">{rule.description ?? '—'}</span>,
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: '60px',
            render: (rule) =>
              canEdit ? (
                <button
                  type="button"
                  aria-label="Delete rule"
                  onClick={() => {
                    void apiFetch(`/api/v1/permissions/${rule.id}`, { method: 'DELETE' }).then(() =>
                      router.refresh(),
                    );
                  }}
                  className="rounded p-1 text-fg-4 hover:text-danger"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
