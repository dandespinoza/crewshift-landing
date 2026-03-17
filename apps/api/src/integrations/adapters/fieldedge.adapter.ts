/**
 * FieldEdge Integration Adapter
 *
 * Tier 3 (native) adapter for FieldEdge — field service management software.
 * Handles Bearer token + Azure APIM subscription key auth, customer/job/invoice sync.
 *
 * FieldEdge API Reference:
 * - API Base: https://api.fieldedge.com/v1
 * - Auth: Bearer token + Ocp-Apim-Subscription-Key header (Azure API Management)
 *
 * Key details:
 * - Developer application approval required
 * - No OAuth flow — Bearer token + Azure APIM subscription key
 * - Dual-header auth: Authorization Bearer + Ocp-Apim-Subscription-Key
 * - syncCustomers: GET /customers with pagination
 * - syncJobs: GET /workorders with pagination
 * - syncInvoices: GET /invoices with pagination
 * - createInvoice: POST /invoices
 * - No webhook support
 * - Env: FIELDEDGE_API_KEY, FIELDEDGE_SUBSCRIPTION_KEY
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

const API_BASE = 'https://api.fieldedge.com/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.FIELDEDGE_API_KEY ?? (env as Record<string, unknown>).FIELDEDGE_API_KEY as string | undefined;
  if (!key) throw new Error('FIELDEDGE_API_KEY is not configured');
  return key;
}

function getSubscriptionKey(): string {
  const key = process.env.FIELDEDGE_SUBSCRIPTION_KEY ?? (env as Record<string, unknown>).FIELDEDGE_SUBSCRIPTION_KEY as string | undefined;
  if (!key) throw new Error('FIELDEDGE_SUBSCRIPTION_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the FieldEdge API.
 * Requires both Bearer token and Azure APIM Subscription Key.
 */
async function fieldedgeFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const subscriptionKey = getSubscriptionKey();

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'FieldEdge API error',
    );
    throw new Error(`FieldEdge API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through FieldEdge list endpoints using offset-based pagination.
 */
async function fieldedgePaginateAll(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const searchParams = new URLSearchParams({
      pageSize: String(DEFAULT_PAGE_SIZE),
      page: String(page),
      ...params,
    });

    const response = await fieldedgeFetch(
      `${path}?${searchParams.toString()}`,
      apiKey,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? (data.items as Record<string, unknown>[]) ?? [];

    results.push(...items);

    const totalPages = data.totalPages as number | undefined;
    hasMore = totalPages ? page < totalPages : items.length === DEFAULT_PAGE_SIZE;
    page++;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class FieldEdgeAdapter extends BaseAdapter {
  readonly provider = 'fieldedge' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — Bearer token + APIM key auth) ──────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('FieldEdge uses Bearer token + APIM key auth, not OAuth. Configure FIELDEDGE_API_KEY and FIELDEDGE_SUBSCRIPTION_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('FieldEdge uses Bearer token + APIM key auth, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('FieldEdge uses Bearer token + APIM key auth. Tokens do not expire through OAuth refresh.');
  }

  // ── Sync: FieldEdge → CrewShift ────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const customers = await fieldedgePaginateAll('/customers', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const customer of customers) {
      try {
        const mapped = this.mapCustomer(customer);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: customer, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'FieldEdge customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const workorders = await fieldedgePaginateAll('/workorders', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const workorder of workorders) {
      try {
        const mapped = this.mapWorkOrder(workorder);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: workorder, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: workorders.length, created, errors: errors.length },
      'FieldEdge workorder sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const invoices = await fieldedgePaginateAll('/invoices', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of invoices) {
      try {
        const mapped = this.mapInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'FieldEdge invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → FieldEdge ──────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getApiKey();

    const fieldedgeInvoice = {
      customerId: invoiceData.customer_external_id,
      workOrderId: invoiceData.job_external_id,
      lineItems: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.total,
      })) ?? [],
      dueDate: invoiceData.due_date,
      notes: invoiceData.notes,
    };

    const response = await fieldedgeFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(fieldedgeInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const invoice = (result.data as Record<string, unknown>) ?? result;

    return {
      provider: this.provider,
      external_id: String(invoice.id ?? invoice.invoiceId),
    };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class no-op implementations are sufficient — FieldEdge does not support webhooks.

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a FieldEdge Customer to CrewShift's unified customer format.
   */
  private mapCustomer(customer: Record<string, unknown>): Record<string, unknown> {
    const address = customer.address as Record<string, unknown> | undefined;

    return {
      name: (`${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || (customer.name as string)) ?? null,
      company_name: (customer.companyName as string) ?? null,
      email: (customer.email as string) ?? null,
      phone: (customer.phone as string) ?? (customer.phoneNumber as string) ?? null,
      address: address
        ? {
            street: (address.street as string) ?? (address.line1 as string) ?? '',
            city: (address.city as string) ?? '',
            state: (address.state as string) ?? '',
            zip: (address.zip as string) ?? (address.postalCode as string) ?? '',
          }
        : null,
      external_ids: { fieldedge: String(customer.id ?? customer.customerId) },
      source: 'fieldedge',
      metadata: {
        fieldedge_type: customer.type ?? customer.customerType,
        fieldedge_status: customer.status,
        fieldedge_created: customer.createdDate,
        fieldedge_modified: customer.modifiedDate,
      },
    };
  }

  /**
   * Map a FieldEdge Work Order to CrewShift's unified job format.
   */
  private mapWorkOrder(workorder: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (workorder.summary as string) ?? (workorder.description as string) ?? null,
      description: (workorder.description as string) ?? null,
      status: (workorder.status as string) ?? 'unknown',
      scheduled_start: (workorder.scheduledStart as string) ?? (workorder.startDate as string) ?? null,
      scheduled_end: (workorder.scheduledEnd as string) ?? (workorder.endDate as string) ?? null,
      customer_external_id: workorder.customerId ? String(workorder.customerId) : null,
      external_ids: { fieldedge: String(workorder.id ?? workorder.workOrderId) },
      source: 'fieldedge',
      metadata: {
        fieldedge_type: workorder.type ?? workorder.workOrderType,
        fieldedge_priority: workorder.priority,
        fieldedge_technician_id: workorder.technicianId,
        fieldedge_created: workorder.createdDate,
        fieldedge_modified: workorder.modifiedDate,
      },
    };
  }

  /**
   * Map a FieldEdge Invoice to CrewShift's unified invoice format.
   */
  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (invoice.lineItems as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: (invoice.invoiceNumber as string) ?? String(invoice.id),
      status: (invoice.status as string) ?? 'unknown',
      amount: (invoice.total as number) ?? (invoice.amount as number) ?? 0,
      balance_due: (invoice.balance as number) ?? (invoice.balanceDue as number) ?? 0,
      due_date: (invoice.dueDate as string) ?? null,
      issued_date: (invoice.invoiceDate as string) ?? (invoice.createdDate as string) ?? null,
      customer_external_id: invoice.customerId ? String(invoice.customerId) : null,
      external_ids: { fieldedge: String(invoice.id ?? invoice.invoiceId) },
      line_items: lineItems.map((item) => ({
        description: (item.description as string) ?? '',
        quantity: (item.quantity as number) ?? 1,
        unit_price: (item.unitPrice as number) ?? 0,
        total: (item.total as number) ?? 0,
      })),
      source: 'fieldedge',
      metadata: {
        fieldedge_work_order_id: invoice.workOrderId,
        fieldedge_created: invoice.createdDate,
        fieldedge_modified: invoice.modifiedDate,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new FieldEdgeAdapter();
registerAdapter(adapter);
export default adapter;
