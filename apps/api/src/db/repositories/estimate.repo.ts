/**
 * Estimate Repository — data-access layer for the `estimates` table.
 *
 * Every query is scoped by `org_id` to enforce multi-tenant isolation.
 */

import { eq, and, or, ilike, desc, asc, gt, lt } from 'drizzle-orm';

import { db } from '../index.js';
import {
  estimates,
  type Estimate,
  type NewEstimate,
} from '../schema.js';
import { encodeCursor, decodeCursor } from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListEstimatesParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  status?: string;
  customerId?: string;
}

export interface PaginationMeta {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedEstimates {
  data: Estimate[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSortColumn(sort: string) {
  const columns: Record<string, any> = {
    created_at: estimates.createdAt,
    updated_at: estimates.updatedAt,
    total: estimates.total,
    valid_until: estimates.validUntil,
  };
  return columns[sort] ?? estimates.createdAt;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * List estimates with cursor-based pagination, optional status and customer
 * filters.
 */
export async function listEstimates(
  orgId: string,
  params: ListEstimatesParams = {},
): Promise<PaginatedEstimates> {
  const {
    limit = 25,
    cursor,
    sort = 'created_at',
    order = 'desc',
    search,
    status,
    customerId,
  } = params;

  const sortColumn = getSortColumn(sort);
  const orderFn = order === 'asc' ? asc : desc;

  // -- WHERE conditions ------------------------------------------------------
  const conditions = [eq(estimates.orgId, orgId)];

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
    conditions.push(eq(estimates.status, status));
  }

  if (customerId) {
    conditions.push(eq(estimates.customerId, customerId));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(estimates.estimateNumber, pattern),
        ilike(estimates.scopeDescription, pattern),
        ilike(estimates.notes, pattern),
      )!,
    );
  }

  // -- Execute ---------------------------------------------------------------
  const rows = await db
    .select()
    .from(estimates)
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
 * Get a single estimate by ID, scoped to org.
 */
export async function getEstimate(
  orgId: string,
  estimateId: string,
): Promise<Estimate | null> {
  const [row] = await db
    .select()
    .from(estimates)
    .where(and(eq(estimates.orgId, orgId), eq(estimates.id, estimateId)))
    .limit(1);

  return row ?? null;
}

/**
 * Create a new estimate.
 */
export async function createEstimate(data: NewEstimate): Promise<Estimate> {
  const [row] = await db.insert(estimates).values(data).returning();
  return row;
}

/**
 * Partially update an existing estimate. Bumps `updated_at`.
 */
export async function updateEstimate(
  orgId: string,
  estimateId: string,
  data: Partial<NewEstimate>,
): Promise<Estimate | null> {
  const [row] = await db
    .update(estimates)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(estimates.orgId, orgId), eq(estimates.id, estimateId)))
    .returning();

  return row ?? null;
}
