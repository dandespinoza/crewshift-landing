/**
 * Clover Integration Adapter
 *
 * Tier 2 adapter for Clover POS.
 * Handles OAuth2, customer sync, payment creation, and webhooks.
 *
 * Clover API Reference:
 * - Auth: https://docs.clover.com/docs/using-oauth-20
 * - Customers: https://docs.clover.com/reference/customergetcustomers
 * - Charges: https://docs.clover.com/reference/createcharge
 * - Webhooks: https://docs.clover.com/docs/webhooks
 *
 * Key details:
 * - OAuth2 flow; token exchange uses client_id/client_secret in query params
 * - Customer list uses offset/limit pagination
 * - API requests are scoped to a merchant ID in the URL path
 * - Webhook verification uses the app secret
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

const CLOVER_AUTH_URL_SANDBOX = 'https://sandbox.dev.clover.com/oauth/authorize';
const CLOVER_AUTH_URL_PRODUCTION = 'https://www.clover.com/oauth/authorize';
const CLOVER_TOKEN_URL_SANDBOX = 'https://sandbox.dev.clover.com/oauth/token';
const CLOVER_TOKEN_URL_PRODUCTION = 'https://www.clover.com/oauth/token';
const CLOVER_API_BASE = 'https://api.clover.com/v3/merchants';
const CLOVER_ECOMM_BASE = 'https://scl.clover.com';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSandbox(): boolean {
  return env.NODE_ENV !== 'production';
}

function getAuthUrl(): string {
  return isSandbox() ? CLOVER_AUTH_URL_SANDBOX : CLOVER_AUTH_URL_PRODUCTION;
}

function getTokenUrl(): string {
  return isSandbox() ? CLOVER_TOKEN_URL_SANDBOX : CLOVER_TOKEN_URL_PRODUCTION;
}

function getClientId(): string {
  const id = process.env.CLOVER_CLIENT_ID ?? env.CLOVER_CLIENT_ID;
  if (!id) throw new Error('CLOVER_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.CLOVER_CLIENT_SECRET ?? env.CLOVER_CLIENT_SECRET;
  if (!secret) throw new Error('CLOVER_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Clover API.
 * Requires merchantId in the path.
 */
async function cloverFetch(
  merchantId: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${CLOVER_API_BASE}/${merchantId}${path}`;

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
    logger.error({ status: response.status, path, merchantId, errorBody }, 'Clover API error');
    throw new Error(`Clover API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class CloverAdapter extends BaseAdapter {
  readonly provider = 'clover' as const;
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

    return `${getAuthUrl()}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const tokenUrl = getTokenUrl();

    // Clover token exchange passes params in query string
    const params = new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
    });

    const response = await fetch(`${tokenUrl}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Clover token exchange failed');
      throw new Error(`Clover token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: undefined, // Clover tokens don't expire by default
      expires_at: undefined,
      scope: undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // Clover access tokens are long-lived and do not typically require refresh
    throw new Error('Clover tokens are long-lived. Re-authorize if token is revoked.');
  }

  // ── Sync: Clover → CrewShift ──────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Access token format: "token|merchantId"
    const [token, merchantId] = this.parseAccessToken(accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await cloverFetch(
        merchantId,
        `/customers?offset=${offset}&limit=${DEFAULT_PAGE_SIZE}&expand=addresses,emailAddresses,phoneNumbers`,
        token,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const elements = (data.elements as Record<string, unknown>[]) ?? [];

      for (const cust of elements) {
        try {
          records.push(this.mapCloverCustomer(cust));
          created++;
        } catch (err) {
          errors.push({ item: cust, error: (err as Error).message });
        }
      }

      if (elements.length < DEFAULT_PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += DEFAULT_PAGE_SIZE;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Clover customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Clover ────────────────────────────────────────

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    // Clover Ecomm API for charges
    const amountCents = Math.round((paymentData.amount as number) * 100);

    const chargeBody = {
      source: (paymentData.source_token as string) ?? undefined,
      amount: amountCents,
      currency: ((paymentData.currency as string) ?? 'usd').toLowerCase(),
      description: (paymentData.description as string) ?? undefined,
    };

    const response = await fetch(`${CLOVER_ECOMM_BASE}/v1/charges`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(chargeBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Clover charge creation failed');
      throw new Error(`Clover charge creation failed: ${response.status}`);
    }

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.id),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const appSecret = getClientSecret();

    const hash = createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Clover webhook: { appId, merchants: { merchantId: [{ type, objectId, ts }] } }
    const merchants = payload.merchants as Record<string, unknown> | undefined;
    let eventType = 'unknown';
    let resourceId: string | undefined;
    let resourceType = 'unknown';

    if (merchants) {
      const merchantId = Object.keys(merchants)[0];
      const events = (merchants[merchantId] as Array<Record<string, unknown>>) ?? [];
      const firstEvent = events[0];
      if (firstEvent) {
        eventType = (firstEvent.type as string) ?? 'unknown';
        resourceId = firstEvent.objectId as string | undefined;
        // Type format: "UPDATE" or "CREATE" with resource prefix
        resourceType = eventType.split(':')[0]?.toLowerCase() ?? 'unknown';
      }
    }

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|merchantId".
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('Clover adapter requires accessToken in format "token|merchantId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  private mapCloverCustomer(cust: Record<string, unknown>): Record<string, unknown> {
    const addresses = cust.addresses as Record<string, unknown> | undefined;
    const addressElements = (addresses?.elements as Array<Record<string, unknown>>) ?? [];
    const primaryAddr = addressElements[0];

    const emailAddresses = cust.emailAddresses as Record<string, unknown> | undefined;
    const emailElements = (emailAddresses?.elements as Array<Record<string, unknown>>) ?? [];
    const primaryEmail = emailElements[0];

    const phoneNumbers = cust.phoneNumbers as Record<string, unknown> | undefined;
    const phoneElements = (phoneNumbers?.elements as Array<Record<string, unknown>>) ?? [];
    const primaryPhone = phoneElements[0];

    return {
      name: [cust.firstName, cust.lastName].filter(Boolean).join(' ') || null,
      company_name: null,
      email: (primaryEmail?.emailAddress as string) ?? null,
      phone: (primaryPhone?.phoneNumber as string) ?? null,
      address: primaryAddr
        ? {
            street: [primaryAddr.address1, primaryAddr.address2].filter(Boolean).join(', '),
            city: (primaryAddr.city as string) ?? '',
            state: (primaryAddr.state as string) ?? '',
            zip: (primaryAddr.zip as string) ?? '',
            country: (primaryAddr.country as string) ?? '',
          }
        : null,
      external_ids: { clover: String(cust.id) },
      source: 'clover',
      metadata: {
        clover_customer_since: cust.customerSince,
        clover_marketing_allowed: cust.marketingAllowed,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new CloverAdapter();
registerAdapter(adapter);
export default adapter;
