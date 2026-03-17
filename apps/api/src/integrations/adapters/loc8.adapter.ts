/**
 * Loc8 Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for Loc8.
 * Handles API Key auth and customer/job sync.
 *
 * Loc8 API Reference:
 * - API Base: https://api.loc8.com/v1
 *
 * Key details:
 * - API Key authentication
 * - Customer sync via GET /customers
 * - Job sync via GET /jobs
 * - No webhooks
 * - NOTE: API-driven but no public documentation — contact Loc8 directly
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

const LOC8_API_BASE = 'https://api.loc8.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.LOC8_API_KEY;
  if (!key) throw new Error('LOC8_API_KEY is not configured — contact Loc8 directly for API access');
  return key;
}

/**
 * Make an authenticated request to the Loc8 API.
 */
async function loc8Fetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${LOC8_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Loc8 API error',
    );
    throw new Error(`Loc8 API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class Loc8Adapter extends BaseAdapter {
  readonly provider = 'loc8' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Loc8 uses API Key authentication, not OAuth. Configure LOC8_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Loc8 uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Loc8 uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Loc8 → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await loc8Fetch('/customers', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const customers = (data.customers as Record<string, unknown>[]) ??
      (data.data as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: cust.name ?? (`${cust.firstName ?? ''} ${cust.lastName ?? ''}`.trim() || null),
          company_name: cust.companyName ?? null,
          email: cust.email ?? null,
          phone: cust.phone ?? null,
          address: cust.address
            ? {
                street: (cust.address as Record<string, unknown>).street ?? '',
                city: (cust.address as Record<string, unknown>).city ?? '',
                state: (cust.address as Record<string, unknown>).state ?? '',
                zip: (cust.address as Record<string, unknown>).postcode ?? '',
              }
            : null,
          external_ids: { loc8: String(cust.id) },
          source: 'loc8',
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'Loc8 customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await loc8Fetch('/jobs', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const jobs = (data.jobs as Record<string, unknown>[]) ??
      (data.data as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: job.title ?? job.description ?? null,
          status: job.status ?? null,
          scheduled_start: job.scheduledStart ?? job.startDate ?? null,
          scheduled_end: job.scheduledEnd ?? job.endDate ?? null,
          customer_external_id: job.customerId ? String(job.customerId) : null,
          external_ids: { loc8: String(job.id) },
          source: 'loc8',
          metadata: {
            loc8_job_type: job.jobType,
            loc8_priority: job.priority,
            loc8_assigned_to: job.assignedTo,
            loc8_location: job.location,
            loc8_asset: job.assetId,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Loc8 job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new Loc8Adapter();
registerAdapter(adapter);
export default adapter;
