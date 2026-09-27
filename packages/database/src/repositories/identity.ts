import {
  type Id,
  type MembershipRecord,
  type OrganizationRecord,
  type OrgRole,
  type TeamRecord,
  type UserRecord,
  HubError,
  newId,
  toSlug,
} from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';
import { isUniqueViolation } from '../driver.js';
import { toMembership, toOrganization, toTeam, toUser } from '../rows.js';

export interface UpsertUserInput {
  externalId: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export class IdentityRepository {
  constructor(private readonly db: SqlExecutor) {}

  async upsertUser(input: UpsertUserInput): Promise<UserRecord> {
    const { rows } = await this.db.query(
      `insert into users (id, external_id, email, name, avatar_url)
       values ($1, $2, $3, $4, $5)
       on conflict (external_id) do update
         set email = excluded.email,
             name = coalesce(excluded.name, users.name),
             avatar_url = coalesce(excluded.avatar_url, users.avatar_url)
       returning *`,
      [newId('user'), input.externalId, input.email, input.name ?? null, input.avatarUrl ?? null],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to upsert user.');
    return toUser(row);
  }

  async findUserByExternalId(externalId: string): Promise<UserRecord | null> {
    const { rows } = await this.db.query('select * from users where external_id = $1', [externalId]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUserById(id: Id<'user'>): Promise<UserRecord | null> {
    const { rows } = await this.db.query('select * from users where id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.db.query('select * from users where lower(email) = lower($1)', [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async createOrganization(input: {
    name: string;
    slug?: string;
    externalId?: string | null;
  }): Promise<OrganizationRecord> {
    const slug = input.slug ?? toSlug(input.name);
    try {
      const { rows } = await this.db.query(
        `insert into organizations (id, external_id, slug, name) values ($1, $2, $3, $4) returning *`,
        [newId('organization'), input.externalId ?? null, slug, input.name],
      );
      const row = rows[0];
      if (!row) throw HubError.internal('Failed to create organization.');
      return toOrganization(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HubError('CONFLICT', `An organization with slug "${slug}" already exists.`, {
          details: { slug },
        });
      }
      throw err;
    }
  }

  async findOrganizationById(id: Id<'organization'>): Promise<OrganizationRecord | null> {
    const { rows } = await this.db.query('select * from organizations where id = $1', [id]);
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
    const { rows } = await this.db.query('select * from organizations where slug = $1', [slug]);
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async findOrganizationByExternalId(externalId: string): Promise<OrganizationRecord | null> {
    const { rows } = await this.db.query('select * from organizations where external_id = $1', [
      externalId,
    ]);
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async addMember(
    organizationId: Id<'organization'>,
    userId: Id<'user'>,
    role: OrgRole,
  ): Promise<MembershipRecord> {
    const { rows } = await this.db.query(
      `insert into organization_members (id, organization_id, user_id, role)
       values ($1, $2, $3, $4)
       on conflict (organization_id, user_id) do update set role = excluded.role
       returning *`,
      [newId('membership'), organizationId, userId, role],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to add organization member.');
    return toMembership(row);
  }

  async removeMember(organizationId: Id<'organization'>, userId: Id<'user'>): Promise<void> {
    await this.db.query(
      'delete from organization_members where organization_id = $1 and user_id = $2',
      [organizationId, userId],
    );
  }

  /** The membership row that authorises a request. Null means no access. */
  async findMembership(
    organizationId: Id<'organization'>,
    userId: Id<'user'>,
  ): Promise<MembershipRecord | null> {
    const { rows } = await this.db.query(
      'select * from organization_members where organization_id = $1 and user_id = $2',
      [organizationId, userId],
    );
    return rows[0] ? toMembership(rows[0]) : null;
  }

  async listMemberships(
    userId: Id<'user'>,
  ): Promise<Array<{ membership: MembershipRecord; organization: OrganizationRecord }>> {
    const { rows } = await this.db.query(
      `select m.*, o.id as o_id, o.external_id as o_external_id, o.slug as o_slug,
              o.name as o_name, o.created_at as o_created_at
         from organization_members m
         join organizations o on o.id = m.organization_id
        where m.user_id = $1
        order by o.name asc`,
      [userId],
    );
    return rows.map((row) => ({
      membership: toMembership(row),
      organization: toOrganization({
        id: row['o_id'],
        external_id: row['o_external_id'],
        slug: row['o_slug'],
        name: row['o_name'],
        created_at: row['o_created_at'],
      }),
    }));
  }

  async listMembers(
    organizationId: Id<'organization'>,
  ): Promise<Array<{ membership: MembershipRecord; user: UserRecord }>> {
    const { rows } = await this.db.query(
      `select m.*, u.id as u_id, u.external_id as u_external_id, u.email as u_email,
              u.name as u_name, u.avatar_url as u_avatar_url, u.created_at as u_created_at
         from organization_members m
         join users u on u.id = m.user_id
        where m.organization_id = $1
        order by m.created_at asc`,
      [organizationId],
    );
    return rows.map((row) => ({
      membership: toMembership(row),
      user: toUser({
        id: row['u_id'],
        external_id: row['u_external_id'],
        email: row['u_email'],
        name: row['u_name'],
        avatar_url: row['u_avatar_url'],
        created_at: row['u_created_at'],
      }),
    }));
  }

  async countOwners(organizationId: Id<'organization'>): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from organization_members
        where organization_id = $1 and role = 'owner'`,
      [organizationId],
    );
    return rows[0]?.count ?? 0;
  }

  async createTeam(input: {
    organizationId: Id<'organization'>;
    name: string;
    description?: string | null;
  }): Promise<TeamRecord> {
    const { rows } = await this.db.query(
      `insert into teams (id, organization_id, slug, name, description)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        newId('team'),
        input.organizationId,
        toSlug(input.name),
        input.name,
        input.description ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to create team.');
    return toTeam(row);
  }

  async listTeams(organizationId: Id<'organization'>): Promise<TeamRecord[]> {
    const { rows } = await this.db.query(
      'select * from teams where organization_id = $1 order by name asc',
      [organizationId],
    );
    return rows.map(toTeam);
  }

  async deleteTeam(organizationId: Id<'organization'>, teamId: Id<'team'>): Promise<void> {
    await this.db.query('delete from teams where organization_id = $1 and id = $2', [
      organizationId,
      teamId,
    ]);
  }
}
