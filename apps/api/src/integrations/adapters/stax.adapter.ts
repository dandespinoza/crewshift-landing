/**
 * Stax (Fattmerchant) Integration Adapter
 *
 * Native (Tier 1) adapter for Stax by Fattmerchant.
 * Handles Bearer token auth, customer/invoice sync, payment creation, and webhooks.
 *
 * Stax API Reference:
 * - API Docs: https://docs.staxpayments.com/
 * - Customers: https://docs.staxpayments.com/#tag/Customers
 * - Invoices: https://docs.staxpayments.com/#tag/Invoices
 * - Charges: https://docs.staxpayments.com/#tag/Charges
 *
 * Key details:
 * - Auth via Bearer API key (no OAuth)
 * - API Base: https://apiprod.fattlabs.com
 * - Pagination via page query parameter
 * - Amounts in dollars (decimal, e.g., 10.50)
 * - Webhook verification via signature header
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

const API_BASE = 'https://apiprod.fattlabs.com';
const DEFAULT_PAGE_SIZE = 25;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.STAX_API_KEY ?? env.STAX_API_KEY;
  if (!key) {
    throw new Error('STAX_API_KEY is not configured');
  }
  return key;
}

/**
 * Make an authenticated request to the Stax API.
 */
async function staxFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Stax API error',
    );
    throw new Error(`Stax API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Stax list endpoint.
 * Stax uses Laravel-style pagination: { data: [...], current_page, last_page, total, per_page }
 */
async function staxPaginateAll(
  path: string,
  apiKey: string,
  extraParams: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let lastPage = 1;

  while (page <= lastPage) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(DEFAULT_PAGE_SIZE),
      ...extraParams,
    });
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}${params.toString()}`;

    const response = await staxFetch(paginatedPath, apiKey);
    const data = (await response.json()) as Record<string, unknown>;

    // Stax returns paginated envelope or direct array depending on endpoint
    const items = (data.data as Record<string, unknown>[]) ?? [];
    results.push(...items);

    lastPage = (data.last_page as number) ?? 1;
    page++;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class StaxAdapter extends BaseAdapter {
  readonly provider = 'stax' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — Bearer token auth) ─────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Stax uses Bearer token authentication, not OAuth. Configure STAX_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Stax uses Bearer token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Stax uses Bearer token authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Stax → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const staxCustomers = await staxPaginateAll('/customer', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const sCust of staxCustomers) {
      try {
        const mapped = this.mapStaxCustomer(sCust);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: sCust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: staxCustomers.length, created, errors: errors.length },
      'Stax customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const staxInvoices = await staxPaginateAll('/invoice', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const sInv of staxInvoices) {
      try {
        const mapped = this.mapStaxInvoice(sInv);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: sInv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: staxInvoices.length, created, errors: errors.length },
      'Stax invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Stax ───────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getApiKey();

    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];

    const staxInvoice: Record<string, unknown> = {
      customer_id: invoiceData.customer_external_id ?? undefined,
      meta: {
        invoice_number: invoiceData.invoice_number ?? undefined,
        subtotal: invoiceData.subtotal ?? undefined,
        tax: invoiceData.tax ?? 0,
        lineItems: lineItems.map((item) => ({
          item: item.description ?? '',
          details: item.details ?? '',
          quantity: item.quantity ?? 1,
          price: item.unit_price ?? 0,
        })),
      },
      total: invoiceData.amount ?? 0,
      url: invoiceData.payment_url ?? '',
      send_now: invoiceData.send_now ?? false,
    };

    if (invoiceData.due_date) {
      staxInvoice.due_at = invoiceData.due_date;
    }

    const response = await staxFetch('/invoice', apiKey, {
      method: 'POST',
      body: JSON.stringify(staxInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.id),
    };
  }

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getApiKey();

    const staxCharge: Record<string, unknown> = {
      payment_method_id: paymentData.payment_method_id,
      total: paymentData.amount,
      meta: {
        reference: paymentData.reference ?? undefined,
        memo: paymentData.description ?? undefined,
        otherField1: paymentData.order_id ?? undefined,
        subtotal: paymentData.amount,
        tax: paymentData.tax ?? 0,
      },
      pre_auth: paymentData.pre_auth ?? false,
    };

    if (paymentData.invoice_external_id) {
      staxCharge.invoice_id = paymentData.invoice_external_id;
    }
    if (paymentData.customer_external_id) {
      staxCharge.customer_id = paymentData.customer_external_id;
    }

    const response = await staxFetch('/charge', apiKey, {
      method: 'POST',
      body: JSON.stringify(staxCharge),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.id),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const apiKey = process.env.STAX_API_KEY ?? env.STAX_API_KEY;
    if (!apiKey) {
      logger.warn('No Stax API key configured for webhook verification');
      return false;
    }

    // Stax webhook signature verification: HMAC-SHA256 of the raw body
    const expectedSignature = createHmac('sha256', apiKey)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Stax webhook structure: { type, data: { id, ... }, id (event id), created_at }
    const eventType = (payload.type as string) ?? (payload.event as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? payload;

    // Derive resource type from event type (e.g., "transaction.completed" -> "transaction")
    const resourceType = eventType.split('.')[0] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (data.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.created_at as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Stax Customer to CrewShift's unified customer format.
   */
  private mapStaxCustomer(sCust: Record<string, unknown>): Record<string, unknown> {
    return {
      name: [sCust.firstname, sCust.lastname].filter(Boolean).join(' ') ||
        (sCust.company as string) ||
        null,
      company_name: (sCust.company as string) ?? null,
      email: (sCust.email as string) ?? null,
      phone: (sCust.phone as string) ?? null,
      address: sCust.address_1
        ? {
            street: [sCust.address_1, sCust.address_2].filter(Boolean).join(', '),
            city: (sCust.address_city as string) ?? '',
            state: (sCust.address_state as string) ?? '',
            zip: (sCust.address_zip as string) ?? '',
            country: (sCust.address_country as string) ?? '',
          }
        : null,
      external_ids: {
        stax: String(sCust.id),
      },
      source: 'stax',
      metadata: {
        stax_reference: sCust.reference,
        stax_notes: sCust.notes,
        stax_cc_emails: sCust.cc_emails,
        stax_created_at: sCust.created_at,
        stax_updated_at: sCust.updated_at,
        stax_allow_invoice_credit_card_payments: sCust.allow_invoice_credit_card_payments,
      },
    };
  }

  /**
   * Map a Stax Invoice to CrewShift's unified invoice format.
   */
  private mapStaxInvoice(sInv: Record<string, unknown>): Record<string, unknown> {
    const meta = (sInv.meta as Record<string, unknown>) ?? {};
    const lineItems = (meta.lineItems as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: (meta.invoice_number as string) ?? (sInv.id as string) ?? null,
      status: this.mapStaxInvoiceStatus(sInv),
      amount: (sInv.total as number) ?? 0,
      balance_due: (sInv.balance_due as number) ?? (sInv.total as number) ?? 0,
      due_date: (sInv.due_at as string) ?? null,
      issued_date: (sInv.created_at as string) ?? null,
      customer_external_id: sInv.customer_id ? String(sInv.customer_id) : null,
      external_ids: {
        stax: String(sInv.id),
      },
      line_items: lineItems.map((item) => ({
        description: (item.item as string) ?? (item.details as string) ?? '',
        quantity: (item.quantity as number) ?? 1,
        unit_price: (item.price as number) ?? 0,
        total: ((item.quantity as number) ?? 1) * ((item.price as number) ?? 0),
      })),
      source: 'stax',
      metadata: {
        stax_payment_url: sInv.url,
        stax_is_paid: sInv.is_paid,
        stax_payment_attempt_failed: sInv.payment_attempt_failed,
        stax_viewed_at: sInv.viewed_at,
        stax_sent_at: sInv.sent_at,
        stax_paid_at: sInv.paid_at,
        stax_schedule_id: sInv.schedule_id,
      },
    };
  }

  /**
   * Map Stax invoice status to CrewShift status.
   */
  private mapStaxInvoiceStatus(sInv: Record<string, unknown>): string {
    if (sInv.is_paid) return 'paid';

    const status = (sInv.status as string) ?? '';
    switch (status.toLowerCase()) {
      case 'paid':
        return 'paid';
      case 'sent':
        // Check if overdue
        if (sInv.due_at) {
          const dueDate = new Date(sInv.due_at as string);
          if (dueDate < new Date()) return 'overdue';
        }
        return 'sent';
      case 'draft':
        return 'draft';
      case 'partial':
      case 'partially_paid':
        return 'partial';
      case 'voided':
      case 'cancelled':
        return 'void';
      default:
        // Fallback: check if paid_at is set
        if (sInv.paid_at) return 'paid';
        if (sInv.sent_at) return 'sent';
        return 'draft';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const staxAdapter = new StaxAdapter();
registerAdapter(staxAdapter);
export default staxAdapter;
