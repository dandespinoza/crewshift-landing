/**
 * Workiz Integration Adapter
 *
 * Native (Tier 1) adapter for Workiz field-service management.
 * Handles token-based auth, lead/job/invoice sync, invoice creation, and webhooks.
 *
 * Workiz API Reference:
 * - API: https://developer.workiz.com/
 *
 * Key details:
 * - Auth via API token embedded in URL path: /api/v1/{token}/...
 * - Workiz calls customers "leads"
 * - Developer API add-on required (separate purchase)
 * - Webhook verification via token matching
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

const API_BASE = 'https://api.workiz.com/api/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = process.env.WORKIZ_API_TOKEN ?? env.WORKIZ_API_TOKEN;
  if (!token) throw new Error('WORKIZ_API_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the Workiz API.
 * Token is embedded in the URL path.
 */
async function workizFetch(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}/${token}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Workiz API error',
    );
    throw new Error(`Workiz API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Workiz list endpoint.
 */
async function workizFetchAllPages(
  token: string,
  path: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}offset=${offset}&records=${DEFAULT_PAGE_SIZE}`;

    const response = await workizFetch(token, pagedPath);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    if (items.length < DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += DEFAULT_PAGE_SIZE;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class WorkizAdapter extends BaseAdapter {
  readonly provider = 'workiz' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — token in URL path) ───────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Workiz uses API token authentication, not OAuth. Configure WORKIZ_API_TOKEN instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Workiz uses API token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Workiz uses API token authentication. Tokens do not expire or require refresh.');
  }

  // ── Sync: Workiz → CrewShift ──────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();
    // Workiz calls customers "leads"
    const leads = await workizFetchAllPages(token, '/leads/', 'data');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const lead of leads) {
      try {
        records.push({
          name: (`${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || (lead.name as string)) ?? '',
          company_name: (lead.company as string) ?? null,
          email: (lead.email as string) ?? null,
          phone: (lead.phone as string) || (lead.secondary_phone as string) || null,
          address: lead.address
            ? {
                street: (lead.address as string) ?? '',
                city: (lead.city as string) ?? '',
                state: (lead.state as string) ?? '',
                zip: (lead.zip as string) ?? '',
              }
            : null,
          external_ids: { workiz: String(lead.UUID ?? lead.id) },
          source: 'workiz',
          metadata: {
            wz_lead_serial: lead.serial,
            wz_source: lead.lead_source,
            wz_created_date: lead.created_date,
            wz_status: lead.status,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: lead, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: leads.length, created, errors: errors.length },
      'Workiz lead/customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();
    const jobs = await workizFetchAllPages(token, '/jobs/', 'data');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: (job.job_type as string) ?? (job.description as string) ?? `Job ${job.serial ?? job.id}`,
          status: (job.status as string) ?? 'unknown',
          scheduled_start: (job.scheduled_date as string) ?? null,
          scheduled_end: (job.scheduled_end as string) ?? null,
          customer_external_id: job.client_id ? String(job.client_id) : null,
          address: job.address
            ? {
                street: (job.address as string) ?? '',
                city: (job.city as string) ?? '',
                state: (job.state as string) ?? '',
                zip: (job.zip as string) ?? '',
              }
            : null,
          external_ids: { workiz: String(job.UUID ?? job.id) },
          source: 'workiz',
          metadata: {
            wz_serial: job.serial,
            wz_job_type: job.job_type,
            wz_status: job.status,
            wz_total: job.total,
            wz_assigned_to: job.assigned_to,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Workiz job sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();
    const invoices = await workizFetchAllPages(token, '/invoices/', 'data');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const inv of invoices) {
      try {
        const lineItems = (inv.line_items as Array<Record<string, unknown>>) ?? [];
        records.push({
          invoice_number: (inv.serial as string) ?? (inv.invoice_number as string) ?? null,
          status: this.mapInvoiceStatus(inv),
          amount: (inv.total as number) ?? 0,
          balance_due: (inv.balance as number) ?? 0,
          due_date: (inv.due_date as string) ?? null,
          issued_date: (inv.created_date as string) ?? null,
          customer_external_id: inv.client_id ? String(inv.client_id) : null,
          external_ids: { workiz: String(inv.UUID ?? inv.id) },
          line_items: lineItems.map((li) => ({
            description: (li.description as string) ?? (li.name as string) ?? '',
            quantity: (li.quantity as number) ?? 1,
            unit_price: (li.price as number) ?? 0,
            total: (li.total as number) ?? 0,
          })),
          source: 'workiz',
          metadata: {
            wz_job_id: inv.job_id,
            wz_status: inv.status,
            wz_serial: inv.serial,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Workiz invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Workiz ─────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const token = accessToken || getApiToken();

    const body = {
      client_id: invoiceData.customer_external_id,
      job_id: invoiceData.job_external_id ?? null,
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        name: item.description ?? 'Service',
        quantity: item.quantity ?? 1,
        price: item.unit_price ?? 0,
      })) ?? [],
      notes: invoiceData.notes as string ?? '',
    };

    const response = await workizFetch(token, '/invoice/create/', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.UUID ?? result.id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const token = getApiToken();
    // Workiz verifies webhooks by including the token in the request
    return signature === token;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.hook as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    // Derive resource type from event string (e.g., "job.created" -> "job")
    const parts = eventType.split('.');
    const resourceType = parts[0] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.UUID ? String(data.UUID) : (data?.id ? String(data.id) : undefined),
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
    if (status === 'void' || status === 'cancelled') return 'void';
    if (status === 'draft') return 'draft';
    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new WorkizAdapter();
registerAdapter(adapter);
export default adapter;
