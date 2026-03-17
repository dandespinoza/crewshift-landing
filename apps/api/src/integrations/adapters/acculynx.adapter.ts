/**
 * AccuLynx Integration Adapter
 *
 * Native (Tier 2) adapter for AccuLynx roofing & exterior contractor CRM.
 * Handles API key auth, customer/job/invoice sync via REST API, and webhooks.
 *
 * AccuLynx API Reference:
 * - REST: https://api.acculynx.com/api/v2/docs
 *
 * Key details:
 * - Bearer token (API key) authentication
 * - No OAuth flow -- uses static API key
 * - REST API v2 with pagination
 * - Specializes in roofing & exterior contracting
 * - Rate limit: 30 requests per second
 * - Webhook verification: Bearer token verification
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

const ACCULYNX_API_BASE = 'https://api.acculynx.com/api/v2';
const ACCULYNX_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the AccuLynx API using Bearer token.
 */
async function acculynxFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${ACCULYNX_API_BASE}${path}`;

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
      'AccuLynx API error',
    );
    throw new Error(`AccuLynx API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through an AccuLynx collection endpoint.
 */
async function acculynxFetchAll(
  path: string,
  apiKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const paginatedPath = `${path}${separator}page=${page}&pageSize=${ACCULYNX_PAGE_SIZE}`;
    const response = await acculynxFetch(paginatedPath, apiKey);
    const body = (await response.json()) as Record<string, unknown>;

    // AccuLynx may return data in a "data" or "results" wrapper
    const data = (body.data as Record<string, unknown>[])
      ?? (body.results as Record<string, unknown>[])
      ?? [];
    const items = Array.isArray(data) ? data : [];

    if (items.length === 0) {
      hasMore = false;
    } else {
      results.push(...items);
      page++;
      if (items.length < ACCULYNX_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class AccuLynxAdapter extends BaseAdapter {
  readonly provider = 'acculynx' as const;
  readonly tier = 'native' as const;

  // -- OAuth (not applicable -- API key auth) ---------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('AccuLynx uses API key authentication -- no OAuth flow required');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('AccuLynx uses API key authentication -- no OAuth callback');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('AccuLynx uses API key authentication -- no token refresh');
  }

  // -- Sync: AccuLynx -> CrewShift --------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.ACCULYNX_API_KEY || '';
    const rawContacts = await acculynxFetchAll('/contacts', apiKey);

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
      'AccuLynx customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.ACCULYNX_API_KEY || '';
    const rawJobs = await acculynxFetchAll('/jobs', apiKey);

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
      'AccuLynx job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.ACCULYNX_API_KEY || '';
    const rawInvoices = await acculynxFetchAll('/invoices', apiKey);

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
      'AccuLynx invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> AccuLynx --------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || env.ACCULYNX_API_KEY || '';

    const acculynxInvoice = {
      contactId: invoiceData.customer_external_id ?? null,
      jobId: invoiceData.job_external_id ?? null,
      dueDate: invoiceData.due_date ?? null,
      invoiceNumber: invoiceData.invoice_number ?? null,
      description: invoiceData.description ?? '',
      lineItems: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        unitPrice: item.unit_price ?? 0,
      })) ?? [],
    };

    const response = await acculynxFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(acculynxInvoice),
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
    const apiKey = env.ACCULYNX_API_KEY;
    if (!apiKey) {
      logger.warn('No AccuLynx API key configured for webhook verification');
      return false;
    }

    // AccuLynx uses bearer token verification
    const hash = createHmac('sha256', apiKey)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // AccuLynx webhook payload: { eventType, resourceType, resourceId, data }
    return {
      provider: this.provider,
      event_type: (payload.eventType as string)
        ?? (payload.event_type as string)
        ?? 'unknown',
      resource_type: ((payload.resourceType as string)
        ?? (payload.resource_type as string)
        ?? 'unknown').toLowerCase(),
      resource_id: payload.resourceId
        ? String(payload.resourceId)
        : payload.resource_id
          ? String(payload.resource_id)
          : undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    const address = contact.address as Record<string, unknown> | undefined;

    return {
      name: contact.name
        ?? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim(),
      company_name: contact.companyName ?? null,
      email: contact.email ?? contact.emailAddress ?? null,
      phone: contact.phone ?? contact.phoneNumber ?? null,
      address: address
        ? {
            street: address.street ?? address.addressLine1 ?? '',
            city: address.city ?? '',
            state: address.state ?? '',
            zip: address.zipCode ?? address.postalCode ?? '',
            country: address.country ?? 'US',
          }
        : null,
      external_ids: { acculynx: String(contact.id) },
      source: 'acculynx',
      metadata: {
        acculynx_type: contact.type,
        acculynx_created_date: contact.createdDate,
        acculynx_modified_date: contact.modifiedDate,
      },
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    const contact = job.contact as Record<string, unknown> | undefined;
    const address = job.jobAddress as Record<string, unknown>
      ?? job.address as Record<string, unknown>
      ?? undefined;

    return {
      title: job.jobName ?? job.name ?? job.description ?? '',
      job_number: job.jobNumber ?? null,
      status: (job.status as string)?.toLowerCase()
        ?? (job.currentMilestone as string)?.toLowerCase()
        ?? 'unknown',
      start_at: job.startDate ?? job.createdDate ?? null,
      end_at: job.completionDate ?? null,
      total: job.contractAmount ?? job.totalAmount ?? 0,
      customer_external_id: contact?.id ? String(contact.id) : null,
      address: address
        ? {
            street: (address as Record<string, unknown>).street
              ?? (address as Record<string, unknown>).addressLine1 ?? '',
            city: (address as Record<string, unknown>).city ?? '',
            state: (address as Record<string, unknown>).state ?? '',
            zip: (address as Record<string, unknown>).zipCode ?? '',
          }
        : null,
      external_ids: { acculynx: String(job.id) },
      source: 'acculynx',
      metadata: {
        acculynx_milestone: job.currentMilestone,
        acculynx_trade_type: job.tradeType,
        acculynx_job_type: job.jobType,
        acculynx_created_date: job.createdDate,
      },
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (invoice.lineItems as Array<Record<string, unknown>>)
      ?? (invoice.line_items as Array<Record<string, unknown>>)
      ?? [];

    return {
      invoice_number: invoice.invoiceNumber ?? invoice.number ?? null,
      status: (invoice.status as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.totalAmount ?? invoice.total ?? 0,
      balance_due: invoice.balanceDue ?? invoice.amountDue ?? invoice.totalAmount ?? 0,
      due_date: invoice.dueDate ?? null,
      issued_date: invoice.invoiceDate ?? invoice.createdDate ?? null,
      customer_external_id: invoice.contactId ? String(invoice.contactId) : null,
      job_external_id: invoice.jobId ? String(invoice.jobId) : null,
      line_items: lineItems.map((li) => ({
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unit_price: li.unitPrice ?? li.unit_price ?? 0,
        total: li.total ?? li.totalPrice ?? 0,
      })),
      external_ids: { acculynx: String(invoice.id) },
      source: 'acculynx',
      metadata: {
        acculynx_status: invoice.status,
        acculynx_created_date: invoice.createdDate,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new AccuLynxAdapter();
registerAdapter(adapter);
export default adapter;
