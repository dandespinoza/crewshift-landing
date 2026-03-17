/**
 * Helcim Integration Adapter
 *
 * Native (Tier 1) adapter for Helcim.
 * Handles API token auth, customer/invoice sync, payment creation, and webhooks.
 *
 * Helcim API Reference:
 * - API Docs: https://devdocs.helcim.com/reference
 * - Customers: https://devdocs.helcim.com/reference/list-customers
 * - Invoices: https://devdocs.helcim.com/reference/list-invoices
 * - Payments: https://devdocs.helcim.com/reference/process-purchase-transaction
 *
 * Key details:
 * - Auth via API token in X-Api-Token header (no OAuth)
 * - REST API at https://api.helcim.com/v2
 * - Pagination via page/pageSize query parameters
 * - Amounts in cents (integer)
 * - Webhook verification via HMAC signature
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

const API_BASE = 'https://api.helcim.com/v2';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = process.env.HELCIM_API_TOKEN ?? env.HELCIM_API_TOKEN;
  if (!token) {
    throw new Error('HELCIM_API_TOKEN is not configured');
  }
  return token;
}

/**
 * Make an authenticated request to the Helcim API.
 */
async function helcimFetch(
  path: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Api-Token': apiToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Helcim API error',
    );
    throw new Error(`Helcim API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Helcim list endpoint.
 */
async function helcimPaginateAll(
  path: string,
  apiToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`;

    const response = await helcimFetch(paginatedPath, apiToken);
    const data = (await response.json()) as Record<string, unknown>[] | Record<string, unknown>;

    // Helcim returns an array directly for list endpoints
    const items = Array.isArray(data) ? data : ((data as Record<string, unknown>).data as Record<string, unknown>[]) ?? [];

    if (items.length === 0) {
      hasMore = false;
    } else {
      results.push(...items);
      if (items.length < DEFAULT_PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class HelcimAdapter extends BaseAdapter {
  readonly provider = 'helcim' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API token auth) ────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Helcim uses API token authentication, not OAuth. Configure HELCIM_API_TOKEN instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Helcim uses API token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Helcim uses API token authentication. Tokens do not expire or require refresh.');
  }

  // ── Sync: Helcim → CrewShift ───────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiToken = accessToken || getApiToken();

    const helcimCustomers = await helcimPaginateAll('/customers', apiToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const hCust of helcimCustomers) {
      try {
        const mapped = this.mapHelcimCustomer(hCust);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: hCust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: helcimCustomers.length, created, errors: errors.length },
      'Helcim customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiToken = accessToken || getApiToken();

    const helcimInvoices = await helcimPaginateAll('/invoices', apiToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const hInv of helcimInvoices) {
      try {
        const mapped = this.mapHelcimInvoice(hInv);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: hInv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: helcimInvoices.length, created, errors: errors.length },
      'Helcim invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Helcim ─────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiToken = accessToken || getApiToken();

    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];

    const helcimInvoice: Record<string, unknown> = {
      customerId: invoiceData.customer_external_id ?? undefined,
      invoiceNumber: invoiceData.invoice_number ?? undefined,
      tipAmount: 0,
      depositAmount: 0,
      currency: (invoiceData.currency as string)?.toUpperCase() ?? 'CAD',
      lineItems: lineItems.map((item) => ({
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        price: item.unit_price ?? 0,
        total: (item.quantity as number ?? 1) * (item.unit_price as number ?? 0),
        sku: item.sku ?? undefined,
      })),
    };

    const response = await helcimFetch('/invoices', apiToken, {
      method: 'POST',
      body: JSON.stringify(helcimInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.invoiceId ?? result.id),
    };
  }

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiToken = accessToken || getApiToken();

    const helcimPayment: Record<string, unknown> = {
      amount: paymentData.amount,
      currency: (paymentData.currency as string)?.toUpperCase() ?? 'CAD',
      customerId: paymentData.customer_external_id ?? undefined,
      invoiceId: paymentData.invoice_external_id ?? undefined,
      cardToken: paymentData.card_token ?? undefined,
      ipAddress: paymentData.ip_address ?? '0.0.0.0',
      ecommerce: true,
    };

    const response = await helcimFetch('/payment/purchase', apiToken, {
      method: 'POST',
      body: JSON.stringify(helcimPayment),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.transactionId ?? result.id),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const apiToken = process.env.HELCIM_API_TOKEN ?? env.HELCIM_API_TOKEN;
    if (!apiToken) {
      logger.warn('No Helcim API token configured for webhook verification');
      return false;
    }

    // Helcim webhook verification: HMAC-SHA256 of the payload body
    const expectedSignature = createHmac('sha256', apiToken)
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
    // Helcim webhook structure: { event, data: { ... } }
    const eventType = (payload.event as string) ?? (payload.eventName as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? payload;

    // Derive resource type from event (e.g., "transaction.completed" -> "transaction")
    const resourceType = eventType.split('.')[0] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (data.id as string) ?? (data.transactionId as string) ?? undefined,
      data: payload,
      timestamp: (data.dateCreated as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Helcim Customer to CrewShift's unified customer format.
   */
  private mapHelcimCustomer(hCust: Record<string, unknown>): Record<string, unknown> {
    return {
      name: [hCust.firstName, hCust.lastName].filter(Boolean).join(' ') || null,
      company_name: (hCust.businessName as string) ?? (hCust.companyName as string) ?? null,
      email: (hCust.email as string) ?? null,
      phone: (hCust.phone as string) ?? (hCust.cellPhone as string) ?? null,
      address: hCust.streetAddress
        ? {
            street: (hCust.streetAddress as string) ?? '',
            city: (hCust.city as string) ?? '',
            state: (hCust.province as string) ?? '',
            zip: (hCust.postalCode as string) ?? '',
            country: (hCust.country as string) ?? '',
          }
        : null,
      external_ids: {
        helcim: String(hCust.customerId ?? hCust.id),
      },
      source: 'helcim',
      metadata: {
        helcim_customer_code: hCust.customerCode,
        helcim_date_created: hCust.dateCreated,
        helcim_date_updated: hCust.dateUpdated,
      },
    };
  }

  /**
   * Map a Helcim Invoice to CrewShift's unified invoice format.
   */
  private mapHelcimInvoice(hInv: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (hInv.lineItems as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: (hInv.invoiceNumber as string) ?? null,
      status: this.mapHelcimInvoiceStatus(hInv),
      amount: (hInv.amount as number) ?? (hInv.total as number) ?? 0,
      balance_due: (hInv.amountDue as number) ?? (hInv.balanceDue as number) ?? 0,
      due_date: (hInv.dateDue as string) ?? null,
      issued_date: (hInv.dateIssued as string) ?? (hInv.dateCreated as string) ?? null,
      customer_external_id: hInv.customerId ? String(hInv.customerId) : null,
      external_ids: {
        helcim: String(hInv.invoiceId ?? hInv.id),
      },
      line_items: lineItems.map((item) => ({
        description: (item.description as string) ?? '',
        quantity: (item.quantity as number) ?? 1,
        unit_price: (item.price as number) ?? (item.unitPrice as number) ?? 0,
        total: (item.total as number) ?? 0,
      })),
      source: 'helcim',
      metadata: {
        helcim_status: hInv.status,
        helcim_date_created: hInv.dateCreated,
        helcim_date_updated: hInv.dateUpdated,
        helcim_currency: hInv.currency,
      },
    };
  }

  /**
   * Map Helcim invoice status to CrewShift status.
   */
  private mapHelcimInvoiceStatus(hInv: Record<string, unknown>): string {
    const status = (hInv.status as string) ?? '';
    switch (status.toLowerCase()) {
      case 'paid':
        return 'paid';
      case 'partial':
      case 'partially_paid':
        return 'partial';
      case 'due':
      case 'sent':
        return 'sent';
      case 'overdue':
        return 'overdue';
      case 'draft':
        return 'draft';
      case 'void':
      case 'cancelled':
        return 'void';
      default:
        return status.toLowerCase() || 'unknown';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const helcimAdapter = new HelcimAdapter();
registerAdapter(helcimAdapter);
export default helcimAdapter;
