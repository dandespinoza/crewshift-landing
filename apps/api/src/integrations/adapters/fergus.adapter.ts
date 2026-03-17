/**
 * Fergus Integration Adapter
 *
 * Native (Tier 2) adapter for Fergus job management platform.
 * Handles API key auth, customer/job/invoice sync via REST API, and webhooks.
 *
 * Fergus API Reference:
 * - REST: https://api.fergus.com/docs
 *
 * Key details:
 * - API Key authentication via Bearer token header
 * - No OAuth flow -- uses static API key
 * - REST API v2 with pagination
 * - Webhook verification: Signature-based verification
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

const FERGUS_API_BASE = 'https://api.fergus.com/api/v2';
const FERGUS_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the Fergus API using Bearer token.
 */
async function fergusFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${FERGUS_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Fergus API error',
    );
    throw new Error(`Fergus API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Fergus collection endpoint.
 */
async function fergusFetchAll(
  path: string,
  apiKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}page=${page}&per_page=${FERGUS_PAGE_SIZE}`;
    const response = await fergusFetch(paginatedPath, apiKey);
    const body = (await response.json()) as Record<string, unknown>;

    // Fergus may return data in a "data" or "items" wrapper
    const data = (body.data as Record<string, unknown>[])
      ?? (body.items as Record<string, unknown>[])
      ?? [];
    const items = Array.isArray(data) ? data : [];

    if (items.length === 0) {
      hasMore = false;
    } else {
      results.push(...items);
      page++;
      if (items.length < FERGUS_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class FergusAdapter extends BaseAdapter {
  readonly provider = 'fergus' as const;
  readonly tier = 'native' as const;

  // -- OAuth (not applicable -- API key auth) ---------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Fergus uses API key authentication -- no OAuth flow required');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Fergus uses API key authentication -- no OAuth callback');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Fergus uses API key authentication -- no token refresh');
  }

  // -- Sync: Fergus -> CrewShift ----------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.FERGUS_API_KEY || '';
    const rawContacts = await fergusFetchAll('/contacts', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const contact of rawContacts) {
      try {
        records.push(this.mapContact(contact));
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: rawContacts.length, created, errors: errors.length },
      'Fergus customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.FERGUS_API_KEY || '';
    const rawJobs = await fergusFetchAll('/jobs', apiKey);

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
      'Fergus job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.FERGUS_API_KEY || '';
    const rawInvoices = await fergusFetchAll('/invoices', apiKey);

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
      'Fergus invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> Fergus ----------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || env.FERGUS_API_KEY || '';

    const fergusInvoice = {
      contact_id: invoiceData.customer_external_id ?? null,
      job_id: invoiceData.job_external_id ?? null,
      due_date: invoiceData.due_date ?? null,
      reference: invoiceData.invoice_number ?? null,
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? 0,
      })) ?? [],
    };

    const response = await fergusFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(fergusInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const data = result.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      external_id: String(data?.id ?? result.id ?? ''),
    };
  }

  // -- Webhooks ---------------------------------------------------------------

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.FERGUS_API_KEY;
    if (!secret) {
      logger.warn('No Fergus API key configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Fergus webhook payload: { event, data: { id, type, ... } }
    const eventName = payload.event as string | undefined;
    const data = payload.data as Record<string, unknown> | undefined;

    // Event names are like "job.created", "contact.updated", "invoice.sent"
    const parts = (eventName ?? 'unknown.unknown').split('.');
    const resourceType = parts[0] ?? 'unknown';
    const eventType = parts[1] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.id ? String(data.id) : undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    const address = contact.address as Record<string, unknown> | undefined;

    return {
      name: contact.name
        ?? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
      company_name: contact.company_name ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? contact.mobile ?? null,
      address: address
        ? {
            street: address.street ?? address.address_line_1 ?? '',
            city: address.city ?? '',
            state: address.region ?? address.state ?? '',
            zip: address.post_code ?? address.postal_code ?? '',
            country: address.country ?? 'NZ',
          }
        : null,
      external_ids: { fergus: String(contact.id) },
      source: 'fergus',
      metadata: {
        fergus_type: contact.type,
        fergus_created_at: contact.created_at,
        fergus_updated_at: contact.updated_at,
      },
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    const contact = job.contact as Record<string, unknown> | undefined;
    const site = job.site as Record<string, unknown> | undefined;

    return {
      title: job.description ?? job.brief_description ?? '',
      job_number: job.job_number ?? job.reference ?? null,
      status: (job.status as string)?.toLowerCase() ?? 'unknown',
      start_at: job.start_date ?? job.scheduled_date ?? null,
      end_at: job.end_date ?? job.completed_date ?? null,
      total: job.total ?? job.quoted_total ?? 0,
      customer_external_id: contact?.id ? String(contact.id) : null,
      address: site
        ? {
            street: site.address ?? site.street ?? '',
            city: site.city ?? '',
            state: site.region ?? '',
            zip: site.post_code ?? '',
          }
        : null,
      external_ids: { fergus: String(job.id) },
      source: 'fergus',
      metadata: {
        fergus_status: job.status,
        fergus_priority: job.priority,
        fergus_created_at: job.created_at,
      },
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const contact = invoice.contact as Record<string, unknown> | undefined;
    const lineItems = (invoice.line_items as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: invoice.invoice_number ?? invoice.reference ?? null,
      status: (invoice.status as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.total ?? 0,
      balance_due: invoice.amount_due ?? invoice.total ?? 0,
      due_date: invoice.due_date ?? null,
      issued_date: invoice.invoice_date ?? invoice.created_at ?? null,
      customer_external_id: contact?.id ? String(contact.id) : null,
      line_items: lineItems.map((li) => ({
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unit_price: li.unit_price ?? 0,
        total: li.total ?? 0,
      })),
      external_ids: { fergus: String(invoice.id) },
      source: 'fergus',
      metadata: {
        fergus_status: invoice.status,
        fergus_created_at: invoice.created_at,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new FergusAdapter();
registerAdapter(adapter);
export default adapter;
