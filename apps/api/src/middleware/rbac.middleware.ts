import type { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError } from '../utils/errors.js';
import { error } from '../utils/response.js';

/**
 * Factory that returns a Fastify `preHandler` hook which checks that the
 * authenticated user's role is among the allowed `roles`.
 *
 * Must run **after** `authMiddleware` so that `request.role` is populated.
 *
 * ```ts
 * // Only owners and admins can delete a job
 * app.delete(
 *   '/jobs/:id',
 *   { preHandler: [authMiddleware, orgMiddleware, requireRole('owner', 'admin')] },
 *   deleteJobHandler,
 * );
 * ```
 */
export function requireRole(
  ...roles: string[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userRole = request.role;

    if (!userRole || !roles.includes(userRole)) {
      const err = new ForbiddenError(
        `This action requires one of the following roles: ${roles.join(', ')}`,
      );
      reply.status(err.statusCode).send(error(err));
    }
  };
}
