import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { validate, paginationSchema, uuidSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';
import { AGENT_TYPES } from '../agents/types.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const agentTypeSchema = z.enum(AGENT_TYPES as [string, ...string[]]);

const updateAgentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  autonomy_rules: z.object({
    auto: z.array(z.string()).optional(),
    review: z.array(z.string()).optional(),
    escalate: z.array(z.string()).optional(),
    thresholds: z.object({
      amount_over: z.number().optional(),
      confidence_below: z.number().optional(),
    }).optional(),
  }).optional(),
  settings: z.record(z.unknown()).optional(),
});

const executionListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];
const adminOnly = [...auth, requireRole('owner', 'admin')];
const memberUp = [...auth, requireRole('owner', 'admin', 'member')];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function agentRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List all agent configs for org
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: configs, error: listError } = await supabaseAdmin
        .from('agent_configs')
        .select('*')
        .eq('org_id', request.orgId!)
        .order('agent_type', { ascending: true });

      if (listError) {
        throw new AppError(500, 'AGENTS_FETCH_FAILED', listError.message);
      }

      return reply.send(success(configs ?? []));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to list agent configs');
      throw new AppError(500, 'AGENTS_FETCH_FAILED', 'Failed to list agent configs');
    }
  });

  // GET /review-queue — Get all items awaiting review
  // NOTE: Registered before /:type to avoid route conflict
  app.get('/review-queue', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: items, error: listError } = await supabaseAdmin
        .from('agent_executions')
        .select('*, agent_config:agent_configs(agent_type, name)')
        .eq('org_id', request.orgId!)
        .eq('status', 'awaiting_review')
        .order('created_at', { ascending: false });

      if (listError) {
        throw new AppError(500, 'REVIEW_QUEUE_FETCH_FAILED', listError.message);
      }

      return reply.send(success(items ?? []));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch review queue');
      throw new AppError(500, 'REVIEW_QUEUE_FETCH_FAILED', 'Failed to fetch review queue');
    }
  });

  // GET /executions/:id — Get single execution detail
  app.get<{ Params: { id: string } }>(
    '/executions/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: execution, error: fetchError } = await supabaseAdmin
          .from('agent_executions')
          .select('*')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !execution) {
          throw new NotFoundError('Agent execution not found');
        }

        return reply.send(success(execution));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch execution');
        throw new AppError(500, 'EXECUTION_FETCH_FAILED', 'Failed to fetch agent execution');
      }
    },
  );

  // POST /executions/:id/approve — Approve pending execution
  app.post<{ Params: { id: string } }>(
    '/executions/:id/approve',
    { preHandler: memberUp },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: execution, error: updateError } = await supabaseAdmin
          .from('agent_executions')
          .update({
            status: 'approved',
            reviewed_by: request.userId,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .eq('status', 'awaiting_review')
          .select()
          .single();

        if (updateError || !execution) {
          throw new NotFoundError('Pending execution not found');
        }

        return reply.send(success(execution));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to approve execution');
        throw new AppError(500, 'EXECUTION_APPROVE_FAILED', 'Failed to approve execution');
      }
    },
  );

  // POST /executions/:id/reject — Reject pending execution
  app.post<{ Params: { id: string } }>(
    '/executions/:id/reject',
    { preHandler: memberUp },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: execution, error: updateError } = await supabaseAdmin
          .from('agent_executions')
          .update({
            status: 'rejected',
            reviewed_by: request.userId,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .eq('status', 'awaiting_review')
          .select()
          .single();

        if (updateError || !execution) {
          throw new NotFoundError('Pending execution not found');
        }

        return reply.send(success(execution));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to reject execution');
        throw new AppError(500, 'EXECUTION_REJECT_FAILED', 'Failed to reject execution');
      }
    },
  );

  // GET /:type — Get single agent config
  app.get<{ Params: { type: string } }>(
    '/:type',
    { preHandler: auth },
    async (request, reply) => {
      const agentType = validate(agentTypeSchema, request.params.type);

      try {
        const { data: config, error: fetchError } = await supabaseAdmin
          .from('agent_configs')
          .select('*')
          .eq('org_id', request.orgId!)
          .eq('agent_type', agentType)
          .single();

        if (fetchError || !config) {
          throw new NotFoundError(`Agent config for "${agentType}" not found`);
        }

        return reply.send(success(config));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch agent config');
        throw new AppError(500, 'AGENT_CONFIG_FETCH_FAILED', 'Failed to fetch agent config');
      }
    },
  );

  // PATCH /:type — Update agent config (owner, admin only)
  app.patch<{ Params: { type: string } }>(
    '/:type',
    { preHandler: adminOnly },
    async (request, reply) => {
      const agentType = validate(agentTypeSchema, request.params.type);
      const body = validate(updateAgentConfigSchema, request.body);

      try {
        const { data: config, error: updateError } = await supabaseAdmin
          .from('agent_configs')
          .update(body)
          .eq('org_id', request.orgId!)
          .eq('agent_type', agentType)
          .select()
          .single();

        if (updateError || !config) {
          throw new NotFoundError(`Agent config for "${agentType}" not found`);
        }

        return reply.send(success(config));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update agent config');
        throw new AppError(500, 'AGENT_CONFIG_UPDATE_FAILED', 'Failed to update agent config');
      }
    },
  );

  // GET /:type/executions — List execution history for agent type
  app.get<{ Params: { type: string } }>(
    '/:type/executions',
    { preHandler: auth },
    async (request, reply) => {
      const agentType = validate(agentTypeSchema, request.params.type);
      const query = validate(executionListQuerySchema, request.query);

      try {
        let qb = supabaseAdmin
          .from('agent_executions')
          .select('*', { count: 'exact' })
          .eq('org_id', request.orgId!)
          .eq('agent_type', agentType)
          .order(query.sort, { ascending: query.order === 'asc' })
          .limit(query.limit);

        if (query.cursor) {
          qb = qb.gt('id', query.cursor);
        }

        if (query.status) {
          qb = qb.eq('status', query.status);
        }

        const { data: executions, error: listError, count } = await qb;

        if (listError) {
          throw new AppError(500, 'EXECUTIONS_FETCH_FAILED', listError.message);
        }

        const rows = executions ?? [];
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
        request.log.error({ err }, 'Failed to list executions');
        throw new AppError(500, 'EXECUTIONS_FETCH_FAILED', 'Failed to list agent executions');
      }
    },
  );
}
