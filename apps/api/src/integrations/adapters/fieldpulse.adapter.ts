/**
 * FieldPulse Integration Adapter
 *
 * Native (Tier 1) adapter for FieldPulse field-service management.
 * Handles Bearer token auth, customer/job/invoice sync, invoice creation, and webhooks.
 *
 * FieldPulse API Reference:
 * - API: https://api.fieldpulse.com/api
 *
 * Key details:
 * - Auth via Bearer token in Authorization header
 * - Pagination via page/per_page query params
 * - Rate limit: 1,000 requests per hour
 * - Webhook verification: HMAC
 * - Professional plan required
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

const API_BASE = 'https://api.fieldpulse.com/api';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.FIELDPULSE_API_KEY ?? env.FIELDPULSE_API_KEY;
  if (!key) throw new Error('FIELDPULSE_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the FieldPulse API.
 */
async function fpFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'FieldPulse API error',
    );
    throw new Error(`FieldPulse API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a FieldPulse list endpoint.
 * Uses page/per_page query parameters.
 */
async function fpFetchAllPages(
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

    const response = await fpFetch(pagedPath, apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    const lastPage = data.last_page as number | undefined;
    const totalPages = data.total_pages as number | undefined;
    const maxPage = lastPage ?? totalPages;

    if (maxPage && page < maxPage) {
      page++;
    } else if (!maxPage && items.length === DEFAULT_PAGE_SIZE) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class FieldPulseAdapter extends BaseAdapter {
  readonly provider = 'fieldpulse' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — Bearer token auth) ──────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('FieldPulse uses API key authentication, not OAuth. Configure FIELDPULSE_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('FieldPulse uses API key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('FieldPulse uses API key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: FieldPulse → CrewShift ──────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const customers = await fpFetchAllPages('/customers', apiKey, 'customers');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: (`${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim() || (cust.name as string)) ?? '',
          company_name: (cust.company_name as string) ?? null,
          email: (cust.email as string) ?? null,
          phone: (cust.phone as string) || (cust.mobile as string) || null,
          address: cust.address_line_1
            ? {
                street: [cust.address_line_1, cust.address_line_2].filter(Boolean).join(', '),
                city: (cust.city as string) ?? '',
                state: (cust.state as string) ?? '',
                zip: (cust.zip as string) ?? (cust.postal_code as string) ?? '',
              }
            : null,
          external_ids: { fieldpulse: String(cust.id) },
          source: 'fieldpulse',
          metadata: {
            fp_tags: cust.tags,
            fp_created_at: cust.created_at,
            fp_updated_at: cust.updated_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'FieldPulse customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const jobs = await fpFetchAllPages('/jobs', apiKey, 'jobs');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: (job.title as string) ?? (job.description as string) ?? `Job ${job.id}`,
          status: (job.status as string) ?? 'unknown',
          scheduled_start: (job.start_time as string) ?? (job.scheduled_start as string) ?? null,
          scheduled_end: (job.end_time as string) ?? (job.scheduled_end as string) ?? null,
          customer_external_id: job.customer_id ? String(job.customer_id) : null,
          address: job.address_line_1
            ? {
                street: [job.address_line_1, job.address_line_2].filter(Boolean).join(', '),
                city: (job.city as string) ?? '',
                state: (job.state as string) ?? '',
                zip: (job.zip as string) ?? '',
              }
            : null,
          external_ids: { fieldpulse: String(job.id) },
          source: 'fieldpulse',
          metadata: {
            fp_status: job.status,
            fp_priority: job.priority,
            fp_total: job.total,
            fp_assigned_team_member_ids: job.team_member_ids,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'FieldPulse job sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const invoices = await fpFetchAllPages('/invoices', apiKey, 'invoices');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const inv of invoices) {
      try {
        const lineItems = (inv.line_items as Array<Record<string, unknown>>) ?? [];
        records.push({
          invoice_number: (inv.invoice_number as string) ?? (inv.number as string) ?? null,
          status: this.mapInvoiceStatus(inv),
          amount: (inv.total as number) ?? 0,
          balance_due: (inv.balance_due as number) ?? (inv.balance as number) ?? 0,
          due_date: (inv.due_date as string) ?? null,
          issued_date: (inv.issued_date as string) ?? (inv.created_at as string) ?? null,
          customer_external_id: inv.customer_id ? String(inv.customer_id) : null,
          external_ids: { fieldpulse: String(inv.id) },
          line_items: lineItems.map((li) => ({
            description: (li.description as string) ?? (li.name as string) ?? '',
            quantity: (li.quantity as number) ?? 1,
            unit_price: (li.unit_price as number) ?? (li.rate as number) ?? 0,
            total: (li.total as number) ?? 0,
          })),
          source: 'fieldpulse',
          metadata: {
            fp_job_id: inv.job_id,
            fp_status: inv.status,
            fp_created_at: inv.created_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'FieldPulse invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → FieldPulse ─────────────────────────────────

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
      due_date: invoiceData.due_date ?? null,
      notes: invoiceData.notes as string ?? '',
    };

    const response = await fpFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const invoice = (result.invoice as Record<string, unknown>) ?? result;

    return {
      provider: this.provider,
      external_id: String(invoice.id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getApiKey();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    const parts = eventType.split('.');
    const resourceType = parts[0] ?? 'unknown';

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
    if (status === 'partial' || status === 'partially_paid') return 'partial';
    if (status === 'overdue') return 'overdue';
    if (status === 'void' || status === 'voided') return 'void';
    if (status === 'draft') return 'draft';
    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new FieldPulseAdapter();
registerAdapter(adapter);
export default adapter;
