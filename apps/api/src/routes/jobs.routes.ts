import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import {
  validate,
  paginationSchema,
  uuidSchema,
  addressSchema,
  lineItemSchema,
  materialSchema,
} from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';
import { eventBus, EVENTS } from '../agents/event-bus.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const createJobSchema = z.object({
  customer_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']).default('draft'),
  type: z.string().max(100).optional(),
  description: z.string().min(1).max(5000),
  scheduled_start: z.string().datetime().optional(),
  scheduled_end: z.string().datetime().optional(),
  assigned_tech_id: z.string().uuid().optional(),
  address: addressSchema.optional(),
  line_items: z.array(lineItemSchema).optional(),
  materials: z.array(materialSchema).optional(),
  total_amount: z.number().nonnegative().optional(),
});

const updateJobSchema = createJobSchema.partial();

const jobListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  customer_id: z.string().uuid().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function jobRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List jobs with pagination, filters
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(jobListQuerySchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('jobs')
        .select('*, customer:customers(id, name)', { count: 'exact' })
        .eq('org_id', request.orgId!)
        .order(query.sort, { ascending: query.order === 'asc' })
        .limit(query.limit);

      if (query.cursor) {
        qb = qb.gt('id', query.cursor);
      }

      if (query.status) {
        qb = qb.eq('status', query.status);
      }

      if (query.customer_id) {
        qb = qb.eq('customer_id', query.customer_id);
      }

      if (query.date_from) {
        qb = qb.gte('scheduled_start', query.date_from);
      }

      if (query.date_to) {
        qb = qb.lte('scheduled_start', query.date_to);
      }

      const { data: jobs, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'JOBS_FETCH_FAILED', listError.message);
      }

      const rows = jobs ?? [];
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
      request.log.error({ err }, 'Failed to list jobs');
      throw new AppError(500, 'JOBS_FETCH_FAILED', 'Failed to list jobs');
    }
  });

  // GET /:id — Get single job
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: job, error: fetchError } = await supabaseAdmin
          .from('jobs')
          .select('*, customer:customers(id, name, email, phone)')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !job) {
          throw new NotFoundError('Job not found');
        }

        return reply.send(success(job));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch job');
        throw new AppError(500, 'JOB_FETCH_FAILED', 'Failed to fetch job');
      }
    },
  );

  // POST / — Create job
  app.post('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(createJobSchema, request.body);

    try {
      const { data: job, error: createError } = await supabaseAdmin
        .from('jobs')
        .insert({
          ...body,
          org_id: request.orgId,
          created_by: request.userId,
        })
        .select()
        .single();

      if (createError) {
        throw new AppError(500, 'JOB_CREATE_FAILED', createError.message);
      }

      // Emit job created event
      eventBus.emitEvent({
        type: EVENTS.JOB_CREATED,
        orgId: request.orgId!,
        data: { job_id: job.id, status: job.status },
        source: 'api',
        timestamp: new Date().toISOString(),
      });

      return reply.status(201).send(success(job));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create job');
      throw new AppError(500, 'JOB_CREATE_FAILED', 'Failed to create job');
    }
  });

  // PATCH /:id — Update job
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);
      const body = validate(updateJobSchema, request.body);

      try {
        const { data: job, error: updateError } = await supabaseAdmin
          .from('jobs')
          .update(body)
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !job) {
          throw new NotFoundError('Job not found');
        }

        return reply.send(success(job));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update job');
        throw new AppError(500, 'JOB_UPDATE_FAILED', 'Failed to update job');
      }
    },
  );

  // POST /:id/complete — Mark job as completed
  app.post<{ Params: { id: string } }>(
    '/:id/complete',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const now = new Date().toISOString();

        const { data: job, error: updateError } = await supabaseAdmin
          .from('jobs')
          .update({
            status: 'completed',
            actual_end: now,
          })
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !job) {
          throw new NotFoundError('Job not found');
        }

        // Emit job.completed event for agent processing
        eventBus.emitEvent({
          type: EVENTS.JOB_COMPLETED,
          orgId: request.orgId!,
          data: {
            job_id: job.id,
            customer_id: job.customer_id,
            total_amount: job.total_amount,
            completed_at: now,
          },
          source: 'api',
          timestamp: now,
        });

        return reply.send(success(job));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to complete job');
        throw new AppError(500, 'JOB_COMPLETE_FAILED', 'Failed to mark job as completed');
      }
    },
  );
}
