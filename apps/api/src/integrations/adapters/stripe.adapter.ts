/**
 * Stripe Integration Adapter
 *
 * Native (Tier 1) adapter for Stripe.
 * Handles API key auth, customer/invoice sync, payment creation, and webhooks.
 *
 * Stripe API Reference:
 * - Auth: https://docs.stripe.com/api/authentication
 * - Customers: https://docs.stripe.com/api/customers
 * - Invoices: https://docs.stripe.com/api/invoices
 * - Payment Intents: https://docs.stripe.com/api/payment_intents
 * - Webhooks: https://docs.stripe.com/webhooks/signatures
 *
 * Key details:
 * - Auth via Bearer token (API secret key), not OAuth
 * - Pagination uses has_more + starting_after cursor pattern
 * - Rate limit: 25 requests/second in live mode, 25 in test mode
 * - Webhook verification: HMAC-SHA256 with timestamp tolerance
 * - All monetary amounts are in cents (smallest currency unit)
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

const API_BASE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300; // 5 minutes
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return key;
}

function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return secret;
}

/**
 * Make an authenticated request to the Stripe API.
 * Stripe uses form-encoded bodies for POST requests.
 */
async function stripeFetch(
  path: string,
  apiKey: string,
  options: RequestInit & { params?: Record<string, string> } = {},
): Promise<Response> {
  const { params, ...fetchOptions } = options;
  let url = `${API_BASE}${path}`;

  if (params && (!fetchOptions.method || fetchOptions.method === 'GET')) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-12-18.acacia',
      ...fetchOptions.headers,
    },
    body:
      fetchOptions.method === 'POST' && params
        ? new URLSearchParams(params).toString()
        : fetchOptions.body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Stripe API error',
    );
    throw new Error(`Stripe API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Stripe list endpoint using cursor-based pagination.
 */
async function stripePaginateAll(
  path: string,
  apiKey: string,
  extraParams: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Record<string, string> = {
      limit: String(DEFAULT_PAGE_SIZE),
      ...extraParams,
    };
    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const response = await stripeFetch(path, apiKey, { params });
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? [];

    results.push(...items);
    hasMore = (data.has_more as boolean) ?? false;

    if (items.length > 0) {
      startingAfter = items[items.length - 1].id as string;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class StripeAdapter extends BaseAdapter {
  readonly provider = 'stripe' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API key auth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Stripe uses API key authentication, not OAuth. Configure STRIPE_SECRET_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Stripe uses API key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Stripe uses API key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Stripe → CrewShift ───────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getSecretKey();
    const params: Record<string, string> = {};

    if (lastSyncAt) {
      params.created = JSON.stringify({ gte: Math.floor(new Date(lastSyncAt).getTime() / 1000) });
    }

    const stripeCustomers = await stripePaginateAll('/customers', apiKey, params);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const stripeCust of stripeCustomers) {
      try {
        const mapped = this.mapStripeCustomer(stripeCust);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: stripeCust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: stripeCustomers.length, created, errors: errors.length },
      'Stripe customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getSecretKey();
    const params: Record<string, string> = {};

    if (lastSyncAt) {
      params.created = JSON.stringify({ gte: Math.floor(new Date(lastSyncAt).getTime() / 1000) });
    }

    const stripeInvoices = await stripePaginateAll('/invoices', apiKey, params);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const stripeInv of stripeInvoices) {
      try {
        const mapped = this.mapStripeInvoice(stripeInv);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: stripeInv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: stripeInvoices.length, created, errors: errors.length },
      'Stripe invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Stripe ─────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getSecretKey();

    // Step 1: Create the invoice
    const invoiceParams: Record<string, string> = {};
    if (invoiceData.customer_external_id) {
      invoiceParams.customer = String(invoiceData.customer_external_id);
    }
    if (invoiceData.description) {
      invoiceParams.description = String(invoiceData.description);
    }
    if (invoiceData.due_date) {
      invoiceParams.due_date = String(
        Math.floor(new Date(invoiceData.due_date as string).getTime() / 1000),
      );
    }
    if (invoiceData.currency) {
      invoiceParams.currency = String(invoiceData.currency);
    }
    invoiceParams.auto_advance = 'false'; // Don't auto-finalize

    const createResponse = await stripeFetch('/invoices', apiKey, {
      method: 'POST',
      params: invoiceParams,
    });
    const invoice = (await createResponse.json()) as Record<string, unknown>;
    const invoiceId = invoice.id as string;

    // Step 2: Add line items
    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];
    for (const item of lineItems) {
      const lineParams: Record<string, string> = {
        invoice: invoiceId,
        quantity: String(item.quantity ?? 1),
        // Stripe amounts are in cents
        'price_data[currency]': String(invoiceData.currency ?? 'usd'),
        'price_data[unit_amount]': String(
          Math.round((item.unit_price as number) * 100),
        ),
        'price_data[product_data][name]': String(item.description ?? 'Line item'),
      };

      await stripeFetch('/invoiceitems', apiKey, {
        method: 'POST',
        params: lineParams,
      });
    }

    // Step 3: Finalize the invoice
    await stripeFetch(`/invoices/${invoiceId}/finalize`, apiKey, {
      method: 'POST',
    });

    return {
      provider: this.provider,
      external_id: invoiceId,
    };
  }

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getSecretKey();

    const params: Record<string, string> = {
      // Stripe amounts are in cents
      amount: String(Math.round((paymentData.amount as number) * 100)),
      currency: String(paymentData.currency ?? 'usd'),
    };

    if (paymentData.customer_external_id) {
      params.customer = String(paymentData.customer_external_id);
    }
    if (paymentData.payment_method) {
      params.payment_method = String(paymentData.payment_method);
      params.confirm = 'true';
    }
    if (paymentData.description) {
      params.description = String(paymentData.description);
    }
    if (paymentData.metadata) {
      const meta = paymentData.metadata as Record<string, string>;
      for (const [key, value] of Object.entries(meta)) {
        params[`metadata[${key}]`] = String(value);
      }
    }

    const response = await stripeFetch('/payment_intents', apiKey, {
      method: 'POST',
      params,
    });
    const paymentIntent = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: paymentIntent.id as string,
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    let webhookSecret: string;
    try {
      webhookSecret = getWebhookSecret();
    } catch {
      logger.warn('No Stripe webhook secret configured');
      return false;
    }

    // Parse the Stripe signature header: t=timestamp,v1=signature[,v1=signature...]
    const elements = signature.split(',');
    const timestampElement = elements.find((e) => e.startsWith('t='));
    const signatureElements = elements.filter((e) => e.startsWith('v1='));

    if (!timestampElement || signatureElements.length === 0) {
      logger.warn('Invalid Stripe webhook signature format');
      return false;
    }

    const timestamp = timestampElement.slice(2);
    const timestampNum = parseInt(timestamp, 10);

    // Check timestamp tolerance
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNum) > WEBHOOK_TOLERANCE_SECONDS) {
      logger.warn({ timestamp, now }, 'Stripe webhook timestamp out of tolerance');
      return false;
    }

    // Compute expected signature: HMAC-SHA256(secret, "timestamp.payload")
    const signedPayload = `${timestamp}.${payload.toString('utf8')}`;
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    // Compare against all v1 signatures (Stripe may send multiple)
    return signatureElements.some((sig) => {
      const sigValue = sig.slice(3); // Remove "v1=" prefix
      try {
        return timingSafeEqual(
          Buffer.from(expectedSignature, 'hex'),
          Buffer.from(sigValue, 'hex'),
        );
      } catch {
        return false;
      }
    });
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Stripe event structure: { id, type, data: { object: {...} } }
    const eventType = (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;
    const object = data?.object as Record<string, unknown> | undefined;

    // Derive resource type from event type (e.g., "invoice.paid" -> "invoice")
    const resourceType = eventType.split('.')[0] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (object?.id as string) ?? undefined,
      data: payload,
      timestamp: payload.created
        ? new Date((payload.created as number) * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Stripe Customer object to CrewShift's unified customer format.
   */
  private mapStripeCustomer(stripeCust: Record<string, unknown>): Record<string, unknown> {
    const address = stripeCust.address as Record<string, unknown> | null;

    return {
      name: (stripeCust.name as string) ?? null,
      company_name: null, // Stripe doesn't have a separate company field
      email: (stripeCust.email as string) ?? null,
      phone: (stripeCust.phone as string) ?? null,
      address: address
        ? {
            street: [address.line1, address.line2].filter(Boolean).join(', '),
            city: (address.city as string) ?? '',
            state: (address.state as string) ?? '',
            zip: (address.postal_code as string) ?? '',
            country: (address.country as string) ?? '',
          }
        : null,
      external_ids: { stripe: String(stripeCust.id) },
      source: 'stripe',
      metadata: {
        stripe_currency: stripeCust.currency,
        stripe_delinquent: stripeCust.delinquent,
        stripe_balance: stripeCust.balance,
        stripe_created: stripeCust.created,
        stripe_livemode: stripeCust.livemode,
      },
    };
  }

  /**
   * Map a Stripe Invoice object to CrewShift's unified invoice format.
   */
  private mapStripeInvoice(stripeInv: Record<string, unknown>): Record<string, unknown> {
    const lines = stripeInv.lines as Record<string, unknown> | undefined;
    const lineData = (lines?.data as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: (stripeInv.number as string) ?? null,
      status: this.mapStripeInvoiceStatus(stripeInv),
      // Stripe amounts are in cents — convert to dollars
      amount: ((stripeInv.total as number) ?? 0) / 100,
      balance_due: ((stripeInv.amount_remaining as number) ?? 0) / 100,
      due_date: stripeInv.due_date
        ? new Date((stripeInv.due_date as number) * 1000).toISOString()
        : null,
      issued_date: stripeInv.created
        ? new Date((stripeInv.created as number) * 1000).toISOString()
        : null,
      customer_external_id: (stripeInv.customer as string) ?? null,
      external_ids: { stripe: String(stripeInv.id) },
      line_items: lineData.map((line) => ({
        description: (line.description as string) ?? '',
        quantity: (line.quantity as number) ?? 1,
        unit_price: ((line.unit_amount as number) ?? 0) / 100,
        total: ((line.amount as number) ?? 0) / 100,
      })),
      source: 'stripe',
      metadata: {
        stripe_hosted_invoice_url: stripeInv.hosted_invoice_url,
        stripe_pdf: stripeInv.invoice_pdf,
        stripe_subscription: stripeInv.subscription,
        stripe_currency: stripeInv.currency,
        stripe_livemode: stripeInv.livemode,
      },
    };
  }

  /**
   * Map Stripe invoice status to CrewShift status.
   */
  private mapStripeInvoiceStatus(stripeInv: Record<string, unknown>): string {
    const status = stripeInv.status as string;
    switch (status) {
      case 'paid':
        return 'paid';
      case 'open':
        // Check if overdue
        if (stripeInv.due_date) {
          const dueTimestamp = (stripeInv.due_date as number) * 1000;
          if (dueTimestamp < Date.now()) return 'overdue';
        }
        return 'sent';
      case 'draft':
        return 'draft';
      case 'void':
        return 'void';
      case 'uncollectible':
        return 'uncollectible';
      default:
        return status ?? 'unknown';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const stripeAdapter = new StripeAdapter();
registerAdapter(stripeAdapter);
export default stripeAdapter;
