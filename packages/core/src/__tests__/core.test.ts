import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, isId, isSlug, newId, newSecret, toSlug } from '../ids.js';
import { HubError, isHubError, toApiError } from '../errors.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
} from '../pagination.js';
import { fingerprint, percentile, stableStringify, truncate, withTimeout } from '../util.js';
import { effectiveRisk } from '../domain/registry.js';
import { ROLE_RANK, roleAtLeast, scopesForRole } from '../domain/identity.js';

describe('identifiers', () => {
  it('produces prefixed, recognisable ids', () => {
    for (const kind of Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>) {
      const id = newId(kind);
      expect(id.startsWith(`${ID_PREFIXES[kind]}_`), id).toBe(true);
      expect(isId(kind, id)).toBe(true);
    }
  });

  it('does not confuse one kind for another', () => {
    expect(isId('server', newId('version'))).toBe(false);
    expect(isId('server', 'srv_not-hex')).toBe(false);
    expect(isId('server', 42)).toBe(false);
  });

  it('generates high-entropy secrets', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => newSecret(32)));
    expect(secrets.size).toBe(100);
    expect(newSecret(32)).not.toMatch(/[+/=]/); // base64url
  });
});

describe('slugs', () => {
  it.each([
    ['GitHub MCP Server', 'github-mcp-server'],
    ['  spaced  out  ', 'spaced-out'],
    ['Ünïcode Náme', 'unicode-name'],
    ['___weird___', 'weird'],
    ['a/b\\c', 'a-b-c'],
  ])('normalises %s', (input, expected) => {
    expect(toSlug(input)).toBe(expected);
  });

  it('rejects slugs that are not URL-safe', () => {
    expect(isSlug('valid-slug')).toBe(true);
    expect(isSlug('a')).toBe(false);
    expect(isSlug('Has-Capitals')).toBe(false);
    expect(isSlug('double--hyphen')).toBe(false);
    expect(isSlug('-leading')).toBe(false);
    expect(isSlug('x'.repeat(65))).toBe(false);
  });
});

describe('errors', () => {
  it('maps every code to a sensible status', () => {
    expect(new HubError('NOT_FOUND', 'x').status).toBe(404);
    expect(new HubError('RATE_LIMITED', 'x').status).toBe(429);
    expect(new HubError('VERSION_IMMUTABLE', 'x').status).toBe(409);
    expect(new HubError('PAYLOAD_TOO_LARGE', 'x').status).toBe(413);
    expect(new HubError('INTERNAL', 'x').status).toBe(500);
  });

  it('never leaks an unknown error to a client', () => {
    const body = toApiError(new Error('connection to 10.0.0.5:5432 refused'), 'req_1');
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });

  it('passes through a HubError with its details', () => {
    const body = toApiError(HubError.badRequest('Bad slug.', { slug: 'X' }), 'req_2');
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details).toEqual({ slug: 'X' });
    expect(body.error.requestId).toBe('req_2');
  });

  it('is recognisable after crossing a boundary', () => {
    expect(isHubError(HubError.notFound('x'))).toBe(true);
    expect(isHubError(new Error('x'))).toBe(false);
  });
});

describe('pagination', () => {
  it('clamps the page size', () => {
    expect(normalizeLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeLimit('10')).toBe(10);
    expect(normalizeLimit(1000)).toBe(MAX_PAGE_SIZE);
  });

  it('rejects a nonsense limit rather than guessing', () => {
    expect(() => normalizeLimit('-1')).toThrow();
    expect(() => normalizeLimit('abc')).toThrow();
    expect(() => normalizeLimit(0)).toThrow();
  });

  it('round-trips a cursor', () => {
    const when = new Date('2026-09-28T12:00:00.000Z');
    const decoded = decodeCursor(encodeCursor(when, 'srv_abc'));
    expect(decoded.sortValue).toBe(when.toISOString());
    expect(decoded.id).toBe('srv_abc');
  });

  it('handles a sort value containing the separator', () => {
    const decoded = decodeCursor(encodeCursor('a|b|c', 'srv_1'));
    expect(decoded.sortValue).toBe('a|b|c');
    expect(decoded.id).toBe('srv_1');
  });

  it('rejects a malformed cursor', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow();
  });
});

describe('utilities', () => {
  it('serialises stably regardless of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('fingerprints schemas identically when only key order differs', () => {
    const a = { type: 'object', properties: { x: { type: 'string' }, y: { type: 'number' } } };
    const b = { properties: { y: { type: 'number' }, x: { type: 'string' } }, type: 'object' };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('fingerprints differently when a value changes', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it('computes percentiles', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile([], 95)).toBeNull();
  });

  it('truncates without exceeding the limit', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a'.repeat(20), 10)).toHaveLength(10);
  });

  it('bounds a promise that never settles', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'op')).rejects.toThrow(/timed out/);
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'op')).resolves.toBe('ok');
  });
});

describe('roles and risk', () => {
  it('orders roles', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(roleAtLeast('admin', 'developer')).toBe(true);
    expect(roleAtLeast('viewer', 'developer')).toBe(false);
    expect(roleAtLeast('developer', 'developer')).toBe(true);
  });

  it('never gives a viewer an execution scope', () => {
    expect(scopesForRole('viewer')).not.toContain('tools:execute');
    expect(scopesForRole('developer')).toContain('tools:execute');
    expect(scopesForRole('owner')).toContain('admin');
  });

  it('prefers an administrator override over the heuristic', () => {
    expect(effectiveRisk({ riskClass: 'READ', riskOverride: 'DESTRUCTIVE' })).toBe('DESTRUCTIVE');
    expect(effectiveRisk({ riskClass: 'READ', riskOverride: null })).toBe('READ');
  });
});
