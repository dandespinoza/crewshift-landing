/**
 * Constant Contact Integration Adapter
 *
 * Tier 2 adapter for Constant Contact.
 * Handles OAuth2 and contact (customer) sync.
 *
 * Constant Contact API Reference:
 * - Auth: https://developer.constantcontact.com/api_guide/auth_overview.html
 * - Contacts: https://developer.constantcontact.com/api_reference/index.html#!/Contacts
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Token exchange uses Basic auth (base64 client_id:client_secret)
 * - Contacts use cursor-based pagination
 * - Rate limit: 10,000 requests per day
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

const CC_AUTH_URL = 'https://authz.constantcontact.com/oauth2/default/v1/authorize';
const CC_TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token';
const CC_API_BASE = 'https://api.cc.email/v3';
const DEFAULT_PAGE_SIZE = 500; // Max allowed by CC

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.CONSTANT_CONTACT_CLIENT_ID ?? env.CONSTANT_CONTACT_CLIENT_ID;
  if (!id) throw new Error('CONSTANT_CONTACT_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.CONSTANT_CONTACT_CLIENT_SECRET ?? env.CONSTANT_CONTACT_CLIENT_SECRET;
  if (!secret) throw new Error('CONSTANT_CONTACT_CLIENT_SECRET is not configured');
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Constant Contact API.
 */
async function ccFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${CC_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'Constant Contact API error');
    throw new Error(`Constant Contact API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ConstantContactAdapter extends BaseAdapter {
  readonly provider = 'constant-contact' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'contact_data offline_access',
      state: orgId,
    });

    return `${CC_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/constant-contact/callback`;

    const response = await fetch(CC_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Constant Contact token exchange failed');
      throw new Error(`Constant Contact token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Constant Contact');
    }

    const response = await fetch(CC_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Constant Contact token refresh failed');
      throw new Error(`Constant Contact token refresh failed: ${response.status}`);
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

  // ── Sync: Constant Contact → CrewShift ────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        limit: String(DEFAULT_PAGE_SIZE),
        include: 'street_addresses,phone_numbers,custom_fields',
      });
      if (cursor) params.set('cursor', cursor);
      if (lastSyncAt) params.set('updated_after', lastSyncAt);

      const response = await ccFetch(`/contacts?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const contacts = (data.contacts as Record<string, unknown>[]) ?? [];

      for (const contact of contacts) {
        try {
          records.push(this.mapCCContact(contact));
          created++;
        } catch (err) {
          errors.push({ item: contact, error: (err as Error).message });
        }
      }

      // Cursor from _links.next.href
      const links = data._links as Record<string, unknown> | undefined;
      const nextLink = links?.next as Record<string, unknown> | undefined;
      const nextHref = nextLink?.href as string | undefined;

      if (nextHref) {
        // Extract cursor from the next URL
        const nextUrl = new URL(nextHref, CC_API_BASE);
        cursor = nextUrl.searchParams.get('cursor') ?? undefined;
      } else {
        cursor = undefined;
      }
    } while (cursor);

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Constant Contact contact sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getClientSecret();
    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Constant Contact webhook payload
    const eventType = (payload.event_type as string) ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'contact',
      resource_id: (payload.contact_id as string) ?? undefined,
      data: payload,
      timestamp: (payload.event_date as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapCCContact(contact: Record<string, unknown>): Record<string, unknown> {
    const emailAddress = contact.email_address as Record<string, unknown> | undefined;
    const streetAddresses = (contact.street_addresses as Array<Record<string, unknown>>) ?? [];
    const primaryAddr = streetAddresses[0];
    const phoneNumbers = (contact.phone_numbers as Array<Record<string, unknown>>) ?? [];
    const primaryPhone = phoneNumbers[0];

    return {
      name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null,
      company_name: (contact.company_name as string) ?? null,
      email: (emailAddress?.address as string) ?? null,
      phone: (primaryPhone?.phone_number as string) ?? null,
      address: primaryAddr
        ? {
            street: (primaryAddr.street as string) ?? '',
            city: (primaryAddr.city as string) ?? '',
            state: (primaryAddr.state as string) ?? '',
            zip: (primaryAddr.postal_code as string) ?? '',
            country: (primaryAddr.country as string) ?? '',
          }
        : null,
      external_ids: { 'constant-contact': String(contact.contact_id) },
      source: 'constant-contact',
      metadata: {
        cc_source: contact.source,
        cc_created_at: contact.created_at,
        cc_updated_at: contact.updated_at,
        cc_list_memberships: contact.list_memberships,
        cc_tags: contact.taggings,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ConstantContactAdapter();
registerAdapter(adapter);
export default adapter;
