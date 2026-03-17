/**
 * Organization Repository — data-access layer for the `organizations` and
 * `profiles` tables.
 *
 * Org-level queries do not need an external orgId parameter because the row
 * itself IS the org. Profile queries (team members) are scoped by org_id.
 */

import { eq, and } from 'drizzle-orm';

import { db } from '../index.js';
import {
  organizations,
  profiles,
  type Organization,
  type NewOrganization,
  type Profile,
} from '../schema.js';

// ---------------------------------------------------------------------------
// Organization functions
// ---------------------------------------------------------------------------

/**
 * Get an organization by its ID.
 */
export async function getOrg(orgId: string): Promise<Organization | null> {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return row ?? null;
}

/**
 * Partially update an organization. Bumps `updated_at`.
 */
export async function updateOrg(
  orgId: string,
  data: Partial<NewOrganization>,
): Promise<Organization | null> {
  const [row] = await db
    .update(organizations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning();

  return row ?? null;
}

/**
 * Get the settings JSONB column for an org.
 * Returns the parsed object or an empty object if null.
 */
export async function getOrgSettings(
  orgId: string,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!row) return {};
  return (row.settings as Record<string, unknown>) ?? {};
}

// ---------------------------------------------------------------------------
// Team-member (profiles) functions — scoped by org_id
// ---------------------------------------------------------------------------

/**
 * List all profiles (team members) belonging to an org.
 */
export async function getTeamMembers(orgId: string): Promise<Profile[]> {
  return db
    .select()
    .from(profiles)
    .where(eq(profiles.orgId, orgId))
    .orderBy(profiles.fullName);
}

/**
 * Update a member's role within the org.
 */
export async function updateMemberRole(
  orgId: string,
  profileId: string,
  role: string,
): Promise<Profile | null> {
  const [row] = await db
    .update(profiles)
    .set({ role })
    .where(and(eq(profiles.orgId, orgId), eq(profiles.id, profileId)))
    .returning();

  return row ?? null;
}
