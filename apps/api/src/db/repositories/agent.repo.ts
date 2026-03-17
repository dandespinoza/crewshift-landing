/**
 * Agent Repository — data-access layer for `agent_configs` and
 * `agent_executions` tables.
 *
 * Every query is scoped by `org_id` to enforce multi-tenant isolation.
 */

import { eq, and, desc, asc, gt, lt } from 'drizzle-orm';

import { db } from '../index.js';
import {
  agentConfigs,
  agentExecutions,
  type AgentConfig,
  type NewAgentConfig,
  type AgentExecution,
  type NewAgentExecution,
} from '../schema.js';
import { encodeCursor, decodeCursor } from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListExecutionsParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  agentType?: string;
  status?: string;
}

export interface PaginationMeta {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedExecutions {
  data: AgentExecution[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExecutionSortColumn(sort: string) {
  const columns: Record<string, any> = {
    created_at: agentExecutions.createdAt,
    completed_at: agentExecutions.completedAt,
  };
  return columns[sort] ?? agentExecutions.createdAt;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT CONFIGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all agent configs for an org.
 */
export async function getAgentConfigs(orgId: string): Promise<AgentConfig[]> {
  return db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.orgId, orgId))
    .orderBy(agentConfigs.agentType);
}

/**
 * Get a single agent config by its agent type, scoped to org.
 * Uses the unique (org_id, agent_type) constraint for a precise lookup.
 */
export async function getAgentConfig(
  orgId: string,
  agentType: string,
): Promise<AgentConfig | null> {
  const [row] = await db
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.orgId, orgId),
        eq(agentConfigs.agentType, agentType),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Update an agent config (e.g. toggle enabled, change autonomy rules).
 * Bumps `updated_at`.
 */
export async function updateAgentConfig(
  orgId: string,
  agentType: string,
  data: Partial<NewAgentConfig>,
): Promise<AgentConfig | null> {
  const [row] = await db
    .update(agentConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(agentConfigs.orgId, orgId),
        eq(agentConfigs.agentType, agentType),
      ),
    )
    .returning();

  return row ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT EXECUTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List executions with cursor-based pagination and optional filters.
 */
export async function listExecutions(
  orgId: string,
  params: ListExecutionsParams = {},
): Promise<PaginatedExecutions> {
  const {
    limit = 25,
    cursor,
    sort = 'created_at',
    order = 'desc',
    agentType,
    status,
  } = params;

  const sortColumn = getExecutionSortColumn(sort);
  const orderFn = order === 'asc' ? asc : desc;

  // -- WHERE conditions ------------------------------------------------------
  const conditions = [eq(agentExecutions.orgId, orgId)];

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

  if (agentType) {
    conditions.push(eq(agentExecutions.agentType, agentType));
  }

  if (status) {
    conditions.push(eq(agentExecutions.status, status));
  }

  // -- Execute ---------------------------------------------------------------
  const rows = await db
    .select()
    .from(agentExecutions)
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
 * Get a single execution by ID, scoped to org.
 */
export async function getExecution(
  orgId: string,
  executionId: string,
): Promise<AgentExecution | null> {
  const [row] = await db
    .select()
    .from(agentExecutions)
    .where(
      and(
        eq(agentExecutions.orgId, orgId),
        eq(agentExecutions.id, executionId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Create a new agent execution record.
 */
export async function createExecution(
  data: NewAgentExecution,
): Promise<AgentExecution> {
  const [row] = await db
    .insert(agentExecutions)
    .values(data)
    .returning();
  return row;
}

/**
 * Update the status (and optionally output) of an execution.
 *
 * When status transitions to a terminal state ('completed', 'failed'),
 * `completed_at` is automatically set.
 */
export async function updateExecutionStatus(
  orgId: string,
  executionId: string,
  data: Partial<NewAgentExecution>,
): Promise<AgentExecution | null> {
  const updates: Record<string, any> = {
    ...data,
  };

  // Auto-set completedAt for terminal statuses.
  if (data.status === 'completed' || data.status === 'failed') {
    updates.completedAt = new Date();
  }

  const [row] = await db
    .update(agentExecutions)
    .set(updates)
    .where(
      and(
        eq(agentExecutions.orgId, orgId),
        eq(agentExecutions.id, executionId),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * Get all executions awaiting human review for an org.
 * These are executions with `status = 'awaiting_review'`, ordered newest-first.
 */
export async function getReviewQueue(
  orgId: string,
): Promise<AgentExecution[]> {
  return db
    .select()
    .from(agentExecutions)
    .where(
      and(
        eq(agentExecutions.orgId, orgId),
        eq(agentExecutions.status, 'awaiting_review'),
      ),
    )
    .orderBy(desc(agentExecutions.createdAt));
}
