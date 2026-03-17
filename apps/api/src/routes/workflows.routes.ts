import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { validate, paginationSchema, uuidSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const workflowStepSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.unknown()),
  next: z.string().optional(),
});

const workflowTriggerSchema = z.object({
  type: z.enum(['event', 'schedule', 'manual']),
  event: z.string().optional(),
  cron: z.string().optional(),
});

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  trigger: workflowTriggerSchema,
  steps: z.array(workflowStepSchema).min(1),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  trigger: workflowTriggerSchema.optional(),
  steps: z.array(workflowStepSchema).min(1).optional(),
  enabled: z.boolean().optional(),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];
const memberUp = [...auth, requireRole('owner', 'admin', 'member')];
const adminOnly = [...auth, requireRole('owner', 'admin')];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function workflowRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List workflows (paginated)
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(paginationSchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('workflows')
        .select('*', { count: 'exact' })
        .eq('org_id', request.orgId!)
        .order(query.sort, { ascending: query.order === 'asc' })
        .limit(query.limit);

      if (query.cursor) {
        qb = qb.gt('id', query.cursor);
      }

      const { data: workflows, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'WORKFLOWS_FETCH_FAILED', listError.message);
      }

      const rows = workflows ?? [];
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
      request.log.error({ err }, 'Failed to list workflows');
      throw new AppError(500, 'WORKFLOWS_FETCH_FAILED', 'Failed to list workflows');
    }
  });

  // POST / — Create workflow (owner, admin, member)
  app.post('/', { preHandler: memberUp }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(createWorkflowSchema, request.body);

    try {
      const { data: workflow, error: createError } = await supabaseAdmin
        .from('workflows')
        .insert({
          ...body,
          org_id: request.orgId,
          created_by: request.userId,
          enabled: true,
        })
        .select()
        .single();

      if (createError) {
        throw new AppError(500, 'WORKFLOW_CREATE_FAILED', createError.message);
      }

      return reply.status(201).send(success(workflow));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create workflow');
      throw new AppError(500, 'WORKFLOW_CREATE_FAILED', 'Failed to create workflow');
    }
  });

  // PATCH /:id — Update workflow
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: memberUp },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);
      const body = validate(updateWorkflowSchema, request.body);

      try {
        const { data: workflow, error: updateError } = await supabaseAdmin
          .from('workflows')
          .update(body)
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !workflow) {
          throw new NotFoundError('Workflow not found');
        }

        return reply.send(success(workflow));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update workflow');
        throw new AppError(500, 'WORKFLOW_UPDATE_FAILED', 'Failed to update workflow');
      }
    },
  );

  // DELETE /:id — Delete workflow (owner, admin)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { error: deleteError } = await supabaseAdmin
          .from('workflows')
          .delete()
          .eq('id', id)
          .eq('org_id', request.orgId!);

        if (deleteError) {
          throw new AppError(500, 'WORKFLOW_DELETE_FAILED', deleteError.message);
        }

        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to delete workflow');
        throw new AppError(500, 'WORKFLOW_DELETE_FAILED', 'Failed to delete workflow');
      }
    },
  );
}
