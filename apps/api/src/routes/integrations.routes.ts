import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { validate } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { eventBus, EVENTS } from '../agents/event-bus.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const providerSchema = z.enum([
  'quickbooks', 'stripe', 'jobber', 'servicetitan', 'housecallpro',
  'plaid', 'twilio', 'google', 'fleetio', 'fishbowl',
]);

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];
const adminOnly = [...auth, requireRole('owner', 'admin')];

// ── OAuth config stubs ─────────────────────────────────────────────────────

interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string | undefined;
  clientSecret: string | undefined;
}

function getOAuthConfig(provider: string): OAuthConfig {
  switch (provider) {
    case 'quickbooks':
      return {
        authUrl: 'https://appcenter.intuit.com/connect/oauth2',
        tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        scopes: ['com.intuit.quickbooks.accounting'],
        clientId: env.QUICKBOOKS_CLIENT_ID,
        clientSecret: env.QUICKBOOKS_CLIENT_SECRET,
      };
    case 'google':
      return {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/gmail.send',
        ],
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      };
    case 'stripe':
      return {
        authUrl: 'https://connect.stripe.com/oauth/authorize',
        tokenUrl: 'https://connect.stripe.com/oauth/token',
        scopes: ['read_write'],
        clientId: env.STRIPE_SECRET_KEY,
        clientSecret: env.STRIPE_SECRET_KEY,
      };
    case 'jobber':
      return {
        authUrl: 'https://api.getjobber.com/api/oauth/authorize',
        tokenUrl: 'https://api.getjobber.com/api/oauth/token',
        scopes: [],
        clientId: env.JOBBER_CLIENT_ID,
        clientSecret: env.JOBBER_CLIENT_SECRET,
      };
    case 'servicetitan':
      return {
        authUrl: 'https://auth.servicetitan.io/connect/authorize',
        tokenUrl: 'https://auth.servicetitan.io/connect/token',
        scopes: [],
        clientId: env.SERVICETITAN_CLIENT_ID,
        clientSecret: env.SERVICETITAN_CLIENT_SECRET,
      };
    case 'housecallpro':
      return {
        authUrl: 'https://api.housecallpro.com/oauth/authorize',
        tokenUrl: 'https://api.housecallpro.com/oauth/token',
        scopes: [],
        clientId: env.HOUSECALLPRO_CLIENT_ID,
        clientSecret: env.HOUSECALLPRO_CLIENT_SECRET,
      };
    // Non-OAuth providers — API key or Link token based
    case 'twilio':
    case 'plaid':
    case 'fleetio':
    case 'fishbowl':
      return {
        authUrl: '',
        tokenUrl: '',
        scopes: [],
        clientId: undefined,
        clientSecret: undefined,
      };
    default:
      throw new NotFoundError(`Unsupported provider: ${provider}`);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // GET / — List connected integrations
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: integrations, error: listError } = await supabaseAdmin
        .from('integrations')
        .select('id, provider, status, connected_at, last_sync_at, settings')
        .eq('org_id', request.orgId!)
        .order('connected_at', { ascending: false });

      if (listError) {
        throw new AppError(500, 'INTEGRATIONS_FETCH_FAILED', listError.message);
      }

      return reply.send(success(integrations ?? []));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to list integrations');
      throw new AppError(500, 'INTEGRATIONS_FETCH_FAILED', 'Failed to list integrations');
    }
  });

  // GET /:provider/connect — Start OAuth flow (owner, admin)
  app.get<{ Params: { provider: string } }>(
    '/:provider/connect',
    { preHandler: adminOnly },
    async (request, reply) => {
      const provider = validate(providerSchema, request.params.provider);

      try {
        const config = getOAuthConfig(provider);

        if (!config.clientId) {
          throw new AppError(
            400,
            'INTEGRATION_NOT_CONFIGURED',
            `${provider} integration is not configured. Missing client credentials.`,
          );
        }

        // Non-OAuth providers (API key / Link token) don't have an OAuth flow
        if (!config.authUrl) {
          throw new AppError(
            400,
            'NOT_OAUTH_PROVIDER',
            `${provider} uses API key or Link token authentication, not OAuth. Configure it via the admin panel.`,
          );
        }

        // Generate state parameter for CSRF protection
        const state = crypto.randomUUID();

        // Store state in DB for verification during callback
        await supabaseAdmin
          .from('integration_oauth_states')
          .insert({
            state,
            org_id: request.orgId,
            provider,
            initiated_by: request.userId,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min expiry
          });

        const redirectUri = `${env.API_URL}/api/integrations/${provider}/callback`;

        const params = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: config.scopes.join(' '),
          state,
        });

        const authUrl = `${config.authUrl}?${params.toString()}`;

        return reply.redirect(authUrl, 302);
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to start OAuth flow');
        throw new AppError(500, 'OAUTH_START_FAILED', 'Failed to start OAuth flow');
      }
    },
  );

  // GET /:provider/callback — OAuth callback. Exchange code for tokens.
  // NOTE: No auth middleware — user returns from external OAuth provider
  app.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>(
    '/:provider/callback',
    async (request, reply) => {
      const provider = validate(providerSchema, request.params.provider);
      const { code, state, error: oauthError } = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      // Handle OAuth error (user denied, etc.)
      if (oauthError) {
        request.log.warn({ provider, oauthError }, 'OAuth error from provider');
        const frontendUrl = env.FRONTEND_URL ?? env.API_URL.replace('/api', '');
        return reply.redirect(
          `${frontendUrl}/settings/integrations?error=${encodeURIComponent(oauthError)}`,
          302,
        );
      }

      if (!code || !state) {
        return reply.status(400).send({
          error: { code: 'OAUTH_MISSING_PARAMS', message: 'Missing code or state parameter' },
        });
      }

      try {
        // 1. Verify state parameter
        const { data: oauthState, error: stateError } = await supabaseAdmin
          .from('integration_oauth_states')
          .select('*')
          .eq('state', state)
          .eq('provider', provider)
          .single();

        if (stateError || !oauthState) {
          throw new AppError(400, 'OAUTH_INVALID_STATE', 'Invalid or expired OAuth state');
        }

        // Clean up used state
        await supabaseAdmin
          .from('integration_oauth_states')
          .delete()
          .eq('state', state);

        // 2. Exchange code for tokens
        const config = getOAuthConfig(provider);
        const redirectUri = `${env.API_URL}/api/integrations/${provider}/callback`;

        const tokenResponse = await fetch(config.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: config.clientId ?? '',
            client_secret: config.clientSecret ?? '',
          }),
        });

        if (!tokenResponse.ok) {
          const errorBody = await tokenResponse.text();
          request.log.error({ provider, errorBody }, 'Token exchange failed');
          throw new AppError(500, 'OAUTH_TOKEN_EXCHANGE_FAILED', 'Failed to exchange authorization code');
        }

        const tokens = (await tokenResponse.json()) as Record<string, unknown>;

        // 3. Store integration credentials (tokens should be encrypted in production)
        const { error: upsertError } = await supabaseAdmin
          .from('integrations')
          .upsert({
            org_id: oauthState.org_id,
            provider,
            status: 'connected',
            access_token: (tokens.access_token as string) ?? null,
            refresh_token: (tokens.refresh_token as string) ?? null,
            token_expires_at: tokens.expires_in
              ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
              : null,
            external_account_id: (tokens.realmId as string) ?? (tokens.company_id as string) ?? null,
            metadata: { raw_token_response: tokens },
            last_sync_at: null,
          }, { onConflict: 'org_id,provider' });

        if (upsertError) {
          throw new AppError(500, 'INTEGRATION_STORE_FAILED', upsertError.message);
        }

        // 4. Emit integration connected event
        eventBus.emitEvent({
          type: EVENTS.INTEGRATION_CONNECTED,
          orgId: oauthState.org_id,
          data: { provider },
          source: 'oauth',
          timestamp: new Date().toISOString(),
        });

        // 5. Redirect — use the stored redirect_url (super-admin flows go
        //    back to admin panel), otherwise default to frontend settings.
        const redirectTarget = oauthState.redirect_url
          ?? `${env.FRONTEND_URL ?? env.API_URL.replace('/api', '')}/settings/integrations?connected=${provider}`;

        return reply.redirect(
          redirectTarget.includes('?')
            ? `${redirectTarget}&connected=${provider}`
            : `${redirectTarget}?connected=${provider}`,
          302,
        );
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err, provider }, 'OAuth callback failed');
        const frontendUrl = env.FRONTEND_URL ?? env.API_URL.replace('/api', '');
        return reply.redirect(
          `${frontendUrl}/settings/integrations?error=callback_failed`,
          302,
        );
      }
    },
  );

  // POST /:provider/sync — Trigger manual sync (owner, admin)
  app.post<{ Params: { provider: string } }>(
    '/:provider/sync',
    { preHandler: adminOnly },
    async (request, reply) => {
      const provider = validate(providerSchema, request.params.provider);

      try {
        // Verify integration exists and is connected
        const { data: integration, error: fetchError } = await supabaseAdmin
          .from('integrations')
          .select('id, status')
          .eq('org_id', request.orgId!)
          .eq('provider', provider)
          .single();

        if (fetchError || !integration) {
          throw new NotFoundError(`${provider} integration not found`);
        }

        if (integration.status !== 'connected') {
          throw new AppError(400, 'INTEGRATION_NOT_CONNECTED', `${provider} is not connected`);
        }

        // Update last_sync_at
        await supabaseAdmin
          .from('integrations')
          .update({ last_sync_at: new Date().toISOString(), status: 'syncing' })
          .eq('id', integration.id);

        // TODO: Enqueue actual sync job via BullMQ

        return reply.send(success({ message: `Sync started for ${provider}` }));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err, provider }, 'Failed to trigger sync');
        throw new AppError(500, 'SYNC_TRIGGER_FAILED', 'Failed to trigger sync');
      }
    },
  );

  // DELETE /:provider — Disconnect integration (owner, admin)
  app.delete<{ Params: { provider: string } }>(
    '/:provider',
    { preHandler: adminOnly },
    async (request, reply) => {
      const provider = validate(providerSchema, request.params.provider);

      try {
        const { error: deleteError } = await supabaseAdmin
          .from('integrations')
          .delete()
          .eq('org_id', request.orgId!)
          .eq('provider', provider);

        if (deleteError) {
          throw new AppError(500, 'INTEGRATION_DISCONNECT_FAILED', deleteError.message);
        }

        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err, provider }, 'Failed to disconnect integration');
        throw new AppError(500, 'INTEGRATION_DISCONNECT_FAILED', 'Failed to disconnect integration');
      }
    },
  );
}
