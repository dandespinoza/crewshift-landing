/**
 * Zuper Integration Adapter
 *
 * Native (Tier 2) adapter for Zuper field service management.
 * Handles API key auth, customer/job/invoice sync via REST API, and webhooks.
 *
 * Zuper API Reference:
 * - REST: https://docs.zuper.co/
 *
 * Key details:
 * - API Key authentication via x-api-key header
 * - No OAuth flow -- uses static API key
 * - REST API v1 with page/count pagination
 * - Webhook verification: API key verification
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

// -- Constants ----------------------------------------------------------------

const ZUPER_API_BASE = 'https://api.zuper.co/api/v1';
const ZUPER_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the Zuper API using API key.
 */
async function zuperFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${ZUPER_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Zuper API error',
    );
    throw new Error(`Zuper API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Zuper collection using page/count params.
 */
async function zuperFetchAll(
  path: string,
  apiKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}page=${page}&count=${ZUPER_PAGE_SIZE}`;
    const response = await zuperFetch(paginatedPath, apiKey);
    const body = (await response.json()) as Record<string, unknown>;

    // Zuper typically wraps data in a "data" property
    const data = (body.data as Record<string, unknown>[]) ?? [];
    const items = Array.isArray(data) ? data : [];

    if (items.length === 0) {
      hasMore = false;
    } else {
      results.push(...items);
      page++;
      if (items.length < ZUPER_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class ZuperAdapter extends BaseAdapter {
  readonly provider = 'zuper' as const;
  readonly tier = 'native' as const;

  // -- OAuth (not applicable -- API key auth) ---------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Zuper uses API key authentication -- no OAuth flow required');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Zuper uses API key authentication -- no OAuth callback');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Zuper uses API key authentication -- no token refresh');
  }

  // -- Sync: Zuper -> CrewShift -----------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.ZUPER_API_KEY || '';
    const rawCustomers = await zuperFetchAll('/customers', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const customer of rawCustomers) {
      try {
        records.push(this.mapCustomer(customer));
        created++;
      } catch (err) {
        errors.push({ item: customer, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: rawCustomers.length, created, errors: errors.length },
      'Zuper customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.ZUPER_API_KEY || '';
    const rawJobs = await zuperFetchAll('/jobs', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const job of rawJobs) {
      try {
        records.push(this.mapJob(job));
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: rawJobs.length, created, errors: errors.length },
      'Zuper job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.ZUPER_API_KEY || '';
    const rawInvoices = await zuperFetchAll('/invoices', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const invoice of rawInvoices) {
      try {
        records.push(this.mapInvoice(invoice));
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: rawInvoices.length, created, errors: errors.length },
      'Zuper invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> Zuper -----------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || env.ZUPER_API_KEY || '';

    const zuperInvoice = {
      customer_uid: invoiceData.customer_external_id ?? null,
      job_uid: invoiceData.job_external_id ?? null,
      due_date: invoiceData.due_date ?? null,
      invoice_number: invoiceData.invoice_number ?? null,
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? 0,
      })) ?? [],
    };

    const response = await zuperFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(zuperInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const data = result.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      external_id: String(data?.uid ?? data?.id ?? result.uid ?? ''),
    };
  }

  // -- Webhooks ---------------------------------------------------------------

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const apiKey = env.ZUPER_API_KEY;
    if (!apiKey) {
      logger.warn('No Zuper API key configured for webhook verification');
      return false;
    }

    // Zuper uses API key verification for webhooks
    const hash = createHmac('sha256', apiKey)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Zuper webhook payload: { event, data: { ... } }
    const eventName = payload.event as string | undefined;
    const data = payload.data as Record<string, unknown> | undefined;

    // Event names are like "job.created", "customer.updated", etc.
    const parts = (eventName ?? 'unknown.unknown').split('.');
    const resourceType = parts[0] ?? 'unknown';
    const eventType = parts[1] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.uid ? String(data.uid) : undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  private mapCustomer(customer: Record<string, unknown>): Record<string, unknown> {
    const address = customer.address as Record<string, unknown> | undefined;

    return {
      name: customer.customer_name
        ?? `${customer.customer_first_name ?? ''} ${customer.customer_last_name ?? ''}`.trim(),
      company_name: customer.customer_company_name ?? null,
      email: customer.customer_email ?? null,
      phone: customer.customer_phone ?? null,
      address: address
        ? {
            street: address.street ?? '',
            city: address.city ?? '',
            state: address.state ?? '',
            zip: address.zip_code ?? address.postal_code ?? '',
            country: address.country ?? '',
          }
        : null,
      external_ids: { zuper: String(customer.customer_uid ?? customer.uid) },
      source: 'zuper',
      metadata: {
        zuper_status: customer.status,
        zuper_created_at: customer.created_at,
        zuper_updated_at: customer.updated_at,
      },
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    const customer = job.customer as Record<string, unknown> | undefined;
    const address = job.job_address as Record<string, unknown> | undefined;

    return {
      title: job.job_title ?? job.job_description ?? '',
      job_number: job.job_uid ?? null,
      status: (job.job_status as string)?.toLowerCase() ?? 'unknown',
      start_at: job.scheduled_start_time ?? job.start_date ?? null,
      end_at: job.scheduled_end_time ?? job.end_date ?? null,
      total: job.total_amount ?? 0,
      customer_external_id: customer?.customer_uid
        ? String(customer.customer_uid)
        : null,
      address: address
        ? {
            street: address.street ?? '',
            city: address.city ?? '',
            state: address.state ?? '',
            zip: address.zip_code ?? '',
          }
        : null,
      external_ids: { zuper: String(job.job_uid ?? job.uid) },
      source: 'zuper',
      metadata: {
        zuper_status: job.job_status,
        zuper_priority: job.job_priority,
        zuper_category: job.job_category,
      },
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const customer = invoice.customer as Record<string, unknown> | undefined;
    const lineItems = (invoice.line_items as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: invoice.invoice_number ?? null,
      status: (invoice.invoice_status as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.total_amount ?? 0,
      balance_due: invoice.balance_due ?? invoice.total_amount ?? 0,
      due_date: invoice.due_date ?? null,
      issued_date: invoice.invoice_date ?? null,
      customer_external_id: customer?.customer_uid
        ? String(customer.customer_uid)
        : null,
      line_items: lineItems.map((li) => ({
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unit_price: li.unit_price ?? 0,
        total: li.total ?? 0,
      })),
      external_ids: { zuper: String(invoice.invoice_uid ?? invoice.uid) },
      source: 'zuper',
      metadata: {
        zuper_status: invoice.invoice_status,
        zuper_created_at: invoice.created_at,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new ZuperAdapter();
registerAdapter(adapter);
export default adapter;
