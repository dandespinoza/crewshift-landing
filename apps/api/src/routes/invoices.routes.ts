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

const createInvoiceSchema = z.object({
  job_id: z.string().uuid().optional(),
  customer_id: z.string().uuid(),
  line_items: z.array(lineItemSchema).min(1),
  tax_rate: z.number().min(0).max(100).default(0),
  notes: z.string().max(5000).optional(),
  due_date: z.string().datetime().optional(),
});

const updateInvoiceSchema = z.object({
  customer_id: z.string().uuid().optional(),
  line_items: z.array(lineItemSchema).min(1).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(5000).optional(),
  due_date: z.string().datetime().optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
});

const invoiceListQuerySchema = paginationSchema.extend({
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

export default async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List invoices with pagination + filters
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(invoiceListQuerySchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('invoices')
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

      const { data: invoices, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'INVOICES_FETCH_FAILED', listError.message);
      }

      const rows = invoices ?? [];
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
      request.log.error({ err }, 'Failed to list invoices');
      throw new AppError(500, 'INVOICES_FETCH_FAILED', 'Failed to list invoices');
    }
  });

  // GET /:id — Get single invoice
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: invoice, error: fetchError } = await supabaseAdmin
          .from('invoices')
          .select('*, customer:customers(id, name, email, phone, address)')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !invoice) {
          throw new NotFoundError('Invoice not found');
        }

        return reply.send(success(invoice));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch invoice');
        throw new AppError(500, 'INVOICE_FETCH_FAILED', 'Failed to fetch invoice');
      }
    },
  );

  // POST / — Create invoice (auto-calculate totals)
  app.post('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(createInvoiceSchema, request.body);

    try {
      const totals = calculateTotals(body.line_items, body.tax_rate);

      const { data: invoice, error: createError } = await supabaseAdmin
        .from('invoices')
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
        throw new AppError(500, 'INVOICE_CREATE_FAILED', createError.message);
      }

      // Emit invoice created event
      eventBus.emitEvent({
        type: EVENTS.INVOICE_CREATED,
        orgId: request.orgId!,
        data: {
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          total: totals.total,
        },
        source: 'api',
        timestamp: new Date().toISOString(),
      });

      return reply.status(201).send(success(invoice));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create invoice');
      throw new AppError(500, 'INVOICE_CREATE_FAILED', 'Failed to create invoice');
    }
  });

  // PATCH /:id — Update invoice
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);
      const body = validate(updateInvoiceSchema, request.body);

      try {
        // If line_items or tax_rate changed, recalculate totals
        let updatePayload: Record<string, unknown> = { ...body };

        if (body.line_items || body.tax_rate !== undefined) {
          // Fetch current invoice to get any missing values
          const { data: current } = await supabaseAdmin
            .from('invoices')
            .select('line_items, tax_rate')
            .eq('id', id)
            .eq('org_id', request.orgId!)
            .single();

          const lineItems = body.line_items ?? current?.line_items ?? [];
          const taxRate = body.tax_rate ?? current?.tax_rate ?? 0;
          const totals = calculateTotals(lineItems, taxRate);
          updatePayload = { ...updatePayload, ...totals };
        }

        const { data: invoice, error: updateError } = await supabaseAdmin
          .from('invoices')
          .update(updatePayload)
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !invoice) {
          throw new NotFoundError('Invoice not found');
        }

        return reply.send(success(invoice));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update invoice');
        throw new AppError(500, 'INVOICE_UPDATE_FAILED', 'Failed to update invoice');
      }
    },
  );

  // POST /:id/send — Mark invoice as sent
  app.post<{ Params: { id: string } }>(
    '/:id/send',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const now = new Date().toISOString();

        const { data: invoice, error: updateError } = await supabaseAdmin
          .from('invoices')
          .update({
            status: 'sent',
            sent_at: now,
          })
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .select()
          .single();

        if (updateError || !invoice) {
          throw new NotFoundError('Invoice not found');
        }

        // Emit invoice.sent event
        eventBus.emitEvent({
          type: EVENTS.INVOICE_SENT,
          orgId: request.orgId!,
          data: {
            invoice_id: invoice.id,
            customer_id: invoice.customer_id,
            total: invoice.total,
            sent_at: now,
          },
          source: 'api',
          timestamp: now,
        });

        return reply.send(success(invoice));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to send invoice');
        throw new AppError(500, 'INVOICE_SEND_FAILED', 'Failed to mark invoice as sent');
      }
    },
  );

  // GET /:id/pdf — Redirect to PDF URL (or 404)
  app.get<{ Params: { id: string } }>(
    '/:id/pdf',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        const { data: invoice, error: fetchError } = await supabaseAdmin
          .from('invoices')
          .select('pdf_url')
          .eq('id', id)
          .eq('org_id', request.orgId!)
          .single();

        if (fetchError || !invoice) {
          throw new NotFoundError('Invoice not found');
        }

        if (!invoice.pdf_url) {
          throw new NotFoundError('PDF not generated yet');
        }

        return reply.redirect(invoice.pdf_url, 302);
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to get invoice PDF');
        throw new AppError(500, 'INVOICE_PDF_FAILED', 'Failed to retrieve invoice PDF');
      }
    },
  );
}
