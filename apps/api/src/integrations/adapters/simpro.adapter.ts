/**
 * simPRO Integration Adapter
 *
 * Native (Tier 2) adapter for simPRO field service management.
 * Handles OAuth2, customer/job/invoice sync via REST API, and webhooks.
 *
 * simPRO API Reference:
 * - Auth: https://developer.simprogroup.com/apidoc/
 * - REST: https://developer.simprogroup.com/apidoc/
 * - Webhooks: https://developer.simprogroup.com/apidoc/#tag/Webhooks
 *
 * Key details:
 * - REST API v1.0 with page-based pagination
 * - OAuth 2.0 authentication
 * - API base includes company_id in the URL path
 * - Rate limit: 10 requests per second (strict)
 * - Webhook verification: HMAC signature
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

const SIMPRO_AUTH_URL = 'https://login.simprogroup.com/oauth/authorize';
const SIMPRO_TOKEN_URL = 'https://login.simprogroup.com/oauth/token';
const SIMPRO_API_BASE = 'https://api.simprogroup.com/api/v1.0/companies';
const SIMPRO_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the simPRO API.
 * Access token format: "token|company_id"
 */
async function simproFetch(
  companyId: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SIMPRO_API_BASE}/${companyId}${path}`;

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
      { status: response.status, path, companyId, errorBody },
      'simPRO API error',
    );
    throw new Error(`simPRO API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a simPRO collection using page-based pagination.
 */
async function simproFetchAll(
  companyId: string,
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}page=${page}&pageSize=${SIMPRO_PAGE_SIZE}`;
    const response = await simproFetch(companyId, paginatedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>[] | Record<string, unknown>;

    // simPRO may return an array directly or wrap in an object
    const items = Array.isArray(data) ? data : (data.data as Record<string, unknown>[]) ?? [];

    if (items.length === 0) {
      hasMore = false;
    } else {
      results.push(...items);
      page++;
      if (items.length < SIMPRO_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class SimproAdapter extends BaseAdapter {
  readonly provider = 'simpro' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.SIMPRO_CLIENT_ID;
    if (!clientId) {
      throw new Error('SIMPRO_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${SIMPRO_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.SIMPRO_CLIENT_ID ?? '';
    const clientSecret = env.SIMPRO_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/simpro/callback`;

    const response = await fetch(SIMPRO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'simPRO token exchange failed');
      throw new Error(`simPRO token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for simPRO');
    }

    const clientId = env.SIMPRO_CLIENT_ID ?? '';
    const clientSecret = env.SIMPRO_CLIENT_SECRET ?? '';

    const response = await fetch(SIMPRO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'simPRO token refresh failed');
      throw new Error(`simPRO token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // -- Sync: simPRO -> CrewShift ----------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, companyId] = this.parseAccessToken(accessToken);
    const rawCustomers = await simproFetchAll(companyId, '/customers/', token);

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
      'simPRO customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, companyId] = this.parseAccessToken(accessToken);
    const rawJobs = await simproFetchAll(companyId, '/jobs/', token);

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
      'simPRO job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, companyId] = this.parseAccessToken(accessToken);
    const rawInvoices = await simproFetchAll(companyId, '/invoices/', token);

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
      'simPRO invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> simPRO ----------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, companyId] = this.parseAccessToken(accessToken);

    const simproInvoice = {
      Customer: { ID: invoiceData.customer_external_id },
      Job: invoiceData.job_external_id ? { ID: invoiceData.job_external_id } : undefined,
      DueDate: invoiceData.due_date ?? null,
      InvoiceNumber: invoiceData.invoice_number ?? null,
      Lines: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        Description: item.description ?? '',
        Quantity: item.quantity ?? 1,
        UnitCost: item.unit_price ?? 0,
      })) ?? [],
    };

    const response = await simproFetch(companyId, '/invoices/', token, {
      method: 'POST',
      body: JSON.stringify(simproInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.ID ?? result.id ?? ''),
    };
  }

  // -- Webhooks ---------------------------------------------------------------

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.SIMPRO_CLIENT_SECRET;
    if (!secret) {
      logger.warn('No simPRO client secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // simPRO webhook payload: { ID, Type, Event, CompanyID, Data }
    return {
      provider: this.provider,
      event_type: (payload.Event as string) ?? 'unknown',
      resource_type: (payload.Type as string)?.toLowerCase() ?? 'unknown',
      resource_id: payload.ID ? String(payload.ID) : undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  /**
   * Parse composite access token "token|companyId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('simPRO adapter requires accessToken in format "token|companyId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  private mapCustomer(customer: Record<string, unknown>): Record<string, unknown> {
    const address = customer.Address as Record<string, unknown> | undefined;

    return {
      name: customer.CompanyName ?? customer.Name
        ?? `${customer.GivenName ?? ''} ${customer.FamilyName ?? ''}`.trim(),
      company_name: customer.CompanyName ?? null,
      email: customer.Email ?? null,
      phone: customer.Phone ?? customer.AltPhone ?? null,
      address: address
        ? {
            street: address.Address ?? '',
            city: address.City ?? '',
            state: address.State ?? '',
            zip: address.PostCode ?? '',
            country: address.Country ?? '',
          }
        : null,
      external_ids: { simpro: String(customer.ID) },
      source: 'simpro',
      metadata: {
        simpro_type: customer.Type,
        simpro_date_modified: customer.DateModified,
      },
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    const customer = job.Customer as Record<string, unknown> | undefined;
    const site = job.Site as Record<string, unknown> | undefined;

    return {
      title: job.Name ?? job.Description ?? '',
      job_number: job.JobNo ?? null,
      status: (job.Status as string)?.toLowerCase() ?? 'unknown',
      start_at: job.DateIssued ?? null,
      end_at: job.DateCompleted ?? null,
      total: job.Total ?? 0,
      customer_external_id: customer?.ID ? String(customer.ID) : null,
      address: site
        ? {
            street: site.Address ?? '',
            city: site.City ?? '',
            state: site.State ?? '',
            zip: site.PostCode ?? '',
          }
        : null,
      external_ids: { simpro: String(job.ID) },
      source: 'simpro',
      metadata: {
        simpro_status: job.Status,
        simpro_type: job.Type,
        simpro_date_modified: job.DateModified,
      },
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const customer = invoice.Customer as Record<string, unknown> | undefined;
    const lines = (invoice.Lines as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: invoice.InvoiceNo ?? null,
      status: (invoice.Status as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.Total ?? 0,
      balance_due: invoice.AmountDue ?? invoice.Total ?? 0,
      due_date: invoice.DueDate ?? null,
      issued_date: invoice.DateIssued ?? null,
      customer_external_id: customer?.ID ? String(customer.ID) : null,
      line_items: lines.map((li) => ({
        description: li.Description ?? '',
        quantity: li.Quantity ?? 1,
        unit_price: li.UnitCost ?? 0,
        total: li.Total ?? 0,
      })),
      external_ids: { simpro: String(invoice.ID) },
      source: 'simpro',
      metadata: {
        simpro_status: invoice.Status,
        simpro_date_modified: invoice.DateModified,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new SimproAdapter();
registerAdapter(adapter);
export default adapter;
