/**
 * Podium Integration Adapter
 *
 * Tier 3 (native) adapter for Podium — customer messaging and reputation platform.
 * Handles OAuth 2.0 / JWT auth, contact sync, and HMAC webhook verification.
 *
 * Podium API Reference:
 * - Auth: https://docs.podium.com/docs/authentication
 * - Contacts: https://docs.podium.com/reference/contacts
 * - Webhooks: https://docs.podium.com/docs/webhooks
 *
 * Key details:
 * - Developer application approval required
 * - OAuth 2.0 with JWT-based access tokens
 * - Contacts endpoint supports cursor-based pagination
 * - Webhook verification via HMAC-SHA256
 * - Env: PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET
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

const AUTH_URL = 'https://api.podium.com/oauth/authorize';
const TOKEN_URL = 'https://api.podium.com/oauth/token';
const API_BASE = 'https://api.podium.com/v4';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.PODIUM_CLIENT_ID ?? (env as Record<string, unknown>).PODIUM_CLIENT_ID as string | undefined;
  if (!id) throw new Error('PODIUM_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.PODIUM_CLIENT_SECRET ?? (env as Record<string, unknown>).PODIUM_CLIENT_SECRET as string | undefined;
  if (!secret) throw new Error('PODIUM_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Podium API.
 */
async function podiumFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

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
      'Podium API error',
    );
    throw new Error(`Podium API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Podium list endpoints using cursor-based pagination.
 */
async function podiumPaginateAll(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const searchParams = new URLSearchParams({
      limit: String(DEFAULT_PAGE_SIZE),
      ...params,
    });
    if (cursor) {
      searchParams.set('cursor', cursor);
    }

    const response = await podiumFetch(
      `${path}?${searchParams.toString()}`,
      accessToken,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? [];

    results.push(...items);

    const metadata = data.metadata as Record<string, unknown> | undefined;
    cursor = metadata?.cursor as string | undefined;
    hasMore = !!cursor && items.length === DEFAULT_PAGE_SIZE;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class PodiumAdapter extends BaseAdapter {
  readonly provider = 'podium' as const;
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

    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${env.API_URL}/api/integrations/podium/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Podium token exchange failed');
      throw new Error(`Podium token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Podium');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Podium token refresh failed');
      throw new Error(`Podium token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Podium → CrewShift ───────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const contacts = await podiumPaginateAll('/contacts', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const contact of contacts) {
      try {
        const mapped = this.mapContact(contact);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: contacts.length, created, errors: errors.length },
      'Podium contact sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = process.env.PODIUM_CLIENT_SECRET ?? (env as Record<string, unknown>).PODIUM_CLIENT_SECRET as string | undefined;
    if (!secret) {
      logger.warn('No Podium client secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: (payload.resource_type as string) ?? 'contact',
      resource_id: (data?.id as string) ?? (payload.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Podium Contact to CrewShift's unified customer format.
   */
  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    const phones = contact.phones as Array<Record<string, unknown>> | undefined;
    const emails = contact.emails as Array<Record<string, unknown>> | undefined;
    const addresses = contact.addresses as Array<Record<string, unknown>> | undefined;
    const primaryAddress = addresses?.[0];

    return {
      name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.name,
      company_name: (contact.companyName as string) ?? null,
      email: (emails?.[0]?.value as string) ?? null,
      phone: (phones?.[0]?.value as string) ?? null,
      address: primaryAddress
        ? {
            street: (primaryAddress.street as string) ?? '',
            city: (primaryAddress.city as string) ?? '',
            state: (primaryAddress.state as string) ?? '',
            zip: (primaryAddress.postalCode as string) ?? '',
          }
        : null,
      external_ids: { podium: String(contact.uid ?? contact.id) },
      source: 'podium',
      metadata: {
        podium_tags: contact.tags ?? [],
        podium_created_at: contact.createdAt,
        podium_updated_at: contact.updatedAt,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new PodiumAdapter();
registerAdapter(adapter);
export default adapter;
