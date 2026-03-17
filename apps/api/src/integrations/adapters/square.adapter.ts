/**
 * Square Integration Adapter
 *
 * Tier 2 adapter for Square.
 * Handles OAuth2, customer/invoice sync, invoice/payment creation, and webhooks.
 *
 * Square API Reference:
 * - Auth: https://developer.squareup.com/docs/oauth-api/overview
 * - Customers: https://developer.squareup.com/reference/square/customers-api
 * - Invoices: https://developer.squareup.com/reference/square/invoices-api
 * - Payments: https://developer.squareup.com/reference/square/payments-api
 * - Webhooks: https://developer.squareup.com/docs/webhooks/overview
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Customers use cursor-based pagination
 * - Invoice search is POST-based
 * - Webhook verification: HMAC-SHA256 with x-square-hmacsha256-signature
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

const SQUARE_AUTH_URL = 'https://connect.squareup.com/oauth2/authorize';
const SQUARE_TOKEN_URL = 'https://connect.squareup.com/oauth2/token';
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.SQUARE_CLIENT_ID ?? env.SQUARE_CLIENT_ID;
  if (!id) throw new Error('SQUARE_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.SQUARE_CLIENT_SECRET ?? env.SQUARE_CLIENT_SECRET;
  if (!secret) throw new Error('SQUARE_CLIENT_SECRET is not configured');
  return secret;
}

function getWebhookSignatureKey(): string {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) throw new Error('SQUARE_WEBHOOK_SIGNATURE_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the Square API.
 */
async function squareFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SQUARE_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Square-Version': '2024-12-18',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, path, errorBody }, 'Square API error');
    throw new Error(`Square API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SquareAdapter extends BaseAdapter {
  readonly provider = 'square' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'CUSTOMERS_READ CUSTOMERS_WRITE INVOICES_READ INVOICES_WRITE PAYMENTS_READ PAYMENTS_WRITE',
      state: orgId,
    });

    return `${SQUARE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(SQUARE_TOKEN_URL, {
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
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Square token exchange failed');
      throw new Error(`Square token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_at as string | undefined,
      scope: undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Square');
    }

    const response = await fetch(SQUARE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Square token refresh failed');
      throw new Error(`Square token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_at as string | undefined,
      scope: undefined,
    };
  }

  // ── Sync: Square → CrewShift ──────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: String(DEFAULT_PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);

      const response = await squareFetch(`/customers?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const customers = (data.customers as Record<string, unknown>[]) ?? [];

      for (const cust of customers) {
        try {
          records.push(this.mapSquareCustomer(cust));
          created++;
        } catch (err) {
          errors.push({ item: cust, error: (err as Error).message });
        }
      }

      cursor = data.cursor as string | undefined;
    } while (cursor);

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Square customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Square requires a location_id; retrieve primary location first
    const locResponse = await squareFetch('/locations', accessToken);
    const locData = (await locResponse.json()) as Record<string, unknown>;
    const locations = (locData.locations as Record<string, unknown>[]) ?? [];
    const primaryLocation = locations[0];

    if (!primaryLocation) {
      logger.warn('No Square locations found — cannot sync invoices');
      return { created: 0, updated: 0, skipped: 0, errors: [], records: [] };
    }

    const locationId = primaryLocation.id as string;
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor: string | undefined;

    do {
      const searchBody: Record<string, unknown> = {
        location_id: locationId,
        limit: DEFAULT_PAGE_SIZE,
      };
      if (cursor) searchBody.cursor = cursor;

      const response = await squareFetch('/invoices/search', accessToken, {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });

      const data = (await response.json()) as Record<string, unknown>;
      const invoices = (data.invoices as Record<string, unknown>[]) ?? [];

      for (const inv of invoices) {
        try {
          records.push(this.mapSquareInvoice(inv));
          created++;
        } catch (err) {
          errors.push({ item: inv, error: (err as Error).message });
        }
      }

      cursor = data.cursor as string | undefined;
    } while (cursor);

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Square invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Square ────────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    // Get primary location
    const locResponse = await squareFetch('/locations', accessToken);
    const locData = (await locResponse.json()) as Record<string, unknown>;
    const locations = (locData.locations as Record<string, unknown>[]) ?? [];
    const locationId = (locations[0]?.id as string) ?? '';

    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];

    const squareInvoice = {
      invoice: {
        location_id: locationId,
        primary_recipient: invoiceData.customer_external_id
          ? { customer_id: invoiceData.customer_external_id }
          : undefined,
        payment_requests: [
          {
            request_type: 'BALANCE',
            due_date: invoiceData.due_date ?? undefined,
          },
        ],
        delivery_method: 'EMAIL',
        title: (invoiceData.description as string) ?? 'Invoice',
      },
      idempotency_key: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };

    const response = await squareFetch('/invoices', accessToken, {
      method: 'POST',
      body: JSON.stringify(squareInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const invoice = result.invoice as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(invoice.id),
    };
  }

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const amountCents = Math.round((paymentData.amount as number) * 100);

    const squarePayment = {
      source_id: (paymentData.source_id as string) ?? 'EXTERNAL',
      idempotency_key: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      amount_money: {
        amount: amountCents,
        currency: ((paymentData.currency as string) ?? 'USD').toUpperCase(),
      },
      customer_id: paymentData.customer_external_id ?? undefined,
      note: (paymentData.description as string) ?? undefined,
    };

    const response = await squareFetch('/payments', accessToken, {
      method: 'POST',
      body: JSON.stringify(squarePayment),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const payment = result.payment as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(payment.id),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    let signatureKey: string;
    try {
      signatureKey = getWebhookSignatureKey();
    } catch {
      logger.warn('No Square webhook signature key configured');
      return false;
    }

    // Square uses HMAC-SHA256 with the webhook signature key
    // The notification URL is prepended to the payload for signing
    const hash = createHmac('sha256', signatureKey)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Square webhook: { merchant_id, type, event_id, data: { type, id, object: {...} } }
    const eventType = (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: (data?.type as string)?.toLowerCase() ?? 'unknown',
      resource_id: (data?.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.created_at as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapSquareCustomer(cust: Record<string, unknown>): Record<string, unknown> {
    const address = cust.address as Record<string, unknown> | undefined;

    return {
      name: [cust.given_name, cust.family_name].filter(Boolean).join(' ') || cust.company_name || null,
      company_name: (cust.company_name as string) ?? null,
      email: (cust.email_address as string) ?? null,
      phone: (cust.phone_number as string) ?? null,
      address: address
        ? {
            street: [address.address_line_1, address.address_line_2].filter(Boolean).join(', '),
            city: (address.locality as string) ?? '',
            state: (address.administrative_district_level_1 as string) ?? '',
            zip: (address.postal_code as string) ?? '',
            country: (address.country as string) ?? '',
          }
        : null,
      external_ids: { square: String(cust.id) },
      source: 'square',
      metadata: {
        square_reference_id: cust.reference_id,
        square_created_at: cust.created_at,
        square_updated_at: cust.updated_at,
        square_group_ids: cust.group_ids,
      },
    };
  }

  private mapSquareInvoice(inv: Record<string, unknown>): Record<string, unknown> {
    const paymentRequests = (inv.payment_requests as Array<Record<string, unknown>>) ?? [];
    const primaryRequest = paymentRequests[0] as Record<string, unknown> | undefined;
    const totalMoney = primaryRequest?.total_completed_amount_money as Record<string, unknown> | undefined;
    const computedTotal = primaryRequest?.computed_amount_money as Record<string, unknown> | undefined;

    return {
      invoice_number: (inv.invoice_number as string) ?? null,
      status: ((inv.status as string) ?? 'unknown').toLowerCase(),
      amount: computedTotal ? (computedTotal.amount as number) / 100 : 0,
      balance_due: 0,
      due_date: (primaryRequest?.due_date as string) ?? null,
      issued_date: (inv.created_at as string) ?? null,
      customer_external_id: null,
      external_ids: { square: String(inv.id) },
      line_items: [],
      source: 'square',
      metadata: {
        square_location_id: inv.location_id,
        square_order_id: inv.order_id,
        square_version: inv.version,
        square_status: inv.status,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SquareAdapter();
registerAdapter(adapter);
export default adapter;
