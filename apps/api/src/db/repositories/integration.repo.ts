/**
 * Integration Repository — data-access layer for the `integrations` table.
 *
 * Every query is scoped by `org_id` to enforce multi-tenant isolation.
 */

import { eq, and } from 'drizzle-orm';

import { db } from '../index.js';
import {
  integrations,
  type Integration,
  type NewIntegration,
} from '../schema.js';

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * List all integrations for an org.
 */
export async function listIntegrations(orgId: string): Promise<Integration[]> {
  return db
    .select()
    .from(integrations)
    .where(eq(integrations.orgId, orgId))
    .orderBy(integrations.provider);
}

/**
 * Get a specific integration by provider name, scoped to the org.
 */
export async function getIntegration(
  orgId: string,
  provider: string,
): Promise<Integration | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.provider, provider),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Create a new integration record.
 */
export async function createIntegration(
  data: NewIntegration,
): Promise<Integration> {
  const [row] = await db.insert(integrations).values(data).returning();
  return row;
}

/**
 * Partially update an existing integration. Typically used to store
 * refreshed tokens, update status, or record last_sync_at.
 */
export async function updateIntegration(
  orgId: string,
  integrationId: string,
  data: Partial<NewIntegration>,
): Promise<Integration | null> {
  const [row] = await db
    .update(integrations)
    .set(data)
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.id, integrationId),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * Disconnect (remove) an integration for an org.
 *
 * This sets the status to 'disconnected' and clears sensitive token data
 * rather than hard-deleting the row, so historical sync info is preserved.
 */
export async function disconnectIntegration(
  orgId: string,
  integrationId: string,
): Promise<Integration | null> {
  const [row] = await db
    .update(integrations)
    .set({
      status: 'disconnected',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    })
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.id, integrationId),
      ),
    )
    .returning();

  return row ?? null;
}
