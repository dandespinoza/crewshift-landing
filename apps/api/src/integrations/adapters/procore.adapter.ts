/**
 * Procore Integration Adapter
 *
 * Native (Tier 2) adapter for Procore construction management.
 * Handles OAuth2, company/project/invoice sync via REST API, and webhooks.
 *
 * Procore API Reference:
 * - Auth: https://developers.procore.com/documentation/oauth-introduction
 * - REST: https://developers.procore.com/reference/rest/v1
 * - Webhooks: https://developers.procore.com/documentation/webhooks
 *
 * Key details:
 * - OAuth 2.0 authentication
 * - REST API v1.0
 * - Procore uses "companies" for customers and "projects" for jobs
 * - Invoices live under projects as payment applications
 * - Rate limit: 3600 requests per hour
 * - Webhook verification: HMAC-SHA256
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

const PROCORE_AUTH_URL = 'https://login.procore.com/oauth/authorize';
const PROCORE_TOKEN_URL = 'https://login.procore.com/oauth/token';
const PROCORE_API_BASE = 'https://api.procore.com/rest/v1.0';
const PROCORE_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the Procore API.
 */
async function procoreFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${PROCORE_API_BASE}${path}`;

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
      'Procore API error',
    );
    throw new Error(`Procore API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Procore collection using page/per_page params.
 */
async function procoreFetchAll(
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}page=${page}&per_page=${PROCORE_PAGE_SIZE}`;
    const response = await procoreFetch(paginatedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>[];

    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
    } else {
      results.push(...data);
      page++;
      if (data.length < PROCORE_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class ProcoreAdapter extends BaseAdapter {
  readonly provider = 'procore' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.PROCORE_CLIENT_ID;
    if (!clientId) {
      throw new Error('PROCORE_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${PROCORE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.PROCORE_CLIENT_ID ?? '';
    const clientSecret = env.PROCORE_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/procore/callback`;

    const response = await fetch(PROCORE_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Procore token exchange failed');
      throw new Error(`Procore token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Procore');
    }

    const clientId = env.PROCORE_CLIENT_ID ?? '';
    const clientSecret = env.PROCORE_CLIENT_SECRET ?? '';

    const response = await fetch(PROCORE_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Procore token refresh failed');
      throw new Error(`Procore token refresh failed: ${response.status}`);
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

  // -- Sync: Procore -> CrewShift ---------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const rawCompanies = await procoreFetchAll('/companies', accessToken);

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
      'Procore customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Procore calls jobs "projects"
    const rawProjects = await procoreFetchAll('/projects', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const project of rawProjects) {
      try {
        records.push(this.mapProject(project));
        created++;
      } catch (err) {
        errors.push({ item: project, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: rawProjects.length, created, errors: errors.length },
      'Procore project sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Invoices in Procore are payment applications under projects.
    // First fetch all projects, then fetch payment applications for each.
    const projects = await procoreFetchAll('/projects', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const project of projects) {
      const projectId = project.id as string | number;
      if (!projectId) continue;

      try {
        const paymentApps = await procoreFetchAll(
          `/projects/${projectId}/prime_contract/payment_applications`,
          accessToken,
        );

        for (const app of paymentApps) {
          try {
            records.push(this.mapPaymentApplication(app, String(projectId)));
            created++;
          } catch (err) {
            errors.push({ item: app, error: (err as Error).message });
          }
        }
      } catch (err) {
        // Some projects may not have a prime contract -- skip them
        logger.debug(
          { projectId, error: (err as Error).message },
          'Skipping payment applications for project',
        );
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Procore invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.PROCORE_CLIENT_SECRET;
    if (!secret) {
      logger.warn('No Procore client secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Procore webhook payload: { resource_name, resource_id, event_type, metadata }
    return {
      provider: this.provider,
      event_type: (payload.event_type as string) ?? 'unknown',
      resource_type: (payload.resource_name as string)?.toLowerCase() ?? 'unknown',
      resource_id: payload.resource_id ? String(payload.resource_id) : undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  private mapCompany(company: Record<string, unknown>): Record<string, unknown> {
    return {
      name: company.name ?? '',
      company_name: company.name ?? null,
      email: company.email_address ?? null,
      phone: company.phone ?? null,
      address: {
        street: [company.address, company.address2].filter(Boolean).join(', '),
        city: company.city ?? '',
        state: company.state_code ?? '',
        zip: company.zip ?? '',
        country: company.country_code ?? 'US',
      },
      external_ids: { procore: String(company.id) },
      source: 'procore',
      metadata: {
        procore_is_active: company.is_active,
        procore_logo_url: company.logo_url,
        procore_created_at: company.created_at,
        procore_updated_at: company.updated_at,
      },
    };
  }

  private mapProject(project: Record<string, unknown>): Record<string, unknown> {
    const company = project.company as Record<string, unknown> | undefined;
    const address = project.address as Record<string, unknown> | undefined;

    return {
      title: project.name ?? project.display_name ?? '',
      job_number: project.project_number ?? project.code ?? null,
      status: (project.stage as string)?.toLowerCase()
        ?? (project.status_name as string)?.toLowerCase()
        ?? 'unknown',
      start_at: project.start_date ?? project.estimated_start_date ?? null,
      end_at: project.completion_date ?? project.projected_finish_date ?? null,
      total: project.total_value ?? project.estimated_value ?? 0,
      customer_external_id: company?.id ? String(company.id) : null,
      address: address
        ? {
            street: address.street ?? '',
            city: address.city ?? '',
            state: address.state_code ?? '',
            zip: address.zip ?? '',
            country: address.country_code ?? 'US',
          }
        : {
            street: project.address ?? '',
            city: project.city ?? '',
            state: project.state_code ?? '',
            zip: project.zip ?? '',
          },
      external_ids: { procore: String(project.id) },
      source: 'procore',
      metadata: {
        procore_stage: project.stage,
        procore_type: project.project_type,
        procore_created_at: project.created_at,
        procore_updated_at: project.updated_at,
      },
    };
  }

  private mapPaymentApplication(
    app: Record<string, unknown>,
    projectId: string,
  ): Record<string, unknown> {
    return {
      invoice_number: app.payment_application_number ?? app.number ?? null,
      status: (app.status as string)?.toLowerCase() ?? 'unknown',
      amount: app.amount ?? app.total ?? 0,
      balance_due: app.balance_to_finish ?? app.amount ?? 0,
      due_date: app.billing_date ?? null,
      issued_date: app.period_start ?? null,
      project_external_id: projectId,
      external_ids: { procore: String(app.id) },
      source: 'procore',
      metadata: {
        procore_status: app.status,
        procore_period_start: app.period_start,
        procore_period_end: app.period_end,
        procore_created_at: app.created_at,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new ProcoreAdapter();
registerAdapter(adapter);
export default adapter;
