import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Fastify `preHandler` hook that ensures the authenticated user is a
 * CrewShift super-admin.
 *
 * Must run **after** `authMiddleware` so that `request.isSuperAdmin` is
 * already populated from the JWT.
 */
export async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.isSuperAdmin) {
    reply.status(403).send({
      error: {
        code: 'SUPER_ADMIN_REQUIRED',
        message: 'This endpoint requires super-admin access',
      },
    });
  }
}
