/**
 * ServiceM8 Integration Adapter
 *
 * Native (Tier 2) adapter for ServiceM8 field service management.
 * Handles OAuth2, customer/job/invoice sync via REST API, and webhooks.
 *
 * ServiceM8 API Reference:
 * - Auth: https://developer.servicem8.com/docs/platform-services/oauth
 * - REST: https://developer.servicem8.com/docs/rest-api
 * - Webhooks: https://developer.servicem8.com/docs/platform-services/webhooks
 *
 * Key details:
 * - REST API v1.0 with OData-style pagination ($top, $skip)
 * - Supports both API Key (Basic Auth) and OAuth 2.0
 * - Rate limit: 20,000 requests per day
 * - Webhook verification: Token-based verification
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

const SM8_AUTH_URL = 'https://go.servicem8.com/oauth/authorize';
const SM8_TOKEN_URL = 'https://go.servicem8.com/oauth/access_token';
const SM8_API_BASE = 'https://api.servicem8.com/api_1.0';
const SM8_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the ServiceM8 API.
 */
async function sm8Fetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SM8_API_BASE}${path}`;

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
      'ServiceM8 API error',
    );
    throw new Error(`ServiceM8 API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a ServiceM8 collection endpoint using OData-style $top/$skip.
 */
async function sm8FetchAll(
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}$top=${SM8_PAGE_SIZE}&$skip=${skip}`;
    const response = await sm8Fetch(paginatedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>[];

    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
    } else {
      results.push(...data);
      skip += SM8_PAGE_SIZE;
      if (data.length < SM8_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class ServiceM8Adapter extends BaseAdapter {
  readonly provider = 'servicem8' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.SERVICEM8_CLIENT_ID;
    if (!clientId) {
      throw new Error('SERVICEM8_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${SM8_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.SERVICEM8_CLIENT_ID ?? '';
    const clientSecret = env.SERVICEM8_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/servicem8/callback`;

    const response = await fetch(SM8_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'ServiceM8 token exchange failed');
      throw new Error(`ServiceM8 token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for ServiceM8');
    }

    const clientId = env.SERVICEM8_CLIENT_ID ?? '';
    const clientSecret = env.SERVICEM8_CLIENT_SECRET ?? '';

    const response = await fetch(SM8_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'ServiceM8 token refresh failed');
      throw new Error(`ServiceM8 token refresh failed: ${response.status}`);
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

  // -- Sync: ServiceM8 -> CrewShift -------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const rawCompanies = await sm8FetchAll('/company.json', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const company of rawCompanies) {
      try {
        records.push(this.mapCompany(company));
        created++;
      } catch (err) {
        errors.push({ item: company, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: rawCompanies.length, created, errors: errors.length },
      'ServiceM8 customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const rawJobs = await sm8FetchAll('/job.json', accessToken);

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
      'ServiceM8 job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const rawInvoices = await sm8FetchAll('/invoice.json', accessToken);

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
      'ServiceM8 invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> ServiceM8 -------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const sm8Invoice = {
      job_uuid: invoiceData.job_external_id ?? null,
      company_uuid: invoiceData.customer_external_id ?? null,
      due_date: invoiceData.due_date ?? null,
      total_amount: invoiceData.amount ?? 0,
      status: 'Draft',
    };

    const response = await sm8Fetch('/invoice.json', accessToken, {
      method: 'POST',
      body: JSON.stringify(sm8Invoice),
    });

    // ServiceM8 returns the UUID in the x-record-uuid header
    const uuid = response.headers.get('x-record-uuid');
    if (!uuid) {
      const body = (await response.json()) as Record<string, unknown>;
      return {
        provider: this.provider,
        external_id: String(body.uuid ?? body.id ?? ''),
      };
    }

    return {
      provider: this.provider,
      external_id: uuid,
    };
  }

  // -- Webhooks ---------------------------------------------------------------

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.SERVICEM8_CLIENT_SECRET;
    if (!secret) {
      logger.warn('No ServiceM8 client secret configured for webhook verification');
      return false;
    }

    // ServiceM8 uses a token-based verification -- the signature is matched against
    // the registered webhook token
    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // ServiceM8 webhook payload: { entry: [{ uuid, type, time, object }] }
    const entries = payload.entry as Array<Record<string, unknown>> | undefined;
    const firstEntry = entries?.[0];

    return {
      provider: this.provider,
      event_type: (firstEntry?.type as string) ?? 'unknown',
      resource_type: (firstEntry?.object as string)?.toLowerCase() ?? 'unknown',
      resource_id: firstEntry?.uuid as string | undefined,
      data: payload,
      timestamp: (firstEntry?.time as string) ?? new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  private mapCompany(company: Record<string, unknown>): Record<string, unknown> {
    return {
      name: company.name ?? company.company_name ?? '',
      company_name: company.company_name ?? company.name ?? null,
      email: company.email ?? null,
      phone: company.phone ?? company.mobile ?? null,
      address: {
        street: [company.address_street, company.address_street2].filter(Boolean).join(', '),
        city: company.address_city ?? '',
        state: company.address_state ?? '',
        zip: company.address_postcode ?? '',
        country: company.address_country ?? '',
      },
      external_ids: { servicem8: String(company.uuid) },
      source: 'servicem8',
      metadata: {
        sm8_active: company.active,
        sm8_edit_date: company.edit_date,
      },
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    return {
      title: job.generated_job_description ?? job.job_description ?? '',
      job_number: job.generated_job_id ?? null,
      status: (job.status as string)?.toLowerCase() ?? 'unknown',
      start_at: job.date ?? null,
      end_at: job.completion_date ?? null,
      total: job.total_amount ?? 0,
      customer_external_id: job.company_uuid ? String(job.company_uuid) : null,
      address: {
        street: job.job_address ?? '',
        city: job.job_city ?? '',
        state: job.job_state ?? '',
        zip: job.job_postcode ?? '',
        country: job.job_country ?? '',
      },
      external_ids: { servicem8: String(job.uuid) },
      source: 'servicem8',
      metadata: {
        sm8_status: job.status,
        sm8_category_uuid: job.category_uuid,
        sm8_edit_date: job.edit_date,
      },
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    return {
      invoice_number: invoice.invoice_number ?? null,
      status: (invoice.status as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.total_amount ?? 0,
      balance_due: invoice.amount_owing ?? invoice.total_amount ?? 0,
      due_date: invoice.due_date ?? null,
      issued_date: invoice.invoice_date ?? null,
      customer_external_id: invoice.company_uuid ? String(invoice.company_uuid) : null,
      job_external_id: invoice.job_uuid ? String(invoice.job_uuid) : null,
      external_ids: { servicem8: String(invoice.uuid) },
      source: 'servicem8',
      metadata: {
        sm8_status: invoice.status,
        sm8_edit_date: invoice.edit_date,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new ServiceM8Adapter();
registerAdapter(adapter);
export default adapter;
