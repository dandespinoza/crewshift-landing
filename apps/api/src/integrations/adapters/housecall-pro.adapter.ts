/**
 * Housecall Pro Integration Adapter
 *
 * Native (Tier 1) adapter for Housecall Pro field-service management.
 * Handles OAuth2, customer/job/invoice sync, invoice creation, and webhooks.
 *
 * Housecall Pro API Reference:
 * - Auth: https://developer.housecallpro.com/docs/authentication
 * - API: https://developer.housecallpro.com/docs
 *
 * Key details:
 * - OAuth 2.0 authorization code flow
 * - Pagination via page/page_size query params
 * - Webhook verification: HMAC-SHA256
 * - Requires MAX plan (~$249/mo)
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

const AUTH_URL = 'https://api.housecallpro.com/oauth/authorize';
const TOKEN_URL = 'https://api.housecallpro.com/oauth/token';
const API_BASE = 'https://api.housecallpro.com';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.HOUSECALLPRO_CLIENT_ID ?? env.HOUSECALLPRO_CLIENT_ID;
  if (!id) throw new Error('HOUSECALLPRO_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.HOUSECALLPRO_CLIENT_SECRET ?? env.HOUSECALLPRO_CLIENT_SECRET;
  if (!secret) throw new Error('HOUSECALLPRO_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Housecall Pro API.
 */
async function hcpFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Housecall Pro API error',
    );
    throw new Error(`Housecall Pro API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Housecall Pro list endpoint.
 * Uses page/page_size query parameters.
 */
async function hcpFetchAllPages(
  path: string,
  accessToken: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&page_size=${DEFAULT_PAGE_SIZE}`;

    const response = await hcpFetch(pagedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? [];

    results.push(...items);

    const totalPages = data.total_pages as number | undefined;
    if (totalPages && page < totalPages) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class HousecallProAdapter extends BaseAdapter {
  readonly provider = 'housecall-pro' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = `${env.API_URL}/api/integrations/housecall-pro/callback`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Housecall Pro token exchange failed');
      throw new Error(`Housecall Pro token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Housecall Pro');
    }

    const clientId = getClientId();
    const clientSecret = getClientSecret();

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Housecall Pro token refresh failed');
      throw new Error(`Housecall Pro token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Housecall Pro → CrewShift ───────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const customers = await hcpFetchAllPages('/customers', accessToken, 'customers');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: `${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim(),
          company_name: (cust.company as string) ?? null,
          email: (cust.email as string) ?? null,
          phone: (cust.mobile_number as string) || (cust.home_number as string) || null,
          address: cust.street_address
            ? {
                street: cust.street_address as string,
                city: (cust.city as string) ?? '',
                state: (cust.state as string) ?? '',
                zip: (cust.zip as string) ?? '',
              }
            : null,
          external_ids: { 'housecall-pro': String(cust.id) },
          source: 'housecall-pro',
          metadata: {
            hcp_tags: cust.tags,
            hcp_notifications_enabled: cust.notifications_enabled,
            hcp_created_at: cust.created_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'Housecall Pro customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const jobs = await hcpFetchAllPages('/jobs', accessToken, 'jobs');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const job of jobs) {
      try {
        const address = job.address as Record<string, unknown> | undefined;
        records.push({
          title: (job.description as string) ?? `Job ${job.id}`,
          status: (job.work_status as string) ?? 'unknown',
          scheduled_start: (job.schedule as Record<string, unknown>)?.scheduled_start ?? null,
          scheduled_end: (job.schedule as Record<string, unknown>)?.scheduled_end ?? null,
          customer_external_id: job.customer_id ? String(job.customer_id) : null,
          address: address
            ? {
                street: (address.street as string) ?? '',
                city: (address.city as string) ?? '',
                state: (address.state as string) ?? '',
                zip: (address.zip as string) ?? '',
              }
            : null,
          external_ids: { 'housecall-pro': String(job.id) },
          source: 'housecall-pro',
          metadata: {
            hcp_work_status: job.work_status,
            hcp_invoice_number: job.invoice_number,
            hcp_total_amount: job.total_amount,
            hcp_assigned_employee_ids: job.assigned_employee_ids,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Housecall Pro job sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const invoices = await hcpFetchAllPages('/invoices', accessToken, 'invoices');

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
          amount: (inv.total_amount as number) ?? 0,
          balance_due: (inv.balance as number) ?? 0,
          due_date: (inv.due_date as string) ?? null,
          issued_date: (inv.created_at as string) ?? null,
          customer_external_id: inv.customer_id ? String(inv.customer_id) : null,
          external_ids: { 'housecall-pro': String(inv.id) },
          line_items: lineItems.map((li) => ({
            description: (li.name as string) ?? '',
            quantity: (li.quantity as number) ?? 1,
            unit_price: (li.unit_price as number) ?? 0,
            total: (li.total_cost as number) ?? 0,
          })),
          source: 'housecall-pro',
          metadata: {
            hcp_job_id: inv.job_id,
            hcp_sent_at: inv.sent_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Housecall Pro invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Housecall Pro ──────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const body = {
      customer_id: invoiceData.customer_external_id,
      job_id: invoiceData.job_external_id ?? null,
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        name: item.description ?? 'Service',
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? 0,
      })) ?? [],
      message: invoiceData.notes as string ?? '',
    };

    const response = await hcpFetch('/invoices', accessToken, {
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

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? 'unknown';
    const resourceType = (payload.resource_type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.id ? String(data.id) : undefined,
      data: payload,
      timestamp: (payload.occurred_at as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private mapInvoiceStatus(inv: Record<string, unknown>): string {
    const balance = (inv.balance as number) ?? 0;
    const total = (inv.total_amount as number) ?? 0;

    if (balance === 0 && total > 0) return 'paid';
    if (balance > 0 && balance < total) return 'partial';

    const dueDate = inv.due_date as string | undefined;
    if (dueDate && new Date(dueDate) < new Date()) return 'overdue';

    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new HousecallProAdapter();
registerAdapter(adapter);
export default adapter;
