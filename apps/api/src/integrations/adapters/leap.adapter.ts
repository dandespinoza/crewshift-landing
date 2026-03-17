/**
 * Leap Integration Adapter
 *
 * Tier 3 (native) adapter for Leap (LeapToDigital) — home improvement sales platform.
 * Handles Bearer token auth, contact/job/invoice sync, and token-based webhook verification.
 *
 * Leap API Reference:
 * - API Base: https://api.leaptodigital.com/v1
 * - Auth: Bearer token in Authorization header
 *
 * Key details:
 * - Developer application approval required — contact support to enable API access
 * - No OAuth flow — Bearer token authentication
 * - syncCustomers: GET /contacts
 * - syncJobs: GET /jobs (home improvement sales/jobs)
 * - syncInvoices: GET /invoices
 * - Webhook verification via token comparison
 * - Env: LEAP_API_TOKEN
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

const API_BASE = 'https://api.leaptodigital.com/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = process.env.LEAP_API_TOKEN ?? (env as Record<string, unknown>).LEAP_API_TOKEN as string | undefined;
  if (!token) throw new Error('LEAP_API_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the Leap API.
 */
async function leapFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Leap API error',
    );
    throw new Error(`Leap API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Leap list endpoints using page-based pagination.
 */
async function leapPaginateAll(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const searchParams = new URLSearchParams({
      per_page: String(DEFAULT_PAGE_SIZE),
      page: String(page),
      ...params,
    });

    const response = await leapFetch(
      `${path}?${searchParams.toString()}`,
      token,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? [];

    results.push(...items);

    const meta = data.meta as Record<string, unknown> | undefined;
    const lastPage = meta?.last_page as number | undefined;
    hasMore = lastPage ? page < lastPage : items.length === DEFAULT_PAGE_SIZE;
    page++;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class LeapAdapter extends BaseAdapter {
  readonly provider = 'leap' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — Bearer token auth) ─────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Leap uses Bearer token authentication, not OAuth. Configure LEAP_API_TOKEN instead. Contact Leap support to enable API access.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Leap uses Bearer token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Leap uses Bearer token authentication. Tokens do not expire through OAuth refresh.');
  }

  // ── Sync: Leap → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();
    const contacts = await leapPaginateAll('/contacts', token);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const contact of contacts) {
      try {
        const mapped = this.mapContact(contact);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: contacts.length, created, errors: errors.length },
      'Leap contact sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();
    const jobs = await leapPaginateAll('/jobs', token);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const job of jobs) {
      try {
        const mapped = this.mapJob(job);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Leap job sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();
    const invoices = await leapPaginateAll('/invoices', token);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of invoices) {
      try {
        const mapped = this.mapInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Leap invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  /**
   * Verify webhook by comparing the provided token against the stored API token.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const token = process.env.LEAP_API_TOKEN ?? (env as Record<string, unknown>).LEAP_API_TOKEN as string | undefined;
    if (!token) {
      logger.warn('No Leap API token configured for webhook verification');
      return false;
    }

    return signature === token;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    // Derive resource type from event type (e.g., "job.updated" -> "job")
    const resourceType = eventType.includes('.')
      ? eventType.split('.')[0]
      : (payload.resource_type as string) ?? 'job';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (data?.id as string) ?? (payload.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Leap Contact to CrewShift's unified customer format.
   */
  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    const address = contact.address as Record<string, unknown> | undefined;

    return {
      name: (`${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || (contact.name as string)) ?? null,
      company_name: (contact.company_name as string) ?? null,
      email: (contact.email as string) ?? null,
      phone: (contact.phone as string) ?? (contact.phone_number as string) ?? null,
      address: address
        ? {
            street: (address.street as string) ?? (address.line_1 as string) ?? '',
            city: (address.city as string) ?? '',
            state: (address.state as string) ?? '',
            zip: (address.zip as string) ?? (address.postal_code as string) ?? '',
          }
        : null,
      external_ids: { leap: String(contact.id) },
      source: 'leap',
      metadata: {
        leap_type: contact.type,
        leap_status: contact.status,
        leap_created_at: contact.created_at,
        leap_updated_at: contact.updated_at,
      },
    };
  }

  /**
   * Map a Leap Job to CrewShift's unified job format.
   */
  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (job.name as string) ?? (job.title as string) ?? null,
      description: (job.description as string) ?? (job.notes as string) ?? null,
      status: (job.status as string) ?? 'unknown',
      scheduled_start: (job.appointment_date as string) ?? (job.start_date as string) ?? null,
      scheduled_end: (job.end_date as string) ?? null,
      customer_external_id: job.contact_id ? String(job.contact_id) : null,
      external_ids: { leap: String(job.id) },
      source: 'leap',
      metadata: {
        leap_trade: job.trade,
        leap_stage: job.stage,
        leap_salesperson_id: job.salesperson_id,
        leap_contract_amount: job.contract_amount,
        leap_created_at: job.created_at,
        leap_updated_at: job.updated_at,
      },
    };
  }

  /**
   * Map a Leap Invoice to CrewShift's unified invoice format.
   */
  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (invoice.line_items as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: (invoice.number as string) ?? (invoice.invoice_number as string) ?? String(invoice.id),
      status: (invoice.status as string) ?? 'unknown',
      amount: (invoice.total as number) ?? (invoice.amount as number) ?? 0,
      balance_due: (invoice.balance as number) ?? (invoice.amount_due as number) ?? 0,
      due_date: (invoice.due_date as string) ?? null,
      issued_date: (invoice.invoice_date as string) ?? (invoice.created_at as string) ?? null,
      customer_external_id: invoice.contact_id ? String(invoice.contact_id) : null,
      external_ids: { leap: String(invoice.id) },
      line_items: lineItems.map((item) => ({
        description: (item.description as string) ?? '',
        quantity: (item.quantity as number) ?? 1,
        unit_price: (item.unit_price as number) ?? (item.price as number) ?? 0,
        total: (item.total as number) ?? 0,
      })),
      source: 'leap',
      metadata: {
        leap_job_id: invoice.job_id,
        leap_created_at: invoice.created_at,
        leap_updated_at: invoice.updated_at,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new LeapAdapter();
registerAdapter(adapter);
export default adapter;
