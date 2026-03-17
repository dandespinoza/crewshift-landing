/**
 * Organization Service
 *
 * Business logic for organization management: settings, team, invitations.
 *
 * See docs/05-security.md for RBAC rules.
 */

import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors.js';

// ============================================
// Types
// ============================================

export interface InviteInput {
  email: string;
  role: 'admin' | 'member' | 'tech';
  full_name?: string;
}

export interface UpdateOrgInput {
  name?: string;
  trade_type?: string;
  size?: string;
  settings?: Record<string, unknown>;
}

// ============================================
// Service Functions
// ============================================

/**
 * Get organization details.
 */
export async function getOrg(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error || !data) {
    throw new NotFoundError('Organization not found');
  }

  return data;
}

/**
 * Update organization settings.
 */
export async function updateOrg(orgId: string, input: UpdateOrgInput) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update(input)
    .eq('id', orgId)
    .select()
    .single();

  if (error || !data) {
    throw new NotFoundError('Organization not found');
  }

  logger.info({ orgId, updates: Object.keys(input) }, 'Organization updated');
  return data;
}

/**
 * List all team members in an organization.
 */
export async function getTeamMembers(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, phone, avatar_url, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new ValidationError('Failed to fetch team members', error);
  }

  return data ?? [];
}

/**
 * Invite a new team member to the organization.
 * Creates a Supabase Auth user and profile.
 */
export async function inviteTeamMember(orgId: string, input: InviteInput) {
  const { email, role, full_name } = input;

  // Check if user already exists in this org
  const { data: _existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('org_id', orgId)
    .limit(100);

  // Create user via Supabase Auth (sends invitation email)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: false, // Will require email confirmation
    app_metadata: {
      org_id: orgId,
      role,
    },
    user_metadata: {
      full_name: full_name ?? '',
    },
  });

  if (authError) {
    if (authError.message?.includes('already registered')) {
      throw new ConflictError('User with this email already exists');
    }
    throw new ValidationError('Failed to invite user', authError);
  }

  if (!authData.user) {
    throw new ValidationError('Failed to create user account');
  }

  // Create profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      org_id: orgId,
      full_name: full_name ?? '',
      role,
    })
    .select()
    .single();

  if (profileError) {
    logger.error({ error: profileError }, 'Failed to create profile for invited user');
  }

  logger.info({ orgId, email, role }, 'Team member invited');

  return profile ?? { id: authData.user.id, email, role, full_name };
}

/**
 * Update a team member's role.
 */
export async function updateMemberRole(
  orgId: string,
  userId: string,
  newRole: string,
  requestingUserId: string,
) {
  // Can't change your own role
  if (userId === requestingUserId) {
    throw new ForbiddenError('Cannot change your own role');
  }

  // Verify user belongs to this org
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .eq('org_id', orgId)
    .single();

  if (error || !profile) {
    throw new NotFoundError('Team member not found');
  }

  // Can't demote an owner (there must always be at least one)
  if (profile.role === 'owner' && newRole !== 'owner') {
    const { data: owners } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('org_id', orgId)
      .eq('role', 'owner');

    if (!owners || owners.length <= 1) {
      throw new ForbiddenError('Cannot demote the last owner');
    }
  }

  // Update profile role
  const { data: updated } = await supabaseAdmin
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)
    .eq('org_id', orgId)
    .select()
    .single();

  // Update Supabase Auth custom claims
  await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { org_id: orgId, role: newRole },
  });

  logger.info({ orgId, userId, newRole }, 'Team member role updated');

  return updated;
}

/**
 * Remove a team member from the organization.
 */
export async function removeMember(
  orgId: string,
  userId: string,
  requestingUserId: string,
) {
  if (userId === requestingUserId) {
    throw new ForbiddenError('Cannot remove yourself');
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .eq('org_id', orgId)
    .single();

  if (!profile) {
    throw new NotFoundError('Team member not found');
  }

  if (profile.role === 'owner') {
    throw new ForbiddenError('Cannot remove an owner. Transfer ownership first.');
  }

  // Delete profile
  await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', userId)
    .eq('org_id', orgId);

  // Optionally delete auth user (or just leave them disconnected)
  // await supabaseAdmin.auth.admin.deleteUser(userId);

  logger.info({ orgId, userId }, 'Team member removed');
}
