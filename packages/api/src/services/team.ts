import {
  type MembershipRecord,
  type OrgRole,
  type OrganizationRecord,
  type Principal,
  type TeamRecord,
  type UserRecord,
  HubError,
  ORG_ROLES,
  toSlug,
} from '@mcp-hub/core';
import type { AppContext } from '../context.js';
import { requireRole, requireUser } from '../auth/resolve.js';
import { audit } from './audit.js';

export async function createOrganization(
  context: AppContext,
  user: UserRecord,
  input: { name: string; slug?: string },
): Promise<{ organization: OrganizationRecord; membership: MembershipRecord }> {
  const organization = await context.repositories.identity.createOrganization({
    name: input.name.trim(),
    slug: input.slug?.trim() || toSlug(input.name),
  });
  const membership = await context.repositories.identity.addMember(
    organization.id,
    user.id,
    'owner',
  );
  return { organization, membership };
}

export async function listMembers(
  context: AppContext,
  principal: Principal,
): Promise<Array<{ membership: MembershipRecord; user: UserRecord }>> {
  requireRole(principal, 'viewer');
  return context.repositories.identity.listMembers(principal.organizationId);
}

/**
 * Invites by email.
 *
 * With the dev provider the user must already exist (the seed creates them).
 * With Clerk, membership is normally driven by Clerk's own organization
 * invitations; this path exists so an operator can grant access to an account
 * that has already signed in at least once.
 */
export async function addMember(
  context: AppContext,
  principal: Principal,
  input: { email: string; role: OrgRole },
): Promise<MembershipRecord> {
  requireRole(principal, 'admin');
  if (!ORG_ROLES.includes(input.role)) {
    throw HubError.badRequest(`Unknown role "${input.role}".`, { validRoles: ORG_ROLES });
  }
  if (input.role === 'owner') requireRole(principal, 'owner');

  const user = await context.repositories.identity.findUserByEmail(input.email);
  if (!user) {
    throw HubError.notFound(
      `No account with the email "${input.email}" has signed in yet. Ask them to sign in once, then add them.`,
    );
  }

  const membership = await context.repositories.identity.addMember(
    principal.organizationId,
    user.id,
    input.role,
  );
  await audit(context, principal, {
    action: 'member.added',
    resourceType: 'membership',
    resourceId: membership.id,
    metadata: { email: input.email, role: input.role },
  });
  return membership;
}

export async function changeRole(
  context: AppContext,
  principal: Principal,
  input: { userId: string; role: OrgRole },
): Promise<MembershipRecord> {
  requireRole(principal, 'admin');
  if (input.role === 'owner') requireRole(principal, 'owner');

  const target = await context.repositories.identity.findMembership(
    principal.organizationId,
    input.userId as MembershipRecord['userId'],
  );
  if (!target) throw HubError.notFound('That person is not a member of this organization.');

  // Removing the last owner would leave the organization unadministrable.
  if (target.role === 'owner' && input.role !== 'owner') {
    const owners = await context.repositories.identity.countOwners(principal.organizationId);
    if (owners <= 1) {
      throw HubError.conflict('An organization must keep at least one owner.');
    }
  }

  const membership = await context.repositories.identity.addMember(
    principal.organizationId,
    target.userId,
    input.role,
  );
  await audit(context, principal, {
    action: 'member.role-changed',
    resourceType: 'membership',
    resourceId: membership.id,
    metadata: { from: target.role, to: input.role },
  });
  return membership;
}

export async function removeMember(
  context: AppContext,
  principal: Principal,
  userId: string,
): Promise<void> {
  requireRole(principal, 'admin');
  const actingUserId = requireUser(principal);
  if (userId === actingUserId) {
    throw HubError.badRequest('You cannot remove yourself from the organization.');
  }

  const target = await context.repositories.identity.findMembership(
    principal.organizationId,
    userId as MembershipRecord['userId'],
  );
  if (!target) throw HubError.notFound('That person is not a member of this organization.');
  if (target.role === 'owner') {
    const owners = await context.repositories.identity.countOwners(principal.organizationId);
    if (owners <= 1) throw HubError.conflict('An organization must keep at least one owner.');
    requireRole(principal, 'owner');
  }

  await context.repositories.identity.removeMember(principal.organizationId, target.userId);
  await audit(context, principal, {
    action: 'member.removed',
    resourceType: 'membership',
    resourceId: target.id,
  });
}

export async function listTeams(context: AppContext, principal: Principal): Promise<TeamRecord[]> {
  requireRole(principal, 'viewer');
  return context.repositories.identity.listTeams(principal.organizationId);
}

export async function createTeam(
  context: AppContext,
  principal: Principal,
  input: { name: string; description?: string | null },
): Promise<TeamRecord> {
  requireRole(principal, 'admin');
  const team = await context.repositories.identity.createTeam({
    organizationId: principal.organizationId,
    name: input.name.trim(),
    description: input.description ?? null,
  });
  await audit(context, principal, {
    action: 'team.created',
    resourceType: 'team',
    resourceId: team.id,
    metadata: { name: team.name },
  });
  return team;
}
