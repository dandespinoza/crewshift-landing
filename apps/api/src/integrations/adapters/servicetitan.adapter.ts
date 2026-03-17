/**
 * ServiceTitan Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for ServiceTitan.
 * Handles OAuth2 client_credentials + app_key, customer/job/invoice sync, and webhooks.
 *
 * ServiceTitan API Reference:
 * - Auth: https://developer.servicetitan.io/docs/get-started
 * - Customers: https://developer.servicetitan.io/apis/crm
 * - Jobs: https://developer.servicetitan.io/apis/jpm
 * - Invoices: https://developer.servicetitan.io/apis/accounting
 *
 * Key details:
 * - OAuth2 client_credentials grant with app_key header
 * - API versioned at /v2/tenant/{tenantId}
 * - Rate limit: 60 req/sec
 * - Webhook verification: HMAC-SHA256
 * - NOTE: Partner program currently PAUSED — monitor status
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

const ST_AUTH_URL = 'https://auth.servicetitan.io/connect/authorize';
const ST_TOKEN_URL = 'https://auth.servicetitan.io/connect/token';
const ST_API_BASE = 'https://api.servicetitan.io';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.SERVICETITAN_CLIENT_ID ?? env.SERVICETITAN_CLIENT_ID;
  if (!id) throw new Error('SERVICETITAN_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.SERVICETITAN_CLIENT_SECRET ?? env.SERVICETITAN_CLIENT_SECRET;
  if (!secret) throw new Error('SERVICETITAN_CLIENT_SECRET is not configured');
  return secret;
}

function getAppKey(): string {
  const key = process.env.SERVICETITAN_APP_KEY ?? env.SERVICETITAN_APP_KEY;
  if (!key) throw new Error('SERVICETITAN_APP_KEY is not configured');
  return key;
}

function getTenantId(): string {
  const tenantId = process.env.SERVICETITAN_TENANT_ID;
  if (!tenantId) throw new Error('SERVICETITAN_TENANT_ID is not configured');
  return tenantId;
}

/**
 * Make an authenticated request to the ServiceTitan API.
 */
async function stFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const tenantId = getTenantId();
  const url = `${ST_API_BASE}${path.replace('{tenantId}', tenantId)}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': accessToken,
      'ST-App-Key': getAppKey(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'ServiceTitan API error',
    );
    throw new Error(`ServiceTitan API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a ServiceTitan list endpoint.
 */
async function stPaginateAll(
  path: string,
  accessToken: string,
  extraParams: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(DEFAULT_PAGE_SIZE),
      ...extraParams,
    });

    const response = await stFetch(`${path}?${params.toString()}`, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? [];

    results.push(...items);

    const totalCount = data.totalCount as number | undefined;
    if (totalCount && results.length < totalCount) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ServiceTitanAdapter extends BaseAdapter {
  readonly provider = 'servicetitan' as const;
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

    return `${ST_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    // ServiceTitan uses client_credentials grant, not authorization_code
    const response = await fetch(ST_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: getClientId(),
        client_secret: getClientSecret(),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'ServiceTitan token exchange failed');
      throw new Error(`ServiceTitan token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // client_credentials grant: just request a new token
    return this.handleCallback('', '');
  }

  // ── Sync: ServiceTitan → CrewShift ──────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const params: Record<string, string> = {};
    if (lastSyncAt) {
      params.modifiedOnOrAfter = lastSyncAt;
    }

    const tenantId = getTenantId();
    const customers = await stPaginateAll(
      `/crm/v2/tenant/${tenantId}/customers`,
      accessToken,
      params,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: cust.name ?? null,
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
          external_ids: { servicetitan: String(cust.id) },
          source: 'servicetitan',
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'ServiceTitan customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const params: Record<string, string> = {};
    if (lastSyncAt) {
      params.modifiedOnOrAfter = lastSyncAt;
    }

    const tenantId = getTenantId();
    const jobs = await stPaginateAll(
      `/jpm/v2/tenant/${tenantId}/jobs`,
      accessToken,
      params,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: job.summary ?? job.jobNumber ?? null,
          status: job.jobStatus ?? null,
          scheduled_start: job.startDate ?? null,
          scheduled_end: job.endDate ?? null,
          customer_external_id: job.customerId ? String(job.customerId) : null,
          external_ids: { servicetitan: String(job.id) },
          source: 'servicetitan',
          metadata: {
            st_job_number: job.jobNumber,
            st_business_unit: job.businessUnitId,
            st_job_type: job.jobType,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'ServiceTitan job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const params: Record<string, string> = {};
    if (lastSyncAt) {
      params.modifiedOnOrAfter = lastSyncAt;
    }

    const tenantId = getTenantId();
    const invoices = await stPaginateAll(
      `/accounting/v2/tenant/${tenantId}/invoices`,
      accessToken,
      params,
    );

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
          due_date: inv.dueDate ?? null,
          issued_date: inv.invoiceDate ?? null,
          customer_external_id: inv.customerId ? String(inv.customerId) : null,
          external_ids: { servicetitan: String(inv.id) },
          source: 'servicetitan',
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'ServiceTitan invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
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
    return {
      provider: this.provider,
      event_type: (payload.eventType as string) ?? 'unknown',
      resource_type: (payload.resourceType as string) ?? 'unknown',
      resource_id: payload.resourceId ? String(payload.resourceId) : undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ServiceTitanAdapter();
registerAdapter(adapter);
export default adapter;
