/**
 * BuildOps Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for BuildOps.
 * Handles OAuth2, customer/job/invoice sync.
 *
 * BuildOps API Reference:
 * - API Base: https://api.buildops.com/v1
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - Customer sync via GET /customers
 * - Job sync via GET /jobs
 * - Invoice sync via GET /invoices
 * - NOTE: Contact BuildOps for API access
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

const BUILDOPS_API_BASE = 'https://api.buildops.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.BUILDOPS_CLIENT_ID;
  if (!id) throw new Error('BUILDOPS_CLIENT_ID is not configured — contact BuildOps for API access');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.BUILDOPS_CLIENT_SECRET;
  if (!secret) throw new Error('BUILDOPS_CLIENT_SECRET is not configured — contact BuildOps for API access');
  return secret;
}

/**
 * Make an authenticated request to the BuildOps API.
 */
async function buildopsFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BUILDOPS_API_BASE}${path}`;

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
      'BuildOps API error',
    );
    throw new Error(`BuildOps API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class BuildOpsAdapter extends BaseAdapter {
  readonly provider = 'buildops' as const;
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

    return `https://app.buildops.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(`${BUILDOPS_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/buildops/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'BuildOps token exchange failed');
      throw new Error(`BuildOps token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for BuildOps');
    }

    const response = await fetch(`${BUILDOPS_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'BuildOps token refresh failed');
      throw new Error(`BuildOps token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  // ── Sync: BuildOps → CrewShift ──────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await buildopsFetch('/customers', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const customers = (data.customers as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: cust.name ?? null,
          company_name: cust.companyName ?? null,
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
          external_ids: { buildops: String(cust.id) },
          source: 'buildops',
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'BuildOps customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await buildopsFetch('/jobs', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const jobs = (data.jobs as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: job.title ?? job.jobNumber ?? null,
          status: job.status ?? null,
          scheduled_start: job.scheduledStart ?? null,
          scheduled_end: job.scheduledEnd ?? null,
          customer_external_id: job.customerId ? String(job.customerId) : null,
          external_ids: { buildops: String(job.id) },
          source: 'buildops',
          metadata: {
            buildops_job_number: job.jobNumber,
            buildops_job_type: job.jobType,
            buildops_priority: job.priority,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'BuildOps job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await buildopsFetch('/invoices', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const invoices = (data.invoices as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const inv of invoices) {
      try {
        records.push({
          invoice_number: inv.invoiceNumber ?? null,
          status: inv.status ?? null,
          amount: inv.total ?? 0,
          balance_due: inv.balanceDue ?? 0,
          due_date: inv.dueDate ?? null,
          issued_date: inv.invoiceDate ?? null,
          customer_external_id: inv.customerId ? String(inv.customerId) : null,
          external_ids: { buildops: String(inv.id) },
          source: 'buildops',
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'BuildOps invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new BuildOpsAdapter();
registerAdapter(adapter);
export default adapter;
