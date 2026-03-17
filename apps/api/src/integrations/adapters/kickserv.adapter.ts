/**
 * Kickserv Integration Adapter
 *
 * Native (Tier 1) adapter for Kickserv field-service management.
 * Handles API token auth, customer/job/invoice sync.
 *
 * Kickserv API Reference:
 * - API: https://{account}.kickserv.com/api/v1
 *
 * Key details:
 * - Auth via API token in header
 * - Account subdomain required in base URL
 * - Endpoints return .json resources with page query param
 * - No webhook support
 * - Premium plan required
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

const DEFAULT_PAGE_SIZE = 25;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAccount(): string {
  const account = process.env.KICKSERV_ACCOUNT ?? env.KICKSERV_ACCOUNT;
  if (!account) throw new Error('KICKSERV_ACCOUNT is not configured');
  return account;
}

function getApiToken(): string {
  const token = process.env.KICKSERV_API_TOKEN ?? env.KICKSERV_API_TOKEN;
  if (!token) throw new Error('KICKSERV_API_TOKEN is not configured');
  return token;
}

function getApiBase(): string {
  const account = getAccount();
  return `https://${account}.kickserv.com/api/v1`;
}

/**
 * Make an authenticated request to the Kickserv API.
 */
async function ksFetch(
  path: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBase()}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Token ${apiToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Kickserv API error',
    );
    throw new Error(`Kickserv API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Kickserv list endpoint.
 * Uses page query parameter. Responses use .json suffix.
 */
async function ksFetchAllPages(
  path: string,
  apiToken: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}`;

    const response = await ksFetch(pagedPath, apiToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    // Kickserv uses a default page size; if fewer items than expected, we're done
    if (items.length < DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class KickservAdapter extends BaseAdapter {
  readonly provider = 'kickserv' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — token auth) ──────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Kickserv uses API token authentication, not OAuth. Configure KICKSERV_API_TOKEN instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Kickserv uses API token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Kickserv uses API token authentication. Tokens do not expire or require refresh.');
  }

  // ── Sync: Kickserv → CrewShift ────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiToken = accessToken || getApiToken();
    const customers = await ksFetchAllPages('/customers.json', apiToken, 'customers');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: (cust.name as string) ?? `${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim(),
          company_name: (cust.company_name as string) ?? null,
          email: (cust.email as string) ?? null,
          phone: (cust.phone as string) || (cust.mobile as string) || null,
          address: cust.address
            ? {
                street: (cust.address as string) ?? '',
                city: (cust.city as string) ?? '',
                state: (cust.state as string) ?? '',
                zip: (cust.zip_code as string) ?? '',
              }
            : null,
          external_ids: { kickserv: String(cust.id) },
          source: 'kickserv',
          metadata: {
            ks_account_number: cust.account_number,
            ks_created_at: cust.created_at,
            ks_updated_at: cust.updated_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'Kickserv customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiToken = accessToken || getApiToken();
    const jobs = await ksFetchAllPages('/jobs.json', apiToken, 'jobs');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: (job.description as string) ?? (job.name as string) ?? `Job ${job.id}`,
          status: (job.status as string) ?? 'unknown',
          scheduled_start: (job.start_date as string) ?? (job.scheduled_start as string) ?? null,
          scheduled_end: (job.end_date as string) ?? (job.scheduled_end as string) ?? null,
          customer_external_id: job.customer_id ? String(job.customer_id) : null,
          address: job.address
            ? {
                street: (job.address as string) ?? '',
                city: (job.city as string) ?? '',
                state: (job.state as string) ?? '',
                zip: (job.zip_code as string) ?? '',
              }
            : null,
          external_ids: { kickserv: String(job.id) },
          source: 'kickserv',
          metadata: {
            ks_job_number: job.job_number,
            ks_status: job.status,
            ks_total: job.total,
            ks_employee_ids: job.employee_ids,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Kickserv job sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiToken = accessToken || getApiToken();
    const invoices = await ksFetchAllPages('/invoices.json', apiToken, 'invoices');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const inv of invoices) {
      try {
        const lineItems = (inv.line_items as Array<Record<string, unknown>>) ?? [];
        records.push({
          invoice_number: (inv.number as string) ?? (inv.invoice_number as string) ?? null,
          status: this.mapInvoiceStatus(inv),
          amount: (inv.total as number) ?? 0,
          balance_due: (inv.balance as number) ?? 0,
          due_date: (inv.due_date as string) ?? null,
          issued_date: (inv.issued_date as string) ?? (inv.created_at as string) ?? null,
          customer_external_id: inv.customer_id ? String(inv.customer_id) : null,
          external_ids: { kickserv: String(inv.id) },
          line_items: lineItems.map((li) => ({
            description: (li.description as string) ?? (li.name as string) ?? '',
            quantity: (li.quantity as number) ?? 1,
            unit_price: (li.unit_price as number) ?? (li.rate as number) ?? 0,
            total: (li.total as number) ?? 0,
          })),
          source: 'kickserv',
          metadata: {
            ks_job_id: inv.job_id,
            ks_status: inv.status,
            ks_created_at: inv.created_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Kickserv invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ─────────────────────────────────────────────

  // Kickserv does not support webhooks. The base class defaults apply:
  // verifyWebhook returns false, processWebhook throws.

  // ── Private Helpers ──────────────────────────────────────────────────────

  private mapInvoiceStatus(inv: Record<string, unknown>): string {
    const balance = (inv.balance as number) ?? 0;
    const total = (inv.total as number) ?? 0;

    if (balance === 0 && total > 0) return 'paid';
    if (balance > 0 && balance < total) return 'partial';

    const dueDate = inv.due_date as string | undefined;
    if (dueDate && new Date(dueDate) < new Date()) return 'overdue';

    const status = (inv.status as string)?.toLowerCase();
    if (status === 'draft') return 'draft';

    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new KickservAdapter();
registerAdapter(adapter);
export default adapter;
