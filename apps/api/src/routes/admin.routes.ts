/**
 * Super-Admin Routes — `/api/admin`
 *
 * These endpoints are restricted to CrewShift super-admins and provide
 * cross-organisation management capabilities: creating client orgs,
 * connecting integrations on their behalf, managing teams, and
 * viewing system-wide statistics.
 *
 * All routes require JWT auth + `isSuperAdmin === true`.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, desc, sql, ilike, and } from 'drizzle-orm';

import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireSuperAdmin } from '../middleware/super-admin.middleware.js';
import { orgScopeMiddleware } from '../middleware/org-scope.middleware.js';
import { validate, paginationSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { db } from '../db/index.js';
import {
  organizations,
  profiles,
  integrations,
  agentConfigs,
  agentExecutions,
  syncLogs,
  type NewOrganization,
} from '../db/schema.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AGENT_TYPES } from '../agents/types.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const createOrgSchema = z.object({
  name: z.string().min(1).max(255),
  tradeType: z.string().min(1).max(100),
  size: z.string().optional(),
  tier: z.enum(['starter', 'pro', 'enterprise']).default('starter'),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tradeType: z.string().min(1).max(100).optional(),
  size: z.string().optional(),
  tier: z.enum(['starter', 'pro', 'enterprise']).optional(),
  onboardingStatus: z.enum(['not_started', 'in_progress', 'completed']).optional(),
  settings: z.record(z.unknown()).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(255).optional(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
});

const updateAgentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  autonomyRules: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

const adminPaginationSchema = paginationSchema.extend({
  search: z.string().optional(),
});

const allProviders = z.enum([
  'quickbooks', 'stripe', 'jobber', 'servicetitan', 'housecallpro',
  'plaid', 'twilio', 'google', 'fleetio', 'fishbowl',
]);

// ── Shared preHandlers ─────────────────────────────────────────────────────

const superAdminAuth = [authMiddleware, requireSuperAdmin];
const scopedAuth = [authMiddleware, requireSuperAdmin, orgScopeMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ────────────────────────────────────────────────────────────────────────
  // GET /stats — System-wide statistics
  // ────────────────────────────────────────────────────────────────────────

  app.get('/stats', { preHandler: superAdminAuth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [orgCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(organizations);

      const [profileCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(profiles)
        .where(eq(profiles.isSuperAdmin, false));

      const [integrationCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(integrations)
        .where(eq(integrations.status, 'connected'));

      const [executionCount] = await db
        .select({
          total: sql<number>`count(*)::int`,
          totalCostCents: sql<number>`coalesce(sum(ai_cost_cents), 0)::int`,
          totalTokens: sql<number>`coalesce(sum(ai_tokens_used), 0)::int`,
        })
        .from(agentExecutions);

      return reply.send(success({
        organizations: orgCount.count,
        users: profileCount.count,
        activeIntegrations: integrationCount.count,
        agentExecutions: {
          total: executionCount.total,
          totalCostCents: executionCount.totalCostCents,
          totalTokens: executionCount.totalTokens,
        },
      }));
    } catch (err) {
      if (err instanceof AppError) throw err;
      _request.log.error({ err }, 'Failed to fetch admin stats');
      throw new AppError(500, 'STATS_FETCH_FAILED', 'Failed to fetch system statistics');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /orgs — List all organisations (paginated, searchable)
  // ────────────────────────────────────────────────────────────────────────

  app.get('/orgs', { preHandler: superAdminAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = validate(adminPaginationSchema, request.query);
      const { limit, cursor, search } = query;

      const conditions = [];
      if (search) {
        conditions.push(ilike(organizations.name, `%${search}%`));
      }
      if (cursor) {
        conditions.push(sql`${organizations.createdAt} < ${cursor}`);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(organizations)
        .where(whereClause)
        .orderBy(desc(organizations.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? data[data.length - 1].createdAt.toISOString() : undefined;

      return reply.send(success(data, {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
      }));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to list orgs');
      throw new AppError(500, 'ORGS_LIST_FAILED', 'Failed to list organisations');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /orgs/:orgId — Full org detail
  // ────────────────────────────────────────────────────────────────────────

  app.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, request.orgId!))
          .limit(1);

        if (!org) throw new NotFoundError('Organisation not found');

        // Fetch related data in parallel
        const [orgIntegrations, teamMembers, orgAgentConfigs] = await Promise.all([
          db.select().from(integrations).where(eq(integrations.orgId, request.orgId!)),
          db.select({
            id: profiles.id,
            fullName: profiles.fullName,
            role: profiles.role,
            email: sql<string>`''`, // Email from auth.users — not in profiles
            createdAt: profiles.createdAt,
          }).from(profiles).where(eq(profiles.orgId, request.orgId!)),
          db.select().from(agentConfigs).where(eq(agentConfigs.orgId, request.orgId!)),
        ]);

        return reply.send(success({
          ...org,
          integrations: orgIntegrations,
          team: teamMembers,
          agentConfigs: orgAgentConfigs,
        }));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch org detail');
        throw new AppError(500, 'ORG_FETCH_FAILED', 'Failed to fetch organisation details');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // POST /orgs — Create a client organisation
  // ────────────────────────────────────────────────────────────────────────

  app.post('/orgs', { preHandler: superAdminAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = validate(createOrgSchema, request.body);

      const [org] = await db
        .insert(organizations)
        .values({
          name: body.name,
          tradeType: body.tradeType,
          size: body.size,
          tier: body.tier,
          onboardingStatus: 'not_started',
        } as NewOrganization)
        .returning();

      // Seed default agent configs for the new org
      const agentConfigValues = AGENT_TYPES.map((agentType) => ({
        orgId: org.id,
        agentType,
        enabled: false, // Start disabled — super-admin enables after setup
        autonomyRules: {},
        settings: {},
      }));

      if (agentConfigValues.length > 0) {
        await db.insert(agentConfigs).values(agentConfigValues);
      }

      request.log.info({ orgId: org.id, name: org.name }, 'Client org created by super-admin');
      return reply.status(201).send(success(org));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to create org');
      throw new AppError(500, 'ORG_CREATE_FAILED', 'Failed to create organisation');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // PATCH /orgs/:orgId — Update org settings / tier / status
  // ────────────────────────────────────────────────────────────────────────

  app.patch<{ Params: { orgId: string } }>(
    '/orgs/:orgId',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const body = validate(updateOrgSchema, request.body);

        const [updated] = await db
          .update(organizations)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(organizations.id, request.orgId!))
          .returning();

        if (!updated) throw new NotFoundError('Organisation not found');

        return reply.send(success(updated));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update org');
        throw new AppError(500, 'ORG_UPDATE_FAILED', 'Failed to update organisation');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /orgs/:orgId/integrations — List integrations for an org
  // ────────────────────────────────────────────────────────────────────────

  app.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/integrations',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const rows = await db
          .select()
          .from(integrations)
          .where(eq(integrations.orgId, request.orgId!))
          .orderBy(integrations.provider);

        return reply.send(success(rows));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to list integrations');
        throw new AppError(500, 'INTEGRATIONS_LIST_FAILED', 'Failed to list integrations');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /orgs/:orgId/integrations/:provider/connect — Start OAuth for client
  // ────────────────────────────────────────────────────────────────────────

  app.get<{ Params: { orgId: string; provider: string } }>(
    '/orgs/:orgId/integrations/:provider/connect',
    { preHandler: scopedAuth },
    async (request, reply) => {
      const provider = validate(allProviders, request.params.provider);

      try {
        // Delegate to the standard integration connect endpoint
        // by redirecting to /api/integrations/:provider/connect
        // with the orgId encoded in the state parameter
        const state = crypto.randomUUID();

        // Store OAuth state with the target org (not the super-admin's org)
        await supabaseAdmin
          .from('integration_oauth_states')
          .insert({
            state,
            org_id: request.orgId,
            provider,
            initiated_by: request.userId,
            redirect_url: `${env.ADMIN_URL ?? env.API_URL}/admin/orgs/${request.orgId}/integrations`,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          });

        // Build OAuth URL based on provider
        const redirectUri = `${env.API_URL}/api/integrations/${provider}/callback`;
        const oauthUrl = buildOAuthUrl(provider, state, redirectUri);

        if (!oauthUrl) {
          throw new AppError(
            400,
            'INTEGRATION_NOT_CONFIGURED',
            `${provider} integration is not configured or does not support OAuth`,
          );
        }

        return reply.redirect(oauthUrl, 302);
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err, provider }, 'Failed to start OAuth for client');
        throw new AppError(500, 'OAUTH_START_FAILED', 'Failed to start OAuth flow');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // POST /orgs/:orgId/integrations/:provider/sync — Trigger manual sync
  // ────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { orgId: string; provider: string } }>(
    '/orgs/:orgId/integrations/:provider/sync',
    { preHandler: scopedAuth },
    async (request, reply) => {
      const provider = validate(allProviders, request.params.provider);

      try {
        // Find the integration
        const [integration] = await db
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.orgId, request.orgId!),
              eq(integrations.provider, provider),
            ),
          )
          .limit(1);

        if (!integration) {
          throw new NotFoundError(`${provider} integration not found for this org`);
        }

        if (integration.status !== 'connected') {
          throw new AppError(400, 'INTEGRATION_NOT_CONNECTED', `${provider} is not connected`);
        }

        // Create a sync log entry
        const [syncLog] = await db
          .insert(syncLogs)
          .values({
            orgId: request.orgId!,
            integrationId: integration.id,
            provider,
            syncType: 'full',
            status: 'running',
            direction: 'inbound',
          })
          .returning();

        // TODO: Enqueue actual sync job via BullMQ
        // await syncQueue.add('sync', { syncLogId: syncLog.id, orgId: request.orgId, provider });

        request.log.info({ orgId: request.orgId, provider, syncLogId: syncLog.id }, 'Sync triggered by super-admin');
        return reply.send(success({ message: `Sync started for ${provider}`, syncLogId: syncLog.id }));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err, provider }, 'Failed to trigger sync');
        throw new AppError(500, 'SYNC_TRIGGER_FAILED', 'Failed to trigger sync');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // DELETE /orgs/:orgId/integrations/:provider — Disconnect integration
  // ────────────────────────────────────────────────────────────────────────

  app.delete<{ Params: { orgId: string; provider: string } }>(
    '/orgs/:orgId/integrations/:provider',
    { preHandler: scopedAuth },
    async (request, reply) => {
      const provider = validate(allProviders, request.params.provider);

      try {
        const [updated] = await db
          .update(integrations)
          .set({
            status: 'disconnected',
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
          })
          .where(
            and(
              eq(integrations.orgId, request.orgId!),
              eq(integrations.provider, provider),
            ),
          )
          .returning();

        if (!updated) {
          throw new NotFoundError(`${provider} integration not found for this org`);
        }

        request.log.info({ orgId: request.orgId, provider }, 'Integration disconnected by super-admin');
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err, provider }, 'Failed to disconnect integration');
        throw new AppError(500, 'INTEGRATION_DISCONNECT_FAILED', 'Failed to disconnect integration');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /orgs/:orgId/team — List team members
  // ────────────────────────────────────────────────────────────────────────

  app.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/team',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const members = await db
          .select()
          .from(profiles)
          .where(eq(profiles.orgId, request.orgId!))
          .orderBy(profiles.fullName);

        return reply.send(success(members));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to list team members');
        throw new AppError(500, 'TEAM_LIST_FAILED', 'Failed to list team members');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // POST /orgs/:orgId/team/invite — Invite user to org
  // ────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/team/invite',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const body = validate(inviteSchema, request.body);

        // Create the user in Supabase Auth with the org_id in app_metadata
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: body.email,
          email_confirm: true,
          app_metadata: {
            org_id: request.orgId,
            role: body.role,
          },
          user_metadata: {
            full_name: body.fullName,
          },
        });

        if (authError) {
          if (authError.message?.includes('already registered')) {
            throw new AppError(409, 'USER_ALREADY_EXISTS', 'A user with this email already exists');
          }
          throw new AppError(500, 'USER_CREATE_FAILED', authError.message);
        }

        // Create the profile record
        const [profile] = await db
          .insert(profiles)
          .values({
            id: authUser.user.id,
            orgId: request.orgId!,
            fullName: body.fullName ?? null,
            role: body.role,
          })
          .returning();

        // TODO: Send invite email via Resend

        request.log.info({ orgId: request.orgId, email: body.email }, 'User invited by super-admin');
        return reply.status(201).send(success(profile));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to invite user');
        throw new AppError(500, 'INVITE_FAILED', 'Failed to invite user');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /orgs/:orgId/agent-configs — View agent configurations
  // ────────────────────────────────────────────────────────────────────────

  app.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/agent-configs',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const configs = await db
          .select()
          .from(agentConfigs)
          .where(eq(agentConfigs.orgId, request.orgId!))
          .orderBy(agentConfigs.agentType);

        return reply.send(success(configs));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to list agent configs');
        throw new AppError(500, 'AGENT_CONFIGS_LIST_FAILED', 'Failed to list agent configurations');
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // PATCH /orgs/:orgId/agent-configs/:agentType — Update agent config
  // ────────────────────────────────────────────────────────────────────────

  app.patch<{ Params: { orgId: string; agentType: string } }>(
    '/orgs/:orgId/agent-configs/:agentType',
    { preHandler: scopedAuth },
    async (request, reply) => {
      try {
        const body = validate(updateAgentConfigSchema, request.body);
        const { agentType } = request.params;

        // Validate agent type
        if (!AGENT_TYPES.includes(agentType as typeof AGENT_TYPES[number])) {
          throw new AppError(400, 'INVALID_AGENT_TYPE', `Invalid agent type: ${agentType}`);
        }

        const [updated] = await db
          .update(agentConfigs)
          .set({ ...body, updatedAt: new Date() })
          .where(
            and(
              eq(agentConfigs.orgId, request.orgId!),
              eq(agentConfigs.agentType, agentType),
            ),
          )
          .returning();

        if (!updated) {
          // Auto-create if not found (shouldn't happen since we seed on org creation)
          const [created] = await db
            .insert(agentConfigs)
            .values({
              orgId: request.orgId!,
              agentType,
              ...body,
            })
            .returning();

          return reply.send(success(created));
        }

        return reply.send(success(updated));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update agent config');
        throw new AppError(500, 'AGENT_CONFIG_UPDATE_FAILED', 'Failed to update agent configuration');
      }
    },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build an OAuth authorization URL for a given provider.
 * Returns `null` if the provider doesn't use OAuth or isn't configured.
 */
function buildOAuthUrl(provider: string, state: string, redirectUri: string): string | null {
  switch (provider) {
    case 'quickbooks': {
      if (!env.QUICKBOOKS_CLIENT_ID) return null;
      const params = new URLSearchParams({
        client_id: env.QUICKBOOKS_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'com.intuit.quickbooks.accounting',
        state,
      });
      return `https://appcenter.intuit.com/connect/oauth2?${params}`;
    }
    case 'google': {
      if (!env.GOOGLE_CLIENT_ID) return null;
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
        state,
        access_type: 'offline',
        prompt: 'consent',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    case 'jobber': {
      if (!env.JOBBER_CLIENT_ID) return null;
      const params = new URLSearchParams({
        client_id: env.JOBBER_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
      });
      return `https://api.getjobber.com/api/oauth/authorize?${params}`;
    }
    case 'servicetitan': {
      if (!env.SERVICETITAN_CLIENT_ID) return null;
      const params = new URLSearchParams({
        client_id: env.SERVICETITAN_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
      });
      return `https://auth.servicetitan.io/connect/authorize?${params}`;
    }
    case 'housecallpro': {
      if (!env.HOUSECALLPRO_CLIENT_ID) return null;
      const params = new URLSearchParams({
        client_id: env.HOUSECALLPRO_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
      });
      return `https://api.housecallpro.com/oauth/authorize?${params}`;
    }
    // Non-OAuth providers return null — they use API keys or Link tokens
    case 'stripe':
    case 'twilio':
    case 'plaid':
    case 'fleetio':
    case 'fishbowl':
      return null;
    default:
      return null;
  }
}
