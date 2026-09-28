import { randomUUID, randomBytes } from 'node:crypto';

/**
 * Every identifier in MCP Hub is a prefixed, URL-safe string. The prefix makes
 * IDs self-describing in logs and audit trails, and makes it impossible to pass
 * a version ID where a server ID was expected without it being obvious.
 */
export const ID_PREFIXES = {
  organization: 'org',
  user: 'usr',
  membership: 'mem',
  team: 'team',
  server: 'srv',
  version: 'ver',
  tool: 'tool',
  resource: 'res',
  prompt: 'prm',
  environment: 'env',
  validationRun: 'vrun',
  validationFinding: 'vfnd',
  compatibilityRun: 'crun',
  compatibilityCase: 'ccase',
  healthCheck: 'hcheck',
  incident: 'inc',
  incidentEvent: 'incev',
  invocation: 'inv',
  approval: 'apr',
  permissionRule: 'perm',
  apiKey: 'key',
  auditLog: 'aud',
  event: 'evt',
  job: 'job',
  finding: 'sfnd',
  request: 'req',
  session: 'sess',
  snapshot: 'snap',
  searchDoc: 'sdoc',
  secret: 'sec',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type Id<K extends IdKind> = string & { readonly __idKind?: K };

/** Generates a new prefixed identifier, e.g. `srv_9f1c2d...`. */
export function newId<K extends IdKind>(kind: K): Id<K> {
  return `${ID_PREFIXES[kind]}_${randomUUID().replace(/-/g, '')}` as Id<K>;
}

/** True when `value` is a syntactically valid identifier of the given kind. */
export function isId<K extends IdKind>(kind: K, value: unknown): value is Id<K> {
  return typeof value === 'string' && new RegExp(`^${ID_PREFIXES[kind]}_[0-9a-f]{32}$`).test(value);
}

/** Generates an opaque, high-entropy secret (used for API keys and sessions). */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Normalises arbitrary text into a registry slug. */
export function toSlug(input: string): string {
  return (
    input
      .normalize('NFKD')
      // NFKD splits accented letters into a base plus a combining mark.
      // Dropping the marks turns "Náme" into "name" rather than "na-me".
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      // A trailing hyphen can reappear after slicing mid-word.
      .replace(/-+$/, '')
  );
}

export function isSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && SLUG_RE.test(value);
}
