import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { success } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /summary — Dashboard summary metrics (stub)
  app.get('/summary', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: Replace with real aggregate queries
      return reply.send(
        success({
          revenue: 0,
          jobs_completed: 0,
          outstanding_invoices: 0,
          active_agents: 0,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch dashboard summary');
      throw new AppError(500, 'DASHBOARD_SUMMARY_FAILED', 'Failed to fetch dashboard summary');
    }
  });

  // GET /agent-activity — Recent agent executions (last 20)
  app.get('/agent-activity', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: executions, error: listError } = await supabaseAdmin
        .from('agent_executions')
        .select('id, agent_type, status, created_at, duration_ms, trigger_type')
        .eq('org_id', request.orgId!)
        .order('created_at', { ascending: false })
        .limit(20);

      if (listError) {
        throw new AppError(500, 'AGENT_ACTIVITY_FAILED', listError.message);
      }

      return reply.send(success(executions ?? []));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch agent activity');
      throw new AppError(500, 'AGENT_ACTIVITY_FAILED', 'Failed to fetch agent activity');
    }
  });

  // GET /insights — AI-generated insights (stub)
  app.get('/insights', { preHandler: auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Replace with real AI insights from the insights agent
    return reply.send(
      success({
        insights: [],
      }),
    );
  });

  // GET /financials — Financial overview (stub)
  app.get('/financials', { preHandler: auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Replace with real financial aggregations
    return reply.send(
      success({
        revenue: 0,
        expenses: 0,
        margin: 0,
      }),
    );
  });

  // GET /usage — Platform usage metrics (stub)
  app.get('/usage', { preHandler: auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Replace with real usage tracking
    return reply.send(
      success({
        agent_executions: 0,
        copilot_messages: 0,
        tier: 'starter',
        limits: {},
      }),
    );
  });
}
