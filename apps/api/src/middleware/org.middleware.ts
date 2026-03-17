import type { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError } from '../utils/errors.js';

/**
 * Fastify `preHandler` hook that ensures the authenticated user belongs
 * to an organisation.
 *
 * Must run **after** `authMiddleware` so that `request.orgId` is already
 * populated.  If the JWT did not carry an `org_id` claim the request is
 * rejected with a `403 NO_ORG` error.
 */
export async function orgMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Super-admins may not have an org_id in their JWT (they belong to the
  // internal CrewShift org).  Allow them through — admin routes use
  // orgScopeMiddleware to resolve the target org instead.
  if (request.isSuperAdmin) {
    return;
  }

  if (!request.orgId) {
    const err = new ForbiddenError('No organisation associated with this account');
    // Override the default code so callers can distinguish "no org" from
    // a generic forbidden.
    reply.status(403).send({
      error: {
        code: 'NO_ORG',
        message: err.message,
      },
    });
  }
}
