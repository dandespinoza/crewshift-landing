import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate, paginationSchema, uuidSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function notificationRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List notifications for current user (paginated)
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(paginationSchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', request.userId)
        .eq('org_id', request.orgId!)
        .order(query.sort, { ascending: query.order === 'asc' })
        .limit(query.limit);

      if (query.cursor) {
        qb = qb.gt('id', query.cursor);
      }

      const { data: notifications, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'NOTIFICATIONS_FETCH_FAILED', listError.message);
      }

      const rows = notifications ?? [];
      return reply.send(
        success(rows, {
          limit: query.limit,
          has_more: rows.length === query.limit,
          next_cursor: rows.length > 0 ? rows[rows.length - 1].id : undefined,
          total: count ?? undefined,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to list notifications');
      throw new AppError(500, 'NOTIFICATIONS_FETCH_FAILED', 'Failed to list notifications');
    }
  });

  // PATCH /:id/read — Mark single notification as read
  app.patch<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: notification, error: updateError } = await supabaseAdmin
          .from('notifications')
          .update({ read: true, read_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', request.userId)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !notification) {
          throw new NotFoundError('Notification not found');
        }

        return reply.send(success(notification));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to mark notification as read');
        throw new AppError(500, 'NOTIFICATION_UPDATE_FAILED', 'Failed to mark notification as read');
      }
    },
  );

  // POST /read-all — Mark all notifications as read for current user
  app.post('/read-all', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { error: updateError } = await supabaseAdmin
        .from('notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('user_id', request.userId)
        .eq('org_id', request.orgId!)
        .eq('read', false);

      if (updateError) {
        throw new AppError(500, 'NOTIFICATIONS_UPDATE_FAILED', updateError.message);
      }

      return reply.send(success({ message: 'All notifications marked as read' }));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to mark all notifications as read');
      throw new AppError(500, 'NOTIFICATIONS_UPDATE_FAILED', 'Failed to mark all as read');
    }
  });
}
