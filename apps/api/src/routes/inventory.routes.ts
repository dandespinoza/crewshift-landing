import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate, paginationSchema, uuidSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const createPartSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  quantity_on_hand: z.number().int().min(0).default(0),
  reorder_point: z.number().int().min(0).default(0),
  unit_cost: z.number().nonnegative().optional(),
  preferred_supplier: z.string().max(255).optional(),
});

const updatePartSchema = createPartSchema.partial();

const inventoryListQuerySchema = paginationSchema.extend({
  category: z.string().optional(),
  search: z.string().optional(),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List inventory with pagination, category filter, search
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(inventoryListQuerySchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('inventory')
        .select('*', { count: 'exact' })
        .eq('org_id', request.orgId!)
        .order(query.sort, { ascending: query.order === 'asc' })
        .limit(query.limit);

      if (query.cursor) {
        qb = qb.gt('id', query.cursor);
      }

      if (query.category) {
        qb = qb.eq('category', query.category);
      }

      if (query.search) {
        qb = qb.or(`name.ilike.%${query.search}%,sku.ilike.%${query.search}%`);
      }

      const { data: parts, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'INVENTORY_FETCH_FAILED', listError.message);
      }

      const rows = parts ?? [];
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
      request.log.error({ err }, 'Failed to list inventory');
      throw new AppError(500, 'INVENTORY_FETCH_FAILED', 'Failed to list inventory');
    }
  });

  // GET /low-stock — List parts below reorder point
  // NOTE: Registered before /:id to avoid route conflict
  app.get('/low-stock', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Use raw filter to compare two columns: quantity_on_hand < reorder_point
      const { data: parts, error: listError } = await supabaseAdmin
        .from('inventory')
        .select('*')
        .eq('org_id', request.orgId!)
        .filter('quantity_on_hand', 'lt', 'reorder_point')
        .order('quantity_on_hand', { ascending: true });

      if (listError) {
        // Fallback: If the column comparison filter doesn't work with Supabase,
        // fetch all and filter in memory
        const { data: allParts, error: fallbackError } = await supabaseAdmin
          .from('inventory')
          .select('*')
          .eq('org_id', request.orgId!)
          .order('quantity_on_hand', { ascending: true });

        if (fallbackError) {
          throw new AppError(500, 'INVENTORY_LOW_STOCK_FAILED', fallbackError.message);
        }

        const lowStock = (allParts ?? []).filter(
          (p: { quantity_on_hand: number; reorder_point: number }) =>
            p.quantity_on_hand < p.reorder_point,
        );

        return reply.send(success(lowStock));
      }

      return reply.send(success(parts ?? []));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch low-stock inventory');
      throw new AppError(500, 'INVENTORY_LOW_STOCK_FAILED', 'Failed to fetch low-stock items');
    }
  });

  // GET /:id — Get single part
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: part, error: fetchError } = await supabaseAdmin
          .from('inventory')
          .select('*')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !part) {
          throw new NotFoundError('Inventory part not found');
        }

        return reply.send(success(part));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch inventory part');
        throw new AppError(500, 'INVENTORY_FETCH_FAILED', 'Failed to fetch inventory part');
      }
    },
  );

  // POST / — Add new part
  app.post('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(createPartSchema, request.body);

    try {
      const { data: part, error: createError } = await supabaseAdmin
        .from('inventory')
        .insert({
          ...body,
          org_id: request.orgId,
        })
        .select()
        .single();

      if (createError) {
        throw new AppError(500, 'INVENTORY_CREATE_FAILED', createError.message);
      }

      return reply.status(201).send(success(part));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create inventory part');
      throw new AppError(500, 'INVENTORY_CREATE_FAILED', 'Failed to add inventory part');
    }
  });

  // PATCH /:id — Update part
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);
      const body = validate(updatePartSchema, request.body);

      try {
        const { data: part, error: updateError } = await supabaseAdmin
          .from('inventory')
          .update(body)
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !part) {
          throw new NotFoundError('Inventory part not found');
        }

        return reply.send(success(part));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update inventory part');
        throw new AppError(500, 'INVENTORY_UPDATE_FAILED', 'Failed to update inventory part');
      }
    },
  );
}
