/**
 * GorillaDesk Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for GorillaDesk.
 * Handles email/password login for Bearer token auth, then syncs
 * customers, jobs, and invoices.
 *
 * GorillaDesk API Reference:
 * - API Base: https://api.gorilladesk.com/v2
 * - Auth: POST /auth/login with {email, password} -> Bearer token
 *
 * Key details:
 * - Login with email/password to get Bearer token
 * - Customer sync via GET /customers with page param
 * - Job sync via GET /jobs with page param
 * - Invoice sync via GET /invoices with page param
 * - No webhooks
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

const GORILLADESK_API_BASE = 'https://api.gorilladesk.com/v2';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEmail(): string {
  const email = process.env.GORILLADESK_EMAIL;
  if (!email) throw new Error('GORILLADESK_EMAIL is not configured');
  return email;
}

function getPassword(): string {
  const password = process.env.GORILLADESK_PASSWORD;
  if (!password) throw new Error('GORILLADESK_PASSWORD is not configured');
  return password;
}

/**
 * Make an authenticated request to the GorillaDesk API.
 */
async function gorillaDeskFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${GORILLADESK_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'GorillaDesk API error',
    );
    throw new Error(`GorillaDesk API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a GorillaDesk list endpoint.
 */
async function gorillaDeskPaginateAll(
  path: string,
  accessToken: string,
  dataKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await gorillaDeskFetch(
      `${path}${separator}page=${page}&per_page=${DEFAULT_PAGE_SIZE}`,
      accessToken,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[dataKey] as Record<string, unknown>[]) ?? [];

    results.push(...items);

    if (items.length < DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class GorillaDeskAdapter extends BaseAdapter {
  readonly provider = 'gorilladesk' as const;
  readonly tier = 'native' as const;

  // ── Auth (email/password login) ──────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'GorillaDesk uses email/password login, not OAuth. Configure GORILLADESK_EMAIL and GORILLADESK_PASSWORD, then call handleCallback().',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(`${GORILLADESK_API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        email: getEmail(),
        password: getPassword(),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'GorillaDesk login failed');
      throw new Error(`GorillaDesk login failed: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      access_token: (data.token ?? data.access_token) as string,
      refresh_token: undefined,
      expires_at: data.expires_at
        ? String(data.expires_at)
        : undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // Re-login to get a new token
    return this.handleCallback('', '');
  }

  // ── Sync: GorillaDesk → CrewShift ──────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const customers = await gorillaDeskPaginateAll('/customers', accessToken, 'customers');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: `${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim() || cust.name || null,
          company_name: cust.company ?? null,
          email: cust.email ?? null,
          phone: cust.phone ?? null,
          address: cust.address
            ? {
                street: (cust.address as Record<string, unknown>).street ?? '',
                city: (cust.address as Record<string, unknown>).city ?? '',
                state: (cust.address as Record<string, unknown>).state ?? '',
                zip: (cust.address as Record<string, unknown>).zip ?? '',
              }
            : null,
          external_ids: { gorilladesk: String(cust.id) },
          source: 'gorilladesk',
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'GorillaDesk customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const jobs = await gorillaDeskPaginateAll('/jobs', accessToken, 'jobs');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: job.title ?? job.description ?? null,
          status: job.status ?? null,
          scheduled_start: job.scheduled_at ?? null,
          scheduled_end: job.completed_at ?? null,
          customer_external_id: job.customer_id ? String(job.customer_id) : null,
          external_ids: { gorilladesk: String(job.id) },
          source: 'gorilladesk',
          metadata: {
            gd_job_type: job.job_type,
            gd_technician: job.technician,
            gd_notes: job.notes,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'GorillaDesk job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const invoices = await gorillaDeskPaginateAll('/invoices', accessToken, 'invoices');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const inv of invoices) {
      try {
        records.push({
          invoice_number: inv.number ?? null,
          status: inv.status ?? null,
          amount: inv.total ?? 0,
          balance_due: inv.balance ?? 0,
          due_date: inv.due_date ?? null,
          issued_date: inv.created_at ?? null,
          customer_external_id: inv.customer_id ? String(inv.customer_id) : null,
          external_ids: { gorilladesk: String(inv.id) },
          source: 'gorilladesk',
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'GorillaDesk invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new GorillaDeskAdapter();
registerAdapter(adapter);
export default adapter;
