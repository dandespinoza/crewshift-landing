/**
 * Calendly Integration Adapter
 *
 * Native (Tier 1) adapter for Calendly.
 * Handles OAuth 2.1, scheduled event sync, and webhook processing.
 *
 * Calendly API Reference:
 * - Auth: https://developer.calendly.com/api-docs/ZG9jOjM2MzE2MDM4-authorization
 * - Events: https://developer.calendly.com/api-docs/b3A6NTkxNDEy-list-events
 * - Webhooks: https://developer.calendly.com/api-docs/b3A6NTkxNDI1-create-webhook-subscription
 *
 * Key details:
 * - OAuth token exchange uses HTTP Basic auth (client_id:client_secret)
 * - Paginated responses use page_token parameter
 * - Webhook signatures are HMAC-SHA256 of the raw payload
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
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

// -- Constants ----------------------------------------------------------------

const CALENDLY_AUTH_URL = 'https://auth.calendly.com/oauth/authorize';
const CALENDLY_TOKEN_URL = 'https://auth.calendly.com/oauth/token';
const CALENDLY_API_BASE = 'https://api.calendly.com';

// -- Helpers ------------------------------------------------------------------

/**
 * Build Basic auth header from client credentials.
 */
function getBasicAuthHeader(): string {
  const clientId = env.CALENDLY_CLIENT_ID ?? '';
  const clientSecret = env.CALENDLY_CLIENT_SECRET ?? '';
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Calendly API.
 */
async function calendlyFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${CALENDLY_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Calendly API error',
    );
    throw new Error(`Calendly API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map a Calendly scheduled event to the CrewShift unified job format.
 */
function mapScheduledEventToJob(event: Record<string, unknown>): Record<string, unknown> {
  return {
    title: (event.name as string) ?? 'Untitled Event',
    start: (event.start_time as string) ?? null,
    end: (event.end_time as string) ?? null,
    location: event.location
      ? ((event.location as Record<string, unknown>).location as string) ?? null
      : null,
    description: null,
    status: (event.status as string) ?? 'active',
    external_ids: { calendly: (event.uri as string) ?? '' },
    source: 'calendly',
    metadata: {
      calendly_uri: event.uri,
      calendly_event_type: event.event_type,
      calendly_status: event.status,
      calendly_created_at: event.created_at,
      calendly_updated_at: event.updated_at,
      calendly_invitees_counter: event.invitees_counter,
    },
  };
}

// -- Adapter ------------------------------------------------------------------

class CalendlyAdapter extends BaseAdapter {
  readonly provider = 'calendly' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.CALENDLY_CLIENT_ID;
    if (!clientId) {
      throw new Error('CALENDLY_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${CALENDLY_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/calendly/callback`;

    const response = await fetch(CALENDLY_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Calendly token exchange failed');
      throw new Error(`Calendly token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Calendly');
    }

    const response = await fetch(CALENDLY_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Calendly token refresh failed');
      throw new Error(`Calendly token refresh failed: ${response.status}`);
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

  // -- Sync: Calendly -> CrewShift --------------------------------------------

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // First, get the current user to obtain their organization URI
    const meResponse = await calendlyFetch('/users/me', accessToken);
    const meData = (await meResponse.json()) as Record<string, unknown>;
    const resource = meData.resource as Record<string, unknown>;
    const currentOrg = resource.current_organization as string;

    if (!currentOrg) {
      throw new Error('Could not determine Calendly organization URI');
    }

    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        organization: currentOrg,
        count: '100',
      });

      if (lastSyncAt) {
        params.set('min_start_time', lastSyncAt);
      }

      if (pageToken) {
        params.set('page_token', pageToken);
      }

      const response = await calendlyFetch(
        `/scheduled_events?${params.toString()}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const collection = (data.collection as Record<string, unknown>[]) ?? [];
      const pagination = data.pagination as Record<string, unknown> | undefined;

      for (const event of collection) {
        try {
          const mapped = mapScheduledEventToJob(event);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: event, error: (err as Error).message });
        }
      }

      pageToken = pagination?.next_page_token as string | undefined;
    } while (pageToken);

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Calendly event sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * Verify Calendly webhook signature.
   *
   * Calendly signs webhook payloads with HMAC-SHA256 using the webhook
   * signing key. The signature is sent in the Calendly-Webhook-Signature header.
   * Format: "t=<timestamp>,v1=<signature>"
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const webhookSecret = env.CALENDLY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.warn('No Calendly webhook secret configured');
      return false;
    }

    // Parse the signature header: "t=<timestamp>,v1=<hmac>"
    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const signaturePart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) {
      logger.warn('Invalid Calendly webhook signature format');
      return false;
    }

    const timestamp = timestampPart.slice(2);
    const receivedSignature = signaturePart.slice(3);

    // Build the signed content: timestamp.payload
    const signedContent = `${timestamp}.${payload.toString('utf-8')}`;
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(receivedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Calendly webhook payload structure:
    // { event: "invitee.created", payload: { uri, name, start_time, ... } }
    const eventType = (payload.event as string) ?? 'unknown';
    const eventPayload = (payload.payload as Record<string, unknown>) ?? {};

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: eventType.split('.')[0] ?? 'unknown',
      resource_id: (eventPayload.uri as string) ?? undefined,
      data: {
        event: eventType,
        uri: eventPayload.uri,
        name: eventPayload.name,
        start_time: eventPayload.start_time,
        end_time: eventPayload.end_time,
        status: eventPayload.status,
        ...payload,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new CalendlyAdapter();
registerAdapter(adapter);
export default adapter;
