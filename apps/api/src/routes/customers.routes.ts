import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate, paginationSchema, uuidSchema, addressSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  address: addressSchema.optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(5000).optional(),
});

const updateCustomerSchema = createCustomerSchema.partial();

const customerListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  tag: z.string().optional(),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function customerRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List customers with pagination, search, and tag filter
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(customerListQuerySchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('org_id', request.orgId!)
        .order(query.sort, { ascending: query.order === 'asc' })
        .limit(query.limit);

      if (query.cursor) {
        qb = qb.gt('id', query.cursor);
      }

      if (query.search) {
        qb = qb.or(`name.ilike.%${query.search}%,email.ilike.%${query.search}%,phone.ilike.%${query.search}%`);
      }

      if (query.tag) {
        qb = qb.contains('tags', [query.tag]);
      }

      const { data: customers, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'CUSTOMERS_FETCH_FAILED', listError.message);
      }

      const rows = customers ?? [];
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
      request.log.error({ err }, 'Failed to list customers');
      throw new AppError(500, 'CUSTOMERS_FETCH_FAILED', 'Failed to list customers');
    }
  });

  // GET /:id — Get single customer
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: customer, error: fetchError } = await supabaseAdmin
          .from('customers')
          .select('*')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !customer) {
          throw new NotFoundError('Customer not found');
        }

        return reply.send(success(customer));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch customer');
        throw new AppError(500, 'CUSTOMER_FETCH_FAILED', 'Failed to fetch customer');
      }
    },
  );

  // POST / — Create customer
  app.post('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(createCustomerSchema, request.body);

    try {
      const { data: customer, error: createError } = await supabaseAdmin
        .from('customers')
        .insert({
          ...body,
          org_id: request.orgId,
        })
        .select()
        .single();

      if (createError) {
        throw new AppError(500, 'CUSTOMER_CREATE_FAILED', createError.message);
      }

      return reply.status(201).send(success(customer));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create customer');
      throw new AppError(500, 'CUSTOMER_CREATE_FAILED', 'Failed to create customer');
    }
  });

  // PATCH /:id — Update customer
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);
      const body = validate(updateCustomerSchema, request.body);

      try {
        const { data: customer, error: updateError } = await supabaseAdmin
          .from('customers')
          .update(body)
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !customer) {
          throw new NotFoundError('Customer not found');
        }

        return reply.send(success(customer));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update customer');
        throw new AppError(500, 'CUSTOMER_UPDATE_FAILED', 'Failed to update customer');
      }
    },
  );
}
