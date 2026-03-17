/**
 * GoCardless Integration Adapter
 *
 * Native (Tier 1) adapter for GoCardless.
 * Handles OAuth2/access token auth, customer/payment sync, payment creation, and webhooks.
 *
 * GoCardless API Reference:
 * - API Docs: https://developer.gocardless.com/api-reference
 * - OAuth: https://developer.gocardless.com/getting-started/api/making-your-first-payment/
 * - Customers: https://developer.gocardless.com/api-reference#customers-list-customers
 * - Payments: https://developer.gocardless.com/api-reference#payments-list-payments
 * - Webhooks: https://developer.gocardless.com/api-reference#appendix-webhooks
 *
 * Key details:
 * - OAuth 2.0 or direct access token
 * - All requests require GoCardless-Version header (e.g., '2015-07-06')
 * - Cursor-based pagination via `after` parameter
 * - Webhook verification: HMAC-SHA256 with Webhook-Signature header
 * - Amounts in pence/cents (smallest currency unit, integer)
 * - Idempotency keys supported via Idempotency-Key header
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

// ── Constants ────────────────────────────────────────────────────────────────

const AUTH_URL = 'https://connect.gocardless.com/oauth/authorize';
const SANDBOX_AUTH_URL = 'https://connect-sandbox.gocardless.com/oauth/authorize';

const TOKEN_URL = 'https://connect.gocardless.com/oauth/access_token';
const SANDBOX_TOKEN_URL = 'https://connect-sandbox.gocardless.com/oauth/access_token';

const API_BASE = 'https://api.gocardless.com';
const SANDBOX_API_BASE = 'https://api-sandbox.gocardless.com';

const GC_API_VERSION = '2015-07-06';
const DEFAULT_PAGE_SIZE = 50; // GoCardless max is 500, default 50

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSandbox(): boolean {
  return env.NODE_ENV !== 'production';
}

function getOAuthAuthUrl(): string {
  return isSandbox() ? SANDBOX_AUTH_URL : AUTH_URL;
}

function getOAuthTokenUrl(): string {
  return isSandbox() ? SANDBOX_TOKEN_URL : TOKEN_URL;
}

function getApiBase(): string {
  return isSandbox() ? SANDBOX_API_BASE : API_BASE;
}

function getClientId(): string {
  const id = process.env.GOCARDLESS_CLIENT_ID ?? env.GOCARDLESS_CLIENT_ID;
  if (!id) throw new Error('GOCARDLESS_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOCARDLESS_CLIENT_SECRET ?? env.GOCARDLESS_CLIENT_SECRET;
  if (!secret) throw new Error('GOCARDLESS_CLIENT_SECRET is not configured');
  return secret;
}

function getWebhookSecret(): string {
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET ?? env.GOCARDLESS_WEBHOOK_SECRET;
  if (!secret) throw new Error('GOCARDLESS_WEBHOOK_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the GoCardless API.
 */
async function gcFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const base = getApiBase();
  const url = `${base}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'GoCardless-Version': GC_API_VERSION,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'GoCardless API error',
    );
    throw new Error(`GoCardless API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a GoCardless list endpoint using cursor-based pagination.
 * GoCardless uses { meta: { cursors: { after, before }, limit }, resource_key: [...] }
 */
async function gcPaginateAll(
  path: string,
  resourceKey: string,
  accessToken: string,
  extraParams: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let afterCursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      limit: String(DEFAULT_PAGE_SIZE),
      ...extraParams,
    });
    if (afterCursor) {
      params.set('after', afterCursor);
    }

    const response = await gcFetch(`${path}?${params.toString()}`, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resourceKey] as Record<string, unknown>[]) ?? [];

    results.push(...items);

    const meta = data.meta as Record<string, unknown> | undefined;
    const cursors = meta?.cursors as Record<string, unknown> | undefined;
    afterCursor = (cursors?.after as string) ?? null;

    if (!afterCursor || items.length === 0) {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class GoCardlessAdapter extends BaseAdapter {
  readonly provider = 'gocardless' as const;
  readonly tier = 'native' as const;

  // ── OAuth ──────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'read_write',
      state: orgId,
      // GoCardless requires pre-fill or initial action
      initial_view: 'login',
    });

    return `${getOAuthAuthUrl()}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const tokenUrl = getOAuthTokenUrl();

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${env.API_URL}/api/integrations/gocardless/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'GoCardless token exchange failed');
      throw new Error(`GoCardless token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: undefined, // GoCardless access tokens don't expire for partner integrations
      expires_at: undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    // GoCardless access tokens for partner integrations don't expire.
    // For organisation-level access tokens, they are long-lived.
    // If a refresh is needed, re-authenticate via OAuth.
    logger.warn('GoCardless tokens are long-lived and do not support refresh. Re-authenticate via OAuth if needed.');
    return currentTokens;
  }

  // ── Sync: GoCardless → CrewShift ───────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const params: Record<string, string> = {};
    if (lastSyncAt) {
      // GoCardless uses created_at[gte] filter format
      params['created_at[gte]'] = lastSyncAt;
    }

    const gcCustomers = await gcPaginateAll('/customers', 'customers', accessToken, params);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const gcCust of gcCustomers) {
      try {
        const mapped = this.mapGCCustomer(gcCust);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: gcCust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: gcCustomers.length, created, errors: errors.length },
      'GoCardless customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // GoCardless doesn't have "invoices" — payments are the closest equivalent
    const params: Record<string, string> = {};
    if (lastSyncAt) {
      params['created_at[gte]'] = lastSyncAt;
    }

    const gcPayments = await gcPaginateAll('/payments', 'payments', accessToken, params);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const gcPmt of gcPayments) {
      try {
        const mapped = this.mapGCPaymentAsInvoice(gcPmt);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: gcPmt, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: gcPayments.length, created, errors: errors.length },
      'GoCardless payment (invoice) sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → GoCardless ─────────────────────────────────

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    // GoCardless payments require a mandate (Direct Debit authorization)
    const gcPayment: Record<string, unknown> = {
      payments: {
        // Amount in pence/cents (smallest currency unit)
        amount: Math.round((paymentData.amount as number) * 100),
        currency: (paymentData.currency as string)?.toUpperCase() ?? 'GBP',
        description: paymentData.description ?? undefined,
        metadata: (paymentData.metadata as Record<string, string>) ?? {},
        links: {
          mandate: paymentData.mandate_id,
        },
      },
    };

    if (paymentData.charge_date) {
      (gcPayment.payments as Record<string, unknown>).charge_date = paymentData.charge_date;
    }

    if (paymentData.reference) {
      (gcPayment.payments as Record<string, unknown>).reference = paymentData.reference;
    }

    // GoCardless recommends idempotency keys for payment creation
    const headers: Record<string, string> = {};
    if (paymentData.idempotency_key) {
      headers['Idempotency-Key'] = String(paymentData.idempotency_key);
    }

    const response = await gcFetch('/payments', accessToken, {
      method: 'POST',
      body: JSON.stringify(gcPayment),
      headers,
    });

    const result = (await response.json()) as Record<string, unknown>;
    const payment = result.payments as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: payment.id as string,
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    let webhookSecret: string;
    try {
      webhookSecret = getWebhookSecret();
    } catch {
      logger.warn('No GoCardless webhook secret configured');
      return false;
    }

    // GoCardless webhook signature: Webhook-Signature header
    // HMAC-SHA256 of the raw body using the webhook endpoint secret
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // GoCardless webhook structure:
    // { events: [{ id, created_at, resource_type, action, links: { ... }, details: { ... } }] }
    const events = (payload.events as Array<Record<string, unknown>>) ?? [];
    const firstEvent = events[0];

    if (!firstEvent) {
      return {
        provider: this.provider,
        event_type: 'unknown',
        resource_type: 'unknown',
        resource_id: undefined,
        data: payload,
        timestamp: new Date().toISOString(),
      };
    }

    const resourceType = (firstEvent.resource_type as string) ?? 'unknown';
    const action = (firstEvent.action as string) ?? 'unknown';
    const links = (firstEvent.links as Record<string, unknown>) ?? {};

    // The resource ID is in links, keyed by resource_type (e.g., links.payment, links.mandate)
    const resourceId = (links[resourceType] as string) ?? undefined;

    return {
      provider: this.provider,
      event_type: `${resourceType}.${action}`,
      resource_type: resourceType,
      resource_id: resourceId,
      data: payload,
      timestamp: (firstEvent.created_at as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a GoCardless Customer to CrewShift's unified customer format.
   */
  private mapGCCustomer(gcCust: Record<string, unknown>): Record<string, unknown> {
    return {
      name: [gcCust.given_name, gcCust.family_name].filter(Boolean).join(' ') ||
        (gcCust.company_name as string) ||
        null,
      company_name: (gcCust.company_name as string) ?? null,
      email: (gcCust.email as string) ?? null,
      phone: (gcCust.phone_number as string) ?? null,
      address: gcCust.address_line1
        ? {
            street: [gcCust.address_line1, gcCust.address_line2, gcCust.address_line3]
              .filter(Boolean)
              .join(', '),
            city: (gcCust.city as string) ?? '',
            state: (gcCust.region as string) ?? '',
            zip: (gcCust.postal_code as string) ?? '',
            country: (gcCust.country_code as string) ?? '',
          }
        : null,
      external_ids: {
        gocardless: String(gcCust.id),
      },
      source: 'gocardless',
      metadata: {
        gc_language: gcCust.language,
        gc_swedish_identity_number: gcCust.swedish_identity_number,
        gc_danish_identity_number: gcCust.danish_identity_number,
        gc_created_at: gcCust.created_at,
        gc_metadata: gcCust.metadata,
      },
    };
  }

  /**
   * Map a GoCardless Payment to CrewShift's unified invoice format.
   * GoCardless payments are Direct Debit collections, which map closest to invoices.
   */
  private mapGCPaymentAsInvoice(gcPmt: Record<string, unknown>): Record<string, unknown> {
    const links = (gcPmt.links as Record<string, unknown>) ?? {};
    // Amount is in pence/cents
    const amountInCents = (gcPmt.amount as number) ?? 0;

    return {
      invoice_number: (gcPmt.reference as string) ?? null,
      status: this.mapGCPaymentStatus(gcPmt),
      amount: amountInCents / 100,
      balance_due: gcPmt.status === 'paid_out' ? 0 : amountInCents / 100,
      due_date: (gcPmt.charge_date as string) ?? null,
      issued_date: (gcPmt.created_at as string) ?? null,
      customer_external_id: (links.customer as string) ?? null,
      external_ids: {
        gocardless: String(gcPmt.id),
      },
      line_items: [
        {
          description: (gcPmt.description as string) ?? 'Direct Debit payment',
          quantity: 1,
          unit_price: amountInCents / 100,
          total: amountInCents / 100,
        },
      ],
      source: 'gocardless',
      metadata: {
        gc_mandate_id: links.mandate,
        gc_subscription_id: links.subscription,
        gc_payout_id: links.payout,
        gc_status: gcPmt.status,
        gc_currency: gcPmt.currency,
        gc_charge_date: gcPmt.charge_date,
        gc_created_at: gcPmt.created_at,
        gc_fx: gcPmt.fx,
        gc_metadata: gcPmt.metadata,
      },
    };
  }

  /**
   * Map GoCardless payment status to CrewShift status.
   */
  private mapGCPaymentStatus(gcPmt: Record<string, unknown>): string {
    const status = (gcPmt.status as string) ?? '';
    switch (status) {
      case 'paid_out':
      case 'confirmed':
        return 'paid';
      case 'pending_submission':
      case 'submitted':
        return 'sent';
      case 'pending_customer_approval':
        return 'pending';
      case 'customer_approval_denied':
      case 'cancelled':
        return 'void';
      case 'failed':
        return 'failed';
      case 'charged_back':
        return 'refunded';
      default:
        return status || 'unknown';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const gocardlessAdapter = new GoCardlessAdapter();
registerAdapter(gocardlessAdapter);
export default gocardlessAdapter;
