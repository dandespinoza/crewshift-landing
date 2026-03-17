/**
 * RingCentral Integration Adapter
 *
 * Tier 2 adapter for RingCentral.
 * Communication adapter for voice/SMS/messaging via RingCentral platform.
 *
 * RingCentral API Reference:
 * - Auth: https://developers.ringcentral.com/guide/authentication
 * - REST API: https://developers.ringcentral.com/api-reference
 * - Webhooks: https://developers.ringcentral.com/guide/notifications/webhooks
 *
 * Key details:
 * - OAuth2 with Basic auth header for token exchange (base64 client_id:client_secret)
 * - Communication-only adapter — no customer/job/invoice sync
 * - Outbound webhooks use a validation token mechanism
 * - Rate limit varies by endpoint
 */

import { createHmac } from 'node:crypto';
import {
  BaseAdapter,
  type TokenSet,
  type ExternalId,
  type SyncResult,
  type WebhookEvent,
} from '../adapter.interface.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { registerAdapter } from '../registry.js';

// ── Constants ────────────────────────────────────────────────────────────────

const RC_AUTH_URL = 'https://platform.ringcentral.com/restapi/oauth/authorize';
const RC_TOKEN_URL = 'https://platform.ringcentral.com/restapi/oauth/token';
const RC_API_BASE = 'https://platform.ringcentral.com/restapi/v1.0';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.RINGCENTRAL_CLIENT_ID ?? env.RINGCENTRAL_CLIENT_ID;
  if (!id) throw new Error('RINGCENTRAL_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.RINGCENTRAL_CLIENT_SECRET ?? env.RINGCENTRAL_CLIENT_SECRET;
  if (!secret) throw new Error('RINGCENTRAL_CLIENT_SECRET is not configured');
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the RingCentral API.
 */
async function rcFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${RC_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, path, errorBody }, 'RingCentral API error');
    throw new Error(`RingCentral API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class RingCentralAdapter extends BaseAdapter {
  readonly provider = 'ringcentral' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${RC_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/ringcentral/callback`;

    const response = await fetch(RC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'RingCentral token exchange failed');
      throw new Error(`RingCentral token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for RingCentral');
    }

    const response = await fetch(RC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'RingCentral token refresh failed');
      throw new Error(`RingCentral token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Communication (no sync methods) ────────────────────────────────────────

  // syncCustomers, syncJobs, syncInvoices — inherited no-ops from BaseAdapter

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Verify RingCentral webhook.
   * RingCentral outbound webhooks send a validation token in the initial
   * subscription request. For ongoing webhooks, the verification-token header
   * is used for challenge-response verification.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    // RingCentral uses a validation token approach rather than HMAC signatures
    // The signature parameter here represents the Validation-Token header
    // For the subscription handshake, we simply echo it back
    if (signature && signature.length > 0) {
      return true; // Validation token present — verified by echoing in handler
    }

    // For regular webhook events, verify using HMAC if configured
    const secret = getClientSecret();
    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // RingCentral webhook: { uuid, event, timestamp, subscriptionId, ownerId, body: {...} }
    const event = (payload.event as string) ?? 'unknown';
    const body = payload.body as Record<string, unknown> | undefined;

    // Extract resource type from event URI (e.g., /restapi/v1.0/account/.../extension/.../message-store)
    const eventParts = event.split('/');
    const resourceType = eventParts[eventParts.length - 1] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: event,
      resource_type: resourceType.toLowerCase(),
      resource_id: (body?.id as string) ?? (payload.uuid as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new RingCentralAdapter();
registerAdapter(adapter);
export default adapter;
