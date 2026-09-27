import type { Id } from '../ids.js';
import type { OrgRole } from './enums.js';

export interface UserRecord {
  id: Id<'user'>;
  /** Stable identifier from the auth provider (Clerk user id, or dev-provider id). */
  externalId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface OrganizationRecord {
  id: Id<'organization'>;
  externalId: string | null;
  slug: string;
  name: string;
  createdAt: Date;
}

export interface MembershipRecord {
  id: Id<'membership'>;
  organizationId: Id<'organization'>;
  userId: Id<'user'>;
  role: OrgRole;
  createdAt: Date;
}

export interface TeamRecord {
  id: Id<'team'>;
  organizationId: Id<'organization'>;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
}

/** Everything authorisation needs, resolved once per request. */
export interface Principal {
  kind: 'user' | 'api_key' | 'system';
  userId: Id<'user'> | null;
  organizationId: Id<'organization'>;
  role: OrgRole;
  /** API-key scopes; a user principal has the scopes implied by its role. */
  scopes: readonly string[];
  apiKeyId?: Id<'apiKey'> | null;
  displayName: string;
}

export const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

export function roleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Scopes usable on API keys. Kept flat and explicit rather than wildcarded. */
export const API_SCOPES = [
  'servers:read',
  'servers:write',
  'tools:read',
  'tools:execute',
  'validation:run',
  'testing:run',
  'health:read',
  'analytics:read',
  'audit:read',
  'admin',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Default scope set granted to a user principal, derived from their role. */
export function scopesForRole(role: OrgRole): ApiScope[] {
  switch (role) {
    case 'owner':
    case 'admin':
      return [...API_SCOPES];
    case 'developer':
      return [
        'servers:read',
        'servers:write',
        'tools:read',
        'tools:execute',
        'validation:run',
        'testing:run',
        'health:read',
        'analytics:read',
      ];
    case 'viewer':
      return ['servers:read', 'tools:read', 'health:read', 'analytics:read'];
  }
}

export interface ApiKeyRecord {
  id: Id<'apiKey'>;
  organizationId: Id<'organization'>;
  name: string;
  /** First 8 characters of the key, shown in the UI so keys can be told apart. */
  prefix: string;
  /** Argon2-style KDF output. The plaintext key is never persisted. */
  hash: string;
  scopes: ApiScope[];
  createdBy: Id<'user'> | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}
