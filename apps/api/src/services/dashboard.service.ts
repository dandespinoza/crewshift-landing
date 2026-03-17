/**
 * Dashboard Service
 *
 * Aggregates data for the dashboard views:
 * - Summary metrics (revenue, jobs, outstanding invoices)
 * - Agent activity feed
 * - AI-generated insights
 * - Financial overview
 * - Usage tracking
 *
 * See docs/17-cost-tracking.md for usage metering details.
 *
 * TODO Sprint 4: Real aggregation queries and AI-generated insights
 */

import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface DashboardSummary {
  revenue_this_month: number;
  jobs_completed_this_month: number;
  outstanding_invoices: number;
  outstanding_amount: number;
  active_agents: number;
  agent_executions_today: number;
}

export interface AgentActivity {
  id: string;
  agent_type: string;
  trigger_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface FinancialSummary {
  revenue_this_month: number;
  revenue_last_month: number;
  expenses_this_month: number;
  margin_percent: number;
  avg_invoice_amount: number;
  collection_rate: number;
}

export interface UsageSummary {
  tier: string;
  agent_executions: { used: number; limit: number };
  copilot_messages: { used: number; limit: number };
  integration_syncs: { used: number; limit: number };
  storage_mb: { used: number; limit: number };
  ai_cost_cents: number;
}

// ============================================
// Tier Limits
// ============================================

const TIER_LIMITS = {
  starter: {
    agent_executions: 500,
    copilot_messages: 200,
    integration_syncs: 1000,
    storage_mb: 1024,
  },
  pro: {
    agent_executions: 5000,
    copilot_messages: 2000,
    integration_syncs: 10000,
    storage_mb: 10240,
  },
  business: {
    agent_executions: 20000,
    copilot_messages: 10000,
    integration_syncs: 50000,
    storage_mb: 51200,
  },
  enterprise: {
    agent_executions: Infinity,
    copilot_messages: Infinity,
    integration_syncs: Infinity,
    storage_mb: Infinity,
  },
} as const;

// ============================================
// Service Functions
// ============================================

/**
 * Get dashboard summary metrics.
 */
export async function getSummary(orgId: string): Promise<DashboardSummary> {
  // TODO: Real aggregation queries
  // For now, return counts from the database

  const [invoiceResult, jobResult, _agentResult, configResult] = await Promise.all([
    supabaseAdmin
      .from('invoices')
      .select('id, total, status', { count: 'exact' })
      .eq('org_id', orgId)
      .in('status', ['sent', 'overdue']),
    supabaseAdmin
      .from('jobs')
      .select('id', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('status', 'completed'),
    supabaseAdmin
      .from('agent_executions')
      .select('id', { count: 'exact' })
      .eq('org_id', orgId),
    supabaseAdmin
      .from('agent_configs')
      .select('id', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('enabled', true),
  ]);

  const outstandingAmount = (invoiceResult.data ?? [])
    .reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

  return {
    revenue_this_month: 0, // TODO: Sum of paid invoices this month
    jobs_completed_this_month: jobResult.count ?? 0,
    outstanding_invoices: invoiceResult.count ?? 0,
    outstanding_amount: outstandingAmount,
    active_agents: configResult.count ?? 0,
    agent_executions_today: 0, // TODO: Count today's executions
  };
}

/**
 * Get recent agent activity feed.
 */
export async function getAgentActivity(orgId: string, limit = 20): Promise<AgentActivity[]> {
  const { data, error } = await supabaseAdmin
    .from('agent_executions')
    .select('id, agent_type, trigger_type, status, created_at, completed_at, duration_ms')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ error }, 'Failed to fetch agent activity');
    return [];
  }

  return (data ?? []) as AgentActivity[];
}

/**
 * Get AI-generated insights.
 * TODO Sprint 4: Run Insights Agent to generate real insights
 */
export async function getInsights(_orgId: string) {
  return {
    insights: [],
    generated_at: new Date().toISOString(),
    message: 'Insights will be available after connecting integrations and completing jobs.',
  };
}

/**
 * Get financial summary.
 * TODO Sprint 4: Real financial aggregation
 */
export async function getFinancials(_orgId: string): Promise<FinancialSummary> {
  return {
    revenue_this_month: 0,
    revenue_last_month: 0,
    expenses_this_month: 0,
    margin_percent: 0,
    avg_invoice_amount: 0,
    collection_rate: 0,
  };
}

/**
 * Get usage summary for the current billing period.
 */
export async function getUsage(orgId: string): Promise<UsageSummary> {
  // Get org tier
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('tier')
    .eq('id', orgId)
    .single();

  const tier = (org?.tier ?? 'starter') as keyof typeof TIER_LIMITS;
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.starter;

  // Count this month's executions
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count: execCount } = await supabaseAdmin
    .from('agent_executions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .gte('created_at', startOfMonth.toISOString());

  const { count: messageCount } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('role', 'user')
    .gte('created_at', startOfMonth.toISOString());

  return {
    tier,
    agent_executions: { used: execCount ?? 0, limit: limits.agent_executions },
    copilot_messages: { used: messageCount ?? 0, limit: limits.copilot_messages },
    integration_syncs: { used: 0, limit: limits.integration_syncs },
    storage_mb: { used: 0, limit: limits.storage_mb },
    ai_cost_cents: 0,
  };
}
