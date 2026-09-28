import { describe, expect, it } from 'vitest';
import type { Id, PermissionRuleRecord, RiskClass } from '@mcp-hub/core';
import {
  evaluate,
  matchSpecificity,
  summarizeForSubject,
  type PermissionSubject,
} from '../engine.js';
import { approvalTtlFor, assertCanDecide, evaluateApproval, hashArguments } from '../approvals.js';

const SERVER = 'srv_1' as Id<'server'>;
const VERSION = 'ver_1' as Id<'version'>;
const USER = 'usr_1' as Id<'user'>;

function rule(overrides: Partial<PermissionRuleRecord>): PermissionRuleRecord {
  return {
    id: `perm_${Math.random().toString(36).slice(2)}`,
    organizationId: 'org_1' as Id<'organization'>,
    effect: 'allow',
    subjectUserId: null,
    subjectRole: null,
    serverId: null,
    versionId: null,
    toolName: null,
    riskClass: null,
    environmentId: null,
    priority: 0,
    description: null,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const developer: PermissionSubject = {
  userId: USER,
  role: 'developer',
  scopes: ['tools:execute', 'tools:read'],
};

const request = (toolName: string, riskClass: RiskClass) => ({
  subject: developer,
  serverId: SERVER,
  versionId: VERSION,
  toolName,
  riskClass,
});

describe('the default policy', () => {
  it('allows non-sensitive tools', () => {
    for (const risk of ['READ', 'WRITE', 'NETWORK'] as RiskClass[]) {
      const decision = evaluate(request('x', risk), []);
      expect(decision.effect, risk).toBe('allow');
      expect(decision.source).toBe('default-policy');
    }
  });

  it('requires approval for every sensitive class, including UNKNOWN', () => {
    for (const risk of ['DESTRUCTIVE', 'CREDENTIAL', 'ADMIN', 'UNKNOWN'] as RiskClass[]) {
      expect(evaluate(request('x', risk), []).effect, risk).toBe('require_approval');
    }
  });

  it('explains itself', () => {
    const decision = evaluate(request('drop_table', 'DESTRUCTIVE'), []);
    expect(decision.reason).toMatch(/classified DESTRUCTIVE/);
  });
});

describe('gates that no rule can open', () => {
  it('denies a credential without the execute scope', () => {
    const decision = evaluate(
      { ...request('read_x', 'READ'), subject: { ...developer, scopes: ['tools:read'] } },
      [rule({ effect: 'allow' })],
    );
    expect(decision.effect).toBe('deny');
    expect(decision.source).toBe('scope');
  });

  it('denies a viewer even when a rule allows the tool', () => {
    const decision = evaluate(
      { ...request('read_x', 'READ'), subject: { ...developer, role: 'viewer' } },
      [rule({ effect: 'allow', toolName: 'read_x' })],
    );
    expect(decision.effect).toBe('deny');
    expect(decision.source).toBe('role');
  });

  it('accepts the admin scope in place of tools:execute', () => {
    const decision = evaluate(
      { ...request('read_x', 'READ'), subject: { ...developer, scopes: ['admin'] } },
      [],
    );
    expect(decision.effect).toBe('allow');
  });
});

describe('rule resolution', () => {
  it('prefers the more specific rule regardless of order', () => {
    const broad = rule({ effect: 'allow', riskClass: 'DESTRUCTIVE' });
    const specific = rule({ effect: 'deny', toolName: 'drop_table' });
    expect(evaluate(request('drop_table', 'DESTRUCTIVE'), [broad, specific]).effect).toBe('deny');
    expect(evaluate(request('drop_table', 'DESTRUCTIVE'), [specific, broad]).effect).toBe('deny');
  });

  it('scores an exact tool name above a wildcard', () => {
    const wildcard = rule({ effect: 'allow', toolName: 'drop_*' });
    const exact = rule({ effect: 'deny', toolName: 'drop_table' });
    expect(matchSpecificity(exact, request('drop_table', 'WRITE'))).toBeGreaterThan(
      matchSpecificity(wildcard, request('drop_table', 'WRITE')),
    );
  });

  it('matches a trailing wildcard', () => {
    const wildcard = rule({ effect: 'deny', toolName: 'delete_*' });
    expect(evaluate(request('delete_branch', 'WRITE'), [wildcard]).effect).toBe('deny');
    expect(evaluate(request('create_branch', 'WRITE'), [wildcard]).effect).toBe('allow');
  });

  it('breaks a specificity tie on priority, then on severity', () => {
    const allow = rule({ effect: 'allow', toolName: 'x', priority: 1 });
    const deny = rule({ effect: 'deny', toolName: 'x', priority: 5 });
    expect(evaluate(request('x', 'READ'), [allow, deny]).effect).toBe('deny');

    const a = rule({ effect: 'allow', toolName: 'y', priority: 0 });
    const b = rule({ effect: 'require_approval', toolName: 'y', priority: 0 });
    // Equal specificity and priority resolves toward the stricter effect.
    expect(evaluate(request('y', 'READ'), [a, b]).effect).toBe('require_approval');
  });

  it('ignores a rule that targets a different subject or resource', () => {
    const other = rule({ effect: 'deny', subjectUserId: 'usr_other' as Id<'user'> });
    const elsewhere = rule({ effect: 'deny', serverId: 'srv_other' as Id<'server'> });
    expect(evaluate(request('x', 'READ'), [other, elsewhere]).effect).toBe('allow');
  });

  it('reports every rule it evaluated, for debugging', () => {
    const decision = evaluate(request('x', 'READ'), [
      rule({ effect: 'allow', riskClass: 'READ' }),
      rule({ effect: 'deny', toolName: 'x' }),
    ]);
    expect(decision.evaluated).toHaveLength(2);
    expect(decision.matchedRule).not.toBeNull();
  });

  it('uses the rule description as the reason when there is one', () => {
    const decision = evaluate(request('x', 'READ'), [
      rule({ effect: 'deny', toolName: 'x', description: 'Blocked pending review.' }),
    ]);
    expect(decision.reason).toBe('Blocked pending review.');
  });
});

describe('summarising for a subject', () => {
  it('buckets tools by what would happen', () => {
    const summary = summarizeForSubject(
      developer,
      [
        { serverId: SERVER, versionId: VERSION, name: 'list', riskClass: 'READ' },
        { serverId: SERVER, versionId: VERSION, name: 'drop', riskClass: 'DESTRUCTIVE' },
        { serverId: SERVER, versionId: VERSION, name: 'nope', riskClass: 'READ' },
      ],
      [rule({ effect: 'deny', toolName: 'nope' })],
    );
    expect(summary.allowed).toEqual(['list']);
    expect(summary.requiresApproval).toEqual(['drop']);
    expect(summary.denied).toEqual(['nope']);
  });
});

describe('approval binding', () => {
  const args = { branch: 'tmp', force: true };

  it('hashes arguments independently of key order', () => {
    expect(hashArguments(args)).toBe(hashArguments({ force: true, branch: 'tmp' }));
  });

  it('hashes different arguments differently', () => {
    expect(hashArguments(args)).not.toBe(hashArguments({ branch: 'main', force: true }));
  });

  const approval = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'apr_1',
      status: 'approved',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      argumentsHash: hashArguments(args),
      decidedBy: 'usr_2',
      requestedBy: USER,
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
    }) as any;

  it('accepts an approval that matches exactly', () => {
    const check = evaluateApproval({
      required: true,
      approval: approval(),
      expectedArgumentsHash: hashArguments(args),
      toolName: 'delete_branch',
    });
    expect(check.status).toBe('satisfied');
  });

  it('refuses an approval granted for different arguments', () => {
    const check = evaluateApproval({
      required: true,
      approval: approval(),
      expectedArgumentsHash: hashArguments({ branch: 'main' }),
      toolName: 'delete_branch',
    });
    expect(check.status).toBe('required');
    expect(check.reason).toMatch(/different arguments/);
  });

  it('refuses an approval that was already used', () => {
    const check = evaluateApproval({
      required: true,
      approval: approval({ consumedAt: new Date() }),
      expectedArgumentsHash: hashArguments(args),
      toolName: 'delete_branch',
    });
    expect(check.reason).toMatch(/already been used/);
  });

  it('refuses an expired approval', () => {
    const check = evaluateApproval({
      required: true,
      approval: approval({ expiresAt: new Date(Date.now() - 1000) }),
      expectedArgumentsHash: hashArguments(args),
      toolName: 'delete_branch',
    });
    expect(check.reason).toMatch(/expired/);
  });

  it('refuses a request that has not been approved', () => {
    for (const status of ['pending', 'denied', 'expired']) {
      const check = evaluateApproval({
        required: true,
        approval: approval({ status }),
        expectedArgumentsHash: hashArguments(args),
        toolName: 'delete_branch',
      });
      expect(check.status, status).toBe('required');
    }
  });

  it('needs nothing when no approval is required', () => {
    const check = evaluateApproval({
      required: false,
      approval: null,
      expectedArgumentsHash: 'x',
      toolName: 'list',
    });
    expect(check.status).toBe('not-required');
  });

  it('refuses self-approval', () => {
    expect(() => assertCanDecide(approval(), USER)).toThrow(/cannot decide your own/);
    expect(() => assertCanDecide(approval(), 'usr_other')).not.toThrow();
  });

  it('expires dangerous classes sooner', () => {
    expect(approvalTtlFor('DESTRUCTIVE')).toBeLessThan(approvalTtlFor('CREDENTIAL'));
    expect(approvalTtlFor('CREDENTIAL')).toBeLessThan(approvalTtlFor('READ'));
  });
});
