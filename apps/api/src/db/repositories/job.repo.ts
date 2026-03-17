/**
 * Job Repository — data-access layer for the `jobs` table.
 *
 * Every query is scoped by `org_id` to enforce multi-tenant isolation.
 */

import { eq, and, or, ilike, desc, asc, gt, lt, gte, lte } from 'drizzle-orm';

import { db } from '../index.js';
import {
  jobs,
  type Job,
  type NewJob,
} from '../schema.js';
import { encodeCursor, decodeCursor } from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListJobsParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  status?: string;
  customerId?: string;
  assignedTechId?: string;
  dateFrom?: string; // ISO date string — filters scheduled_start >=
  dateTo?: string;   // ISO date string — filters scheduled_start <=
}

export interface PaginationMeta {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedJobs {
  data: Job[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSortColumn(sort: string) {
  const columns: Record<string, any> = {
    created_at: jobs.createdAt,
    updated_at: jobs.updatedAt,
    scheduled_start: jobs.scheduledStart,
    scheduled_end: jobs.scheduledEnd,
    status: jobs.status,
  };
  return columns[sort] ?? jobs.createdAt;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * List jobs with cursor-based pagination and rich filtering.
 */
export async function listJobs(
  orgId: string,
  params: ListJobsParams = {},
): Promise<PaginatedJobs> {
  const {
    limit = 25,
    cursor,
    sort = 'created_at',
    order = 'desc',
    search,
    status,
    customerId,
    assignedTechId,
    dateFrom,
    dateTo,
  } = params;

  const sortColumn = getSortColumn(sort);
  const orderFn = order === 'asc' ? asc : desc;

  // -- WHERE conditions ------------------------------------------------------
  const conditions = [eq(jobs.orgId, orgId)];

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
    conditions.push(eq(jobs.status, status));
  }

  if (customerId) {
    conditions.push(eq(jobs.customerId, customerId));
  }

  if (assignedTechId) {
    conditions.push(eq(jobs.assignedTechId, assignedTechId));
  }

  if (dateFrom) {
    conditions.push(gte(jobs.scheduledStart, new Date(dateFrom)));
  }

  if (dateTo) {
    conditions.push(lte(jobs.scheduledStart, new Date(dateTo)));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(jobs.description, pattern),
        ilike(jobs.type, pattern),
        ilike(jobs.notes, pattern),
      )!,
    );
  }

  // -- Execute ---------------------------------------------------------------
  const rows = await db
    .select()
    .from(jobs)
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
 * Get a single job by ID, scoped to org.
 */
export async function getJob(
  orgId: string,
  jobId: string,
): Promise<Job | null> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
    .limit(1);

  return row ?? null;
}

/**
 * Create a new job.
 */
export async function createJob(data: NewJob): Promise<Job> {
  const [row] = await db.insert(jobs).values(data).returning();
  return row;
}

/**
 * Partially update an existing job. Bumps `updated_at`.
 */
export async function updateJob(
  orgId: string,
  jobId: string,
  data: Partial<NewJob>,
): Promise<Job | null> {
  const [row] = await db
    .update(jobs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
    .returning();

  return row ?? null;
}

/**
 * Mark a job as completed. Sets `status` to `'completed'` and records the
 * `actual_end` timestamp.
 */
export async function markJobComplete(
  orgId: string,
  jobId: string,
): Promise<Job | null> {
  const [row] = await db
    .update(jobs)
    .set({
      status: 'completed',
      actualEnd: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
    .returning();

  return row ?? null;
}
