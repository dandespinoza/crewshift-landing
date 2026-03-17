import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';

/**
 * Fastify `preHandler` hook that resolves the target organisation from the
 * `:orgId` route parameter and injects it into `request.orgId`.
 *
 * Used on super-admin routes (e.g. `/api/admin/orgs/:orgId/...`) so that
 * downstream handlers can use `request.orgId` the same way regular
 * org-scoped routes do.
 *
 * Must run **after** `requireSuperAdmin` — only super-admins may act on
 * behalf of an arbitrary organisation.
 */
export async function orgScopeMiddleware(
  request: FastifyRequest<{ Params: { orgId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { orgId } = request.params;

  if (!orgId) {
    reply.status(400).send({
      error: {
        code: 'MISSING_ORG_ID',
        message: 'Route requires an orgId parameter',
      },
    });
    return;
  }

  // Verify the org exists
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) {
    reply.status(404).send({
      error: {
        code: 'ORG_NOT_FOUND',
        message: `Organisation ${orgId} not found`,
      },
    });
    return;
  }

  // Inject the target org so downstream handlers can use request.orgId
  request.orgId = orgId;
}
