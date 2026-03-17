/**
 * Customer Repository — data-access layer for the `customers` table.
 *
 * Every query is scoped by `org_id` to enforce multi-tenant isolation.
 * This is the REFERENCE repository; all others follow the same pattern.
 */

import { eq, and, or, ilike, desc, asc, gt, lt, sql } from 'drizzle-orm';

import { db } from '../index.js';
import {
  customers,
  type Customer,
  type NewCustomer,
} from '../schema.js';
import {
  encodeCursor,
  decodeCursor,
} from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListCustomersParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  tags?: string[];
}

export interface PaginationMeta {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedCustomers {
  data: Customer[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a column name string to the corresponding Drizzle column reference. */
function getSortColumn(sort: string) {
  const columns: Record<string, any> = {
    created_at: customers.createdAt,
    updated_at: customers.updatedAt,
    name: customers.name,
  };
  return columns[sort] ?? customers.createdAt;
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * List customers with cursor-based pagination, optional search, and tag
 * filtering. Results are always scoped to the given org.
 */
export async function listCustomers(
  orgId: string,
  params: ListCustomersParams = {},
): Promise<PaginatedCustomers> {
  const {
    limit = 25,
    cursor,
    sort = 'created_at',
    order = 'desc',
    search,
    tags,
  } = params;

  const sortColumn = getSortColumn(sort);
  const orderFn = order === 'asc' ? asc : desc;

  // -- Build WHERE conditions ------------------------------------------------
  const conditions = [eq(customers.orgId, orgId)];

  // Cursor-based pagination: fetch rows past the last-seen sort value.
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

  // Full-text-ish search across name, email, phone.
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(customers.name, pattern),
        ilike(customers.email, pattern),
        ilike(customers.phone, pattern),
      )!,
    );
  }

  // Tag filtering — customer must have ALL requested tags.
  if (tags && tags.length > 0) {
    conditions.push(
      sql`${customers.tags} @> ${sql`ARRAY[${sql.join(
        tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`}`,
    );
  }

  // -- Execute query ---------------------------------------------------------
  const rows = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(orderFn(sortColumn))
    .limit(limit + 1); // fetch one extra to detect has_more

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastRow = data[data.length - 1];
    nextCursor = encodeCursor({
      [sort]: (lastRow as Record<string, unknown>)[
        // Convert snake_case column name to camelCase property name
        sort.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      ],
    });
  }

  return {
    data,
    meta: {
      limit,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

/**
 * Get a single customer by ID, scoped to the given org.
 * Returns `null` if no matching row exists.
 */
export async function getCustomer(
  orgId: string,
  customerId: string,
): Promise<Customer | null> {
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
    .limit(1);

  return row ?? null;
}

/**
 * Create a new customer. The caller must supply `org_id` inside `data`.
 */
export async function createCustomer(data: NewCustomer): Promise<Customer> {
  const [row] = await db.insert(customers).values(data).returning();
  return row;
}

/**
 * Partially update an existing customer.
 * Automatically bumps `updated_at`. Returns `null` if the row was not found.
 */
export async function updateCustomer(
  orgId: string,
  customerId: string,
  data: Partial<NewCustomer>,
): Promise<Customer | null> {
  const [row] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
    .returning();

  return row ?? null;
}

/**
 * Hard-delete a customer (soft-delete not implemented yet).
 * Returns `true` if a row was actually deleted.
 */
export async function deleteCustomer(
  orgId: string,
  customerId: string,
): Promise<boolean> {
  const result = await db
    .delete(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
    .returning({ id: customers.id });

  return result.length > 0;
}

/**
 * Quick search across name, email, and phone. Returns up to `limit` matches
 * (default 10) for autocomplete / typeahead use-cases.
 */
export async function searchCustomers(
  orgId: string,
  query: string,
  limit = 10,
): Promise<Customer[]> {
  const pattern = `%${query}%`;

  return db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.orgId, orgId),
        or(
          ilike(customers.name, pattern),
          ilike(customers.email, pattern),
          ilike(customers.phone, pattern),
        ),
      ),
    )
    .orderBy(asc(customers.name))
    .limit(limit);
}
