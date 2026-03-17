/**
 * JobNimbus Integration Adapter
 *
 * Native (Tier 2) adapter for JobNimbus CRM and project management.
 * Handles API key auth, customer/job/invoice sync via REST API.
 *
 * JobNimbus API Reference:
 * - REST: https://documenter.getpostman.com/view/3919598/S11PpGCp
 *
 * Key details:
 * - Bearer token (API key) authentication
 * - No OAuth flow -- uses static API key
 * - REST API v1 with must/from/size pagination for contacts
 * - No webhook support -- polling-only integration
 */

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

const JOBNIMBUS_API_BASE = 'https://app.jobnimbus.com/api1';
const JOBNIMBUS_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the JobNimbus API using Bearer token.
 */
async function jnFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${JOBNIMBUS_API_BASE}${path}`;

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
      'JobNimbus API error',
    );
    throw new Error(`JobNimbus API error: ${response.status} -- ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a JobNimbus collection using from/size parameters.
 * JobNimbus uses Elasticsearch-style pagination: "from" (offset) and "size" (limit).
 * The "must" parameter can be used for filtering.
 */
async function jnFetchAll(
  path: string,
  apiKey: string,
  mustFilter?: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    let paginatedPath = `${path}${separator}from=${from}&size=${JOBNIMBUS_PAGE_SIZE}`;

    // Add must filter if provided (Elasticsearch query DSL)
    if (mustFilter) {
      paginatedPath += `&must=${encodeURIComponent(JSON.stringify(mustFilter))}`;
    }

    const response = await jnFetch(paginatedPath, apiKey);
    const body = (await response.json()) as Record<string, unknown>;

    // JobNimbus returns { results: [...], count: N }
    const data = (body.results as Record<string, unknown>[]) ?? [];
    const totalCount = body.count as number | undefined;

    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
    } else {
      results.push(...data);
      from += JOBNIMBUS_PAGE_SIZE;

      // Stop if we've fetched all records or got fewer than page size
      if (totalCount !== undefined && results.length >= totalCount) {
        hasMore = false;
      } else if (data.length < JOBNIMBUS_PAGE_SIZE) {
        hasMore = false;
      }
    }
  }

  return results;
}

// -- Adapter ------------------------------------------------------------------

class JobNimbusAdapter extends BaseAdapter {
  readonly provider = 'jobnimbus' as const;
  readonly tier = 'native' as const;

  // -- OAuth (not applicable -- API key auth) ---------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('JobNimbus uses API key authentication -- no OAuth flow required');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('JobNimbus uses API key authentication -- no OAuth callback');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('JobNimbus uses API key authentication -- no token refresh');
  }

  // -- Sync: JobNimbus -> CrewShift -------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.JOBNIMBUS_API_KEY || '';

    // JobNimbus contacts can be filtered by record_type_name = "Contact"
    const mustFilter = { record_type_name: 'Contact' };
    const rawContacts = await jnFetchAll('/contacts', apiKey, mustFilter);

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
      'JobNimbus customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.JOBNIMBUS_API_KEY || '';
    const rawJobs = await jnFetchAll('/jobs', apiKey);

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
      'JobNimbus job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || env.JOBNIMBUS_API_KEY || '';
    const rawInvoices = await jnFetchAll('/invoices', apiKey);

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
      'JobNimbus invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> JobNimbus -------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || env.JOBNIMBUS_API_KEY || '';

    const jnInvoice = {
      related: invoiceData.customer_external_id ?? null,
      parent_jnid: invoiceData.job_external_id ?? null,
      due_date: invoiceData.due_date
        ? Math.floor(new Date(invoiceData.due_date as string).getTime() / 1000)
        : null,
      number: invoiceData.invoice_number ?? null,
      description: invoiceData.description ?? '',
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        cost: item.unit_price ?? 0,
      })) ?? [],
    };

    const response = await jnFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify(jnInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.jnid ?? result.id ?? ''),
    };
  }

  // -- Webhooks (not supported) -----------------------------------------------

  /**
   * JobNimbus does not support webhooks.
   * This method always returns false.
   */
  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    logger.warn('JobNimbus does not support webhooks');
    return false;
  }

  /**
   * JobNimbus does not support webhooks.
   * This method always throws.
   */
  async processWebhook(_payload: Record<string, unknown>): Promise<WebhookEvent> {
    throw new Error('JobNimbus does not support webhooks -- use polling sync instead');
  }

  // -- Private Helpers --------------------------------------------------------

  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    return {
      name: contact.display_name
        ?? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
      company_name: contact.company ?? null,
      email: contact.email ?? null,
      phone: contact.home_phone ?? contact.mobile_phone ?? contact.work_phone ?? null,
      address: {
        street: [contact.address_line1, contact.address_line2].filter(Boolean).join(', '),
        city: contact.city ?? '',
        state: contact.state_text ?? '',
        zip: contact.zip ?? '',
        country: contact.country ?? 'US',
      },
      external_ids: { jobnimbus: String(contact.jnid ?? contact.id) },
      source: 'jobnimbus',
      metadata: {
        jn_record_type: contact.record_type_name,
        jn_status: contact.status_name,
        jn_source: contact.source_name,
        jn_created_date: contact.date_created
          ? new Date((contact.date_created as number) * 1000).toISOString()
          : null,
        jn_updated_date: contact.date_updated
          ? new Date((contact.date_updated as number) * 1000).toISOString()
          : null,
      },
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    const related = job.related as Record<string, unknown>[] | undefined;
    const primaryContact = related?.[0];

    return {
      title: job.name ?? job.description ?? '',
      job_number: job.number ?? null,
      status: (job.status_name as string)?.toLowerCase() ?? 'unknown',
      start_at: job.date_start
        ? new Date((job.date_start as number) * 1000).toISOString()
        : null,
      end_at: job.date_end
        ? new Date((job.date_end as number) * 1000).toISOString()
        : null,
      total: job.sales_rep_fee ?? job.approved_estimate_total ?? 0,
      customer_external_id: primaryContact?.jnid
        ? String(primaryContact.jnid)
        : null,
      address: {
        street: [job.address_line1, job.address_line2].filter(Boolean).join(', '),
        city: job.city ?? '',
        state: job.state_text ?? '',
        zip: job.zip ?? '',
      },
      external_ids: { jobnimbus: String(job.jnid ?? job.id) },
      source: 'jobnimbus',
      metadata: {
        jn_status: job.status_name,
        jn_record_type: job.record_type_name,
        jn_created_date: job.date_created
          ? new Date((job.date_created as number) * 1000).toISOString()
          : null,
      },
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (invoice.line_items as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: invoice.number ?? null,
      status: (invoice.status_name as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.total ?? 0,
      balance_due: invoice.balance ?? invoice.total ?? 0,
      due_date: invoice.due_date
        ? new Date((invoice.due_date as number) * 1000).toISOString()
        : null,
      issued_date: invoice.date_created
        ? new Date((invoice.date_created as number) * 1000).toISOString()
        : null,
      customer_external_id: invoice.related_jnid
        ? String(invoice.related_jnid)
        : null,
      job_external_id: invoice.parent_jnid
        ? String(invoice.parent_jnid)
        : null,
      line_items: lineItems.map((li) => ({
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unit_price: li.cost ?? li.unit_price ?? 0,
        total: li.total ?? 0,
      })),
      external_ids: { jobnimbus: String(invoice.jnid ?? invoice.id) },
      source: 'jobnimbus',
      metadata: {
        jn_status: invoice.status_name,
        jn_created_date: invoice.date_created
          ? new Date((invoice.date_created as number) * 1000).toISOString()
          : null,
      },
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new JobNimbusAdapter();
registerAdapter(adapter);
export default adapter;
