/**
 * Invoice Repository — data-access layer for the `invoices` table.
 *
 * Every query is scoped by `org_id` to enforce multi-tenant isolation.
 */

import {
  eq,
  and,
  or,
  ilike,
  desc,
  asc,
  gt,
  lt,
  gte,
  lte,
  notInArray,
  sql,
} from 'drizzle-orm';

import { db } from '../index.js';
import {
  invoices,
  type Invoice,
  type NewInvoice,
} from '../schema.js';
import { encodeCursor, decodeCursor } from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListInvoicesParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  status?: string;
  customerId?: string;
  dateFrom?: string; // ISO date — filters created_at >=
  dateTo?: string;   // ISO date — filters created_at <=
}

export interface PaginationMeta {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedInvoices {
  data: Invoice[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSortColumn(sort: string) {
  const columns: Record<string, any> = {
    created_at: invoices.createdAt,
    updated_at: invoices.updatedAt,
    due_date: invoices.dueDate,
    total: invoices.total,
  };
  return columns[sort] ?? invoices.createdAt;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * List invoices with cursor-based pagination and filters.
 */
export async function listInvoices(
  orgId: string,
  params: ListInvoicesParams = {},
): Promise<PaginatedInvoices> {
  const {
    limit = 25,
    cursor,
    sort = 'created_at',
    order = 'desc',
    search,
    status,
    customerId,
    dateFrom,
    dateTo,
  } = params;

  const sortColumn = getSortColumn(sort);
  const orderFn = order === 'asc' ? asc : desc;

  // -- WHERE conditions ------------------------------------------------------
  const conditions = [eq(invoices.orgId, orgId)];

  if (cursor) {
    const decoded = decodeCursor(cursor);
    const cursorValue = decoded[sort] as string | undefined;
    if (cursorValue) {
      conditions.push(
        order === 'desc'
          ? lt(sortColumn, new Date(cursorValue))
          : gt(sortColumn, new Date(cursorValue)),
      );
    }
  }

  if (status) {
    conditions.push(eq(invoices.status, status));
  }

  if (customerId) {
    conditions.push(eq(invoices.customerId, customerId));
  }

  if (dateFrom) {
    conditions.push(gte(invoices.createdAt, new Date(dateFrom)));
  }

  if (dateTo) {
    conditions.push(lte(invoices.createdAt, new Date(dateTo)));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(invoices.invoiceNumber, pattern),
        ilike(invoices.notes, pattern),
      )!,
    );
  }

  // -- Execute ---------------------------------------------------------------
  const rows = await db
    .select()
    .from(invoices)
    .where(and(...conditions))
    .orderBy(orderFn(sortColumn))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastRow = data[data.length - 1];
    nextCursor = encodeCursor({
      [sort]: (lastRow as Record<string, unknown>)[snakeToCamel(sort)],
    });
  }

  return {
    data,
    meta: { limit, has_more: hasMore, next_cursor: nextCursor },
  };
}

/**
 * Get a single invoice by ID, scoped to org.
 */
export async function getInvoice(
  orgId: string,
  invoiceId: string,
): Promise<Invoice | null> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .limit(1);

  return row ?? null;
}

/**
 * Create a new invoice.
 */
export async function createInvoice(data: NewInvoice): Promise<Invoice> {
  const [row] = await db.insert(invoices).values(data).returning();
  return row;
}

/**
 * Partially update an existing invoice. Bumps `updated_at`.
 */
export async function updateInvoice(
  orgId: string,
  invoiceId: string,
  data: Partial<NewInvoice>,
): Promise<Invoice | null> {
  const [row] = await db
    .update(invoices)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .returning();

  return row ?? null;
}

/**
 * Retrieve all overdue invoices for an org.
 *
 * An invoice is "overdue" when:
 *   - `due_date` is in the past
 *   - `status` is NOT 'paid' or 'void'
 */
export async function getOverdueInvoices(orgId: string): Promise<Invoice[]> {
  return db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.orgId, orgId),
        lt(invoices.dueDate, sql`CURRENT_DATE`),
        notInArray(invoices.status, ['paid', 'void']),
      ),
    )
    .orderBy(asc(invoices.dueDate));
}
