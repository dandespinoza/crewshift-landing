/**
 * Zoho Books Integration Adapter
 *
 * Native (Tier 1) adapter for Zoho Books accounting.
 * Handles OAuth2, customer/invoice sync, invoice creation, and webhooks.
 *
 * Zoho Books API Reference:
 * - Auth: https://www.zoho.com/accounts/protocol/oauth.html
 * - API: https://www.zoho.com/books/api/v3/
 * - Webhooks: https://www.zoho.com/books/api/v3/webhooks/
 *
 * Key details:
 * - OAuth2 with scope ZohoBooks.fullaccess.all
 * - access_type=offline for refresh token (Zoho refresh tokens never expire)
 * - organization_id is required as query parameter on all API calls
 * - After auth, GET /organizations to discover organization_id
 * - Rate limit: 100 requests/minute
 * - Paginated with page/per_page params (max 200 per page)
 * - Webhook verification via webhook token
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

const ZOHO_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth';
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
const ZOHO_API_BASE = 'https://books.zoho.com/api/v3';
const ZOHO_SCOPES = 'ZohoBooks.fullaccess.all';
const ZOHO_PAGE_SIZE = 200;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch the organization_id from the Zoho Books /organizations endpoint.
 * The organization_id is required on every API call.
 */
async function fetchOrganizationId(accessToken: string): Promise<string> {
  const response = await fetch(`${ZOHO_API_BASE}/organizations`, {
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, errorBody }, 'Zoho organizations fetch failed');
    throw new Error(`Zoho organizations fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const organizations = data.organizations as Array<Record<string, unknown>> | undefined;

  if (!organizations || organizations.length === 0) {
    throw new Error('No Zoho Books organizations found for this user');
  }

  // Prefer the first active organization
  const activeOrg = organizations.find((o) => o.is_default_org === true) ?? organizations[0];
  const orgId = activeOrg.organization_id as string;

  if (!orgId) {
    throw new Error('Could not extract organization_id from Zoho organizations response');
  }

  logger.info({ organizationId: orgId, name: activeOrg.name }, 'Zoho organization selected');
  return orgId;
}

/**
 * Make an authenticated request to the Zoho Books API.
 * Automatically appends organization_id query parameter.
 */
async function zohoFetch(
  path: string,
  accessToken: string,
  organizationId: string,
  options: RequestInit = {},
): Promise<Response> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${ZOHO_API_BASE}/${path}${separator}organization_id=${organizationId}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, organizationId, errorBody },
      'Zoho Books API error',
    );
    throw new Error(`Zoho Books API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Zoho Books list endpoint.
 * Zoho uses page & per_page query parameters; has_more_page in the response.
 */
async function zohoFetchAllPages(
  path: string,
  accessToken: string,
  organizationId: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&per_page=${ZOHO_PAGE_SIZE}`;

    const response = await zohoFetch(pagedPath, accessToken, organizationId);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? [];

    results.push(...items);

    // Check pagination
    const pageContext = data.page_context as Record<string, unknown> | undefined;
    if (pageContext?.has_more_page) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ZohoBooksAdapter extends BaseAdapter {
  readonly provider = 'zoho-books' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.ZOHO_CLIENT_ID;
    if (!clientId) {
      throw new Error('ZOHO_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: ZOHO_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: orgId,
    });

    return `${ZOHO_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.ZOHO_CLIENT_ID ?? '';
    const clientSecret = env.ZOHO_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/zoho-books/callback`;

    const response = await fetch(ZOHO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
      logger.error({ status: response.status, errorBody }, 'Zoho Books token exchange failed');
      throw new Error(`Zoho Books token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Fetch the organization_id immediately after token exchange
    const organizationId = await fetchOrganizationId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${organizationId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Zoho Books');
    }

    const clientId = env.ZOHO_CLIENT_ID ?? '';
    const clientSecret = env.ZOHO_CLIENT_SECRET ?? '';

    // Zoho refresh tokens never expire — no need for re-authorization
    const response = await fetch(ZOHO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
      logger.error({ status: response.status, errorBody }, 'Zoho Books token refresh failed');
      throw new Error(`Zoho Books token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Re-fetch organization_id with fresh token
    const organizationId = await fetchOrganizationId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${organizationId}`,
      // Zoho does not return a new refresh token on refresh — keep the existing one
      refresh_token: (tokens.refresh_token as string) ?? currentTokens.refresh_token,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Zoho Books → CrewShift ───────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, organizationId] = this.parseAccessToken(accessToken);

    const zohoContacts = await zohoFetchAllPages(
      'contacts',
      token,
      organizationId,
      'contacts',
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const contact of zohoContacts) {
      try {
        const mapped = this.mapZohoContact(contact);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: zohoContacts.length, created, errors: errors.length },
      'Zoho Books customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, organizationId] = this.parseAccessToken(accessToken);

    const zohoInvoices = await zohoFetchAllPages(
      'invoices',
      token,
      organizationId,
      'invoices',
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of zohoInvoices) {
      try {
        const mapped = this.mapZohoInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: zohoInvoices.length, created, errors: errors.length },
      'Zoho Books invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Zoho Books ─────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, organizationId] = this.parseAccessToken(accessToken);

    const zohoInvoice = {
      customer_id: invoiceData.customer_external_id,
      date: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
      due_date: invoiceData.due_date,
      invoice_number: invoiceData.invoice_number ?? undefined,
      reference_number: invoiceData.reference_number ?? undefined,
      notes: invoiceData.notes ?? '',
      terms: invoiceData.terms ?? '',
      line_items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        name: item.description ?? 'Service',
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        rate: item.unit_price ?? 0,
        item_id: item.item_id ?? undefined,
        tax_id: item.tax_id ?? undefined,
      })) ?? [],
      is_inclusive_tax: invoiceData.is_inclusive_tax ?? false,
    };

    const response = await zohoFetch('invoices', token, organizationId, {
      method: 'POST',
      body: JSON.stringify(zohoInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const invoice = result.invoice as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(invoice.invoice_id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  /**
   * Verify a Zoho Books webhook.
   * Zoho uses a webhook token for verification. The token is sent as a query
   * parameter during webhook registration handshake. For incoming payloads,
   * Zoho includes a signature based on the webhook's configured token.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.ZOHO_CLIENT_SECRET;
    if (!secret) {
      logger.warn('No Zoho client secret configured for webhook verification');
      return false;
    }

    // Zoho sends the webhook token in the payload for verification
    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Zoho Books webhook payload structure:
    // { event_type: "invoice.created", data: { invoice: { ... } } }
    const eventTypeRaw = (payload.event_type as string) ?? 'unknown';
    const parts = eventTypeRaw.split('.');
    const resourceType = parts[0] ?? 'unknown';
    const eventType = parts[1] ?? 'unknown';

    // Extract resource ID from data based on resource type
    const data = payload.data as Record<string, unknown> | undefined;
    let resourceId: string | undefined;

    if (data) {
      const resource = data[resourceType] as Record<string, unknown> | undefined;
      if (resource) {
        resourceId = String(resource[`${resourceType}_id`] ?? resource.id ?? '');
      }
    }

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId || undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|organizationId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('Zoho Books adapter requires accessToken in format "token|organizationId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  /**
   * Map a Zoho Books Contact to CrewShift's unified customer format.
   */
  private mapZohoContact(contact: Record<string, unknown>): Record<string, unknown> {
    const billingAddr = contact.billing_address as Record<string, unknown> | undefined;

    return {
      name: contact.contact_name as string ?? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
      company_name: contact.company_name as string ?? null,
      email: contact.email as string ?? null,
      phone: (contact.phone as string) || (contact.mobile as string) || null,
      address: billingAddr
        ? {
            street: [billingAddr.street, billingAddr.street2].filter(Boolean).join(', '),
            city: billingAddr.city ?? '',
            state: billingAddr.state ?? '',
            zip: billingAddr.zip ?? '',
            country: billingAddr.country ?? '',
          }
        : null,
      external_ids: { 'zoho-books': String(contact.contact_id) },
      source: 'zoho-books',
      metadata: {
        zoho_contact_type: contact.contact_type,
        zoho_status: contact.status,
        zoho_currency_code: contact.currency_code,
        zoho_outstanding_receivable_amount: contact.outstanding_receivable_amount,
        zoho_last_modified_time: contact.last_modified_time,
      },
    };
  }

  /**
   * Map a Zoho Books Invoice to CrewShift's unified invoice format.
   */
  private mapZohoInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (invoice.line_items as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: invoice.invoice_number as string ?? null,
      status: this.mapZohoInvoiceStatus(invoice.status as string),
      amount: invoice.total ?? 0,
      balance_due: invoice.balance ?? 0,
      due_date: invoice.due_date as string ?? null,
      issued_date: invoice.date as string ?? null,
      customer_external_id: invoice.customer_id ? String(invoice.customer_id) : null,
      external_ids: { 'zoho-books': String(invoice.invoice_id) },
      line_items: lineItems.map((line) => ({
        description: line.description ?? line.name ?? '',
        quantity: line.quantity ?? 1,
        unit_price: line.rate ?? 0,
        total: line.item_total ?? 0,
        item_id: line.item_id ?? null,
      })),
      source: 'zoho-books',
      metadata: {
        zoho_reference_number: invoice.reference_number,
        zoho_currency_code: invoice.currency_code,
        zoho_payment_terms: invoice.payment_terms,
        zoho_last_modified_time: invoice.last_modified_time,
        zoho_is_emailed: invoice.is_emailed,
      },
    };
  }

  /**
   * Map Zoho Books invoice status to CrewShift status.
   */
  private mapZohoInvoiceStatus(zohoStatus: string): string {
    switch (zohoStatus) {
      case 'paid': return 'paid';
      case 'partially_paid': return 'partial';
      case 'overdue': return 'overdue';
      case 'sent': return 'sent';
      case 'viewed': return 'sent';
      case 'draft': return 'draft';
      case 'void': return 'voided';
      default: return 'draft';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const zohoBooksAdapter = new ZohoBooksAdapter();
registerAdapter(zohoBooksAdapter);
export default zohoBooksAdapter;
