import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate, paginationSchema, uuidSchema, lineItemSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';
import { eventBus, EVENTS } from '../agents/event-bus.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const createEstimateSchema = z.object({
  job_id: z.string().uuid().optional(),
  customer_id: z.string().uuid(),
  line_items: z.array(lineItemSchema).min(1),
  tax_rate: z.number().min(0).max(100).default(0),
  notes: z.string().max(5000).optional(),
  due_date: z.string().datetime().optional(),
  valid_until: z.string().datetime().optional(),
});

const updateEstimateSchema = z.object({
  customer_id: z.string().uuid().optional(),
  line_items: z.array(lineItemSchema).min(1).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(5000).optional(),
  due_date: z.string().datetime().optional(),
  valid_until: z.string().datetime().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional(),
});

const estimateListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  customer_id: z.string().uuid().optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function calculateTotals(lineItems: z.infer<typeof lineItemSchema>[], taxRate: number) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax_amount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + tax_amount) * 100) / 100;
  return { subtotal, tax_amount, total };
}

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function estimateRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List estimates with pagination + filters
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(estimateListQuerySchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('estimates')
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

      const { data: estimates, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'ESTIMATES_FETCH_FAILED', listError.message);
      }

      const rows = estimates ?? [];
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
      request.log.error({ err }, 'Failed to list estimates');
      throw new AppError(500, 'ESTIMATES_FETCH_FAILED', 'Failed to list estimates');
    }
  });

  // GET /:id — Get single estimate
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: estimate, error: fetchError } = await supabaseAdmin
          .from('estimates')
          .select('*, customer:customers(id, name, email, phone, address)')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !estimate) {
          throw new NotFoundError('Estimate not found');
        }

        return reply.send(success(estimate));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch estimate');
        throw new AppError(500, 'ESTIMATE_FETCH_FAILED', 'Failed to fetch estimate');
      }
    },
  );

  // POST / — Create estimate (auto-calculate totals)
  app.post('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(createEstimateSchema, request.body);

    try {
      const totals = calculateTotals(body.line_items, body.tax_rate);

      const { data: estimate, error: createError } = await supabaseAdmin
        .from('estimates')
        .insert({
          ...body,
          ...totals,
          org_id: request.orgId,
          status: 'draft',
          created_by: request.userId,
        })
        .select()
        .single();

      if (createError) {
        throw new AppError(500, 'ESTIMATE_CREATE_FAILED', createError.message);
      }

      // Emit estimate created event
      eventBus.emitEvent({
        type: EVENTS.ESTIMATE_CREATED,
        orgId: request.orgId!,
        data: {
          estimate_id: estimate.id,
          customer_id: estimate.customer_id,
          total: totals.total,
        },
        source: 'api',
        timestamp: new Date().toISOString(),
      });

      return reply.status(201).send(success(estimate));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create estimate');
      throw new AppError(500, 'ESTIMATE_CREATE_FAILED', 'Failed to create estimate');
    }
  });

  // PATCH /:id — Update estimate
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);
      const body = validate(updateEstimateSchema, request.body);

      try {
        let updatePayload: Record<string, unknown> = { ...body };

        if (body.line_items || body.tax_rate !== undefined) {
          const { data: current } = await supabaseAdmin
            .from('estimates')
            .select('line_items, tax_rate')
            .eq('id', id)
            .eq('org_id', request.orgId!)
            .single();

          const lineItems = body.line_items ?? current?.line_items ?? [];
          const taxRate = body.tax_rate ?? current?.tax_rate ?? 0;
          const totals = calculateTotals(lineItems, taxRate);
          updatePayload = { ...updatePayload, ...totals };
        }

        const { data: estimate, error: updateError } = await supabaseAdmin
          .from('estimates')
          .update(updatePayload)
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !estimate) {
          throw new NotFoundError('Estimate not found');
        }

        return reply.send(success(estimate));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update estimate');
        throw new AppError(500, 'ESTIMATE_UPDATE_FAILED', 'Failed to update estimate');
      }
    },
  );

  // POST /:id/send — Mark estimate as sent
  app.post<{ Params: { id: string } }>(
    '/:id/send',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const now = new Date().toISOString();

        const { data: estimate, error: updateError } = await supabaseAdmin
          .from('estimates')
          .update({
            status: 'sent',
            sent_at: now,
          })
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !estimate) {
          throw new NotFoundError('Estimate not found');
        }

        // Emit estimate.sent event
        eventBus.emitEvent({
          type: EVENTS.ESTIMATE_SENT,
          orgId: request.orgId!,
          data: {
            estimate_id: estimate.id,
            customer_id: estimate.customer_id,
            total: estimate.total,
            sent_at: now,
          },
          source: 'api',
          timestamp: now,
        });

        return reply.send(success(estimate));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to send estimate');
        throw new AppError(500, 'ESTIMATE_SEND_FAILED', 'Failed to mark estimate as sent');
      }
    },
  );
}
