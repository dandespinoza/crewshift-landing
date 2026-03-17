/**
 * Service Fusion Integration Adapter
 *
 * Native (Tier 1) adapter for Service Fusion field-service management.
 * Handles API key auth, customer/job/invoice sync, invoice creation, and webhooks.
 *
 * Service Fusion API Reference:
 * - API: https://api.servicefusion.com/v1
 *
 * Key details:
 * - Auth via API key in Authorization header
 * - Pagination via standard query params
 * - PRO plan required for API access
 * - Webhook verification via API key matching
 */

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

const API_BASE = 'https://api.servicefusion.com/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.SERVICE_FUSION_API_KEY ?? env.SERVICE_FUSION_API_KEY;
  if (!key) throw new Error('SERVICE_FUSION_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the Service Fusion API.
 */
async function sfFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Service Fusion API error',
    );
    throw new Error(`Service Fusion API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Service Fusion list endpoint.
 */
async function sfFetchAllPages(
  path: string,
  apiKey: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&per_page=${DEFAULT_PAGE_SIZE}`;

    const response = await sfFetch(pagedPath, apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    const totalPages = data.total_pages as number | undefined;
    const lastPage = data.last_page as number | undefined;
    const maxPages = totalPages ?? lastPage;

    if (maxPages && page < maxPages) {
      page++;
    } else if (!maxPages && items.length === DEFAULT_PAGE_SIZE) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ServiceFusionAdapter extends BaseAdapter {
  readonly provider = 'service-fusion' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API key auth) ────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Service Fusion uses API key authentication, not OAuth. Configure SERVICE_FUSION_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Service Fusion uses API key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Service Fusion uses API key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Service Fusion → CrewShift ──────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const customers = await sfFetchAllPages('/customers', apiKey, 'customers');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: (cust.customer_name as string) ?? `${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim(),
          company_name: (cust.company_name as string) ?? null,
          email: (cust.email as string) ?? null,
          phone: (cust.phone as string) || (cust.mobile as string) || null,
          address: cust.address_line_1
            ? {
                street: [cust.address_line_1, cust.address_line_2].filter(Boolean).join(', '),
                city: (cust.city as string) ?? '',
                state: (cust.state as string) ?? '',
                zip: (cust.zip_code as string) ?? '',
              }
            : null,
          external_ids: { 'service-fusion': String(cust.id) },
          source: 'service-fusion',
          metadata: {
            sf_account_number: cust.account_number,
            sf_created_at: cust.created_at,
            sf_updated_at: cust.updated_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'Service Fusion customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const jobs = await sfFetchAllPages('/jobs', apiKey, 'jobs');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: (job.description as string) ?? (job.job_number as string) ?? `Job ${job.id}`,
          status: (job.status as string) ?? 'unknown',
          scheduled_start: (job.start_date as string) ?? null,
          scheduled_end: (job.end_date as string) ?? null,
          customer_external_id: job.customer_id ? String(job.customer_id) : null,
          address: job.address_line_1
            ? {
                street: [job.address_line_1, job.address_line_2].filter(Boolean).join(', '),
                city: (job.city as string) ?? '',
                state: (job.state as string) ?? '',
                zip: (job.zip_code as string) ?? '',
              }
            : null,
          external_ids: { 'service-fusion': String(job.id) },
          source: 'service-fusion',
          metadata: {
            sf_job_number: job.job_number,
            sf_status: job.status,
            sf_priority: job.priority,
            sf_technician_ids: job.technician_ids,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Service Fusion job sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const invoices = await sfFetchAllPages('/invoices', apiKey, 'invoices');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const inv of invoices) {
      try {
        const lineItems = (inv.line_items as Array<Record<string, unknown>>) ?? [];
        records.push({
          invoice_number: (inv.invoice_number as string) ?? null,
          status: this.mapInvoiceStatus(inv),
          amount: (inv.total as number) ?? 0,
          balance_due: (inv.balance as number) ?? 0,
          due_date: (inv.due_date as string) ?? null,
          issued_date: (inv.created_at as string) ?? null,
          customer_external_id: inv.customer_id ? String(inv.customer_id) : null,
          external_ids: { 'service-fusion': String(inv.id) },
          line_items: lineItems.map((li) => ({
            description: (li.description as string) ?? '',
            quantity: (li.quantity as number) ?? 1,
            unit_price: (li.unit_price as number) ?? 0,
            total: (li.total as number) ?? 0,
          })),
          source: 'service-fusion',
          metadata: {
            sf_job_id: inv.job_id,
            sf_status: inv.status,
            sf_created_at: inv.created_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Service Fusion invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Service Fusion ─────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getApiKey();

    const body = {
      customer_id: invoiceData.customer_external_id,
      job_id: invoiceData.job_external_id ?? null,
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        description: item.description ?? 'Service',
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? 0,
      })) ?? [],
      notes: invoiceData.notes as string ?? '',
    };

    const response = await sfFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const apiKey = getApiKey();
    // Service Fusion verifies webhooks by including the API key in the webhook header
    return signature === apiKey;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.action as string) ?? 'unknown';
    const resourceType = (payload.resource_type as string) ?? (payload.entity as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.id ? String(data.id) : undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private mapInvoiceStatus(inv: Record<string, unknown>): string {
    const status = (inv.status as string)?.toLowerCase();
    if (status === 'paid') return 'paid';
    if (status === 'partial') return 'partial';
    if (status === 'overdue') return 'overdue';
    if (status === 'void' || status === 'voided') return 'void';
    if (status === 'draft') return 'draft';
    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ServiceFusionAdapter();
registerAdapter(adapter);
export default adapter;
