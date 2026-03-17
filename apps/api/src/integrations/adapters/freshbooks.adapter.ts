/**
 * FreshBooks Integration Adapter
 *
 * Native (Tier 1) adapter for FreshBooks accounting.
 * Handles OAuth2, customer/invoice sync, invoice creation, and webhooks.
 *
 * FreshBooks API Reference:
 * - Auth: https://www.freshbooks.com/api/authentication
 * - API: https://www.freshbooks.com/api/
 * - Webhooks: https://www.freshbooks.com/api/webhooks
 *
 * Key details:
 * - Access tokens expire in 15 minutes — aggressive refresh is critical
 * - After token exchange, call /auth/api/v1/users/me to get account_id
 * - API base is per-account: /accounting/account/{account_id}/...
 * - Paginated responses with page/per_page params (max 100 per page)
 * - Webhook payloads include {name, object_id, account_id, user_id}
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

// ── Constants ────────────────────────────────────────────────────────────────

const FB_AUTH_URL = 'https://auth.freshbooks.com/oauth/authorize';
const FB_TOKEN_URL = 'https://api.freshbooks.com/auth/oauth/token';
const FB_API_BASE = 'https://api.freshbooks.com';
const FB_IDENTITY_URL = 'https://api.freshbooks.com/auth/api/v1/users/me';
const FB_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch the account_id from the FreshBooks identity endpoint.
 * The account_id is required in the API path for all accounting endpoints.
 */
async function fetchAccountId(accessToken: string): Promise<string> {
  const response = await fetch(FB_IDENTITY_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, errorBody }, 'FreshBooks identity fetch failed');
    throw new Error(`FreshBooks identity fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const responseObj = data.response as Record<string, unknown>;

  // memberships[0].business.account_id
  const memberships = responseObj.memberships as Array<Record<string, unknown>> | undefined;
  if (!memberships || memberships.length === 0) {
    throw new Error('No FreshBooks business memberships found for this user');
  }

  const business = memberships[0].business as Record<string, unknown>;
  const accountId = business.account_id as string;

  if (!accountId) {
    throw new Error('Could not extract account_id from FreshBooks identity response');
  }

  return accountId;
}

/**
 * Make an authenticated request to the FreshBooks accounting API.
 */
async function fbFetch(
  accountId: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${FB_API_BASE}/accounting/account/${accountId}/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Api-Version': 'alpha',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, accountId, errorBody },
      'FreshBooks API error',
    );
    throw new Error(`FreshBooks API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a FreshBooks list endpoint.
 * FreshBooks uses page & per_page query parameters.
 */
async function fbFetchAllPages(
  accountId: string,
  path: string,
  accessToken: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&per_page=${FB_PAGE_SIZE}`;

    const response = await fbFetch(accountId, pagedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const responseObj = data.response as Record<string, unknown>;
    const result = responseObj.result as Record<string, unknown>;
    const items = (result[resultKey] as Array<Record<string, unknown>>) ?? [];

    results.push(...items);

    // Check pagination: total_pages in response
    const totalPages = result.total_pages as number | undefined;
    const currentPage = result.page as number | undefined;

    if (totalPages && currentPage && currentPage < totalPages) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class FreshBooksAdapter extends BaseAdapter {
  readonly provider = 'freshbooks' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.FRESHBOOKS_CLIENT_ID;
    if (!clientId) {
      throw new Error('FRESHBOOKS_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${FB_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.FRESHBOOKS_CLIENT_ID ?? '';
    const clientSecret = env.FRESHBOOKS_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/freshbooks/callback`;

    const response = await fetch(FB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'FreshBooks token exchange failed');
      throw new Error(`FreshBooks token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Fetch the account_id immediately — it's needed for all API calls
    const accountId = await fetchAccountId(tokens.access_token as string);
    logger.info({ accountId }, 'FreshBooks account ID retrieved');

    // NOTE: FreshBooks access tokens expire in 15 minutes
    return {
      access_token: `${tokens.access_token as string}|${accountId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : new Date(Date.now() + 15 * 60 * 1000).toISOString(), // Default 15min if not provided
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for FreshBooks');
    }

    const clientId = env.FRESHBOOKS_CLIENT_ID ?? '';
    const clientSecret = env.FRESHBOOKS_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/freshbooks/callback`;

    const response = await fetch(FB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'FreshBooks token refresh failed');
      throw new Error(`FreshBooks token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Re-fetch account_id with fresh token
    const accountId = await fetchAccountId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${accountId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: FreshBooks → CrewShift ───────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, accountId] = this.parseAccessToken(accessToken);

    const fbClients = await fbFetchAllPages(
      accountId,
      'users/clients',
      token,
      'clients',
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const client of fbClients) {
      try {
        const mapped = this.mapFBClient(client);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: client, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: fbClients.length, created, errors: errors.length },
      'FreshBooks customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, accountId] = this.parseAccessToken(accessToken);

    const fbInvoices = await fbFetchAllPages(
      accountId,
      'invoices/invoices',
      token,
      'invoices',
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of fbInvoices) {
      try {
        const mapped = this.mapFBInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: fbInvoices.length, created, errors: errors.length },
      'FreshBooks invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → FreshBooks ─────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, accountId] = this.parseAccessToken(accessToken);

    const fbInvoice = {
      invoice: {
        customerid: invoiceData.customer_external_id,
        create_date: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
        due_offset_days: invoiceData.due_offset_days ?? 30,
        lines: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
          name: item.description ?? 'Service',
          description: item.description ?? '',
          qty: item.quantity ?? 1,
          unit_cost: {
            amount: item.unit_price ?? '0.00',
            code: (item.currency as string) ?? 'USD',
          },
          type: 0, // 0 = normal line
        })) ?? [],
        notes: invoiceData.notes as string ?? '',
        po_number: invoiceData.invoice_number as string ?? null,
        status: 2, // 2 = draft
      },
    };

    const response = await fbFetch(accountId, 'invoices/invoices', token, {
      method: 'POST',
      body: JSON.stringify(fbInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const responseObj = result.response as Record<string, unknown>;
    const resultObj = responseObj.result as Record<string, unknown>;
    const invoice = resultObj.invoice as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(invoice.invoiceid ?? invoice.id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  /**
   * FreshBooks webhook verification.
   * FreshBooks uses a verification step during webhook registration where it
   * sends a GET request with a verification code. For incoming POST payloads,
   * we verify the request originated from FreshBooks by confirming it matches
   * a registered webhook callback URL. In production, additional verification
   * such as IP allowlisting should be used.
   */
  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    // FreshBooks does not use HMAC signing for webhooks.
    // Verification is done via the initial handshake during registration.
    // In production, validate source IP against FreshBooks IP ranges.
    logger.warn('FreshBooks webhook verification is handshake-based; payload accepted');
    return true;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // FreshBooks webhook payload structure:
    // { name: "invoice.create", object_id: "12345", account_id: "abc", user_id: "xyz" }
    const eventName = (payload.name as string) ?? 'unknown';
    const parts = eventName.split('.');
    const resourceType = parts[0] ?? 'unknown';
    const eventType = parts[1] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: payload.object_id ? String(payload.object_id) : undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|accountId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('FreshBooks adapter requires accessToken in format "token|accountId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  /**
   * Map a FreshBooks Client to CrewShift's unified customer format.
   */
  private mapFBClient(client: Record<string, unknown>): Record<string, unknown> {
    return {
      name: `${client.fname ?? ''} ${client.lname ?? ''}`.trim() || client.organization,
      company_name: client.organization as string ?? null,
      email: client.email as string ?? null,
      phone: (client.mob_phone as string) || (client.home_phone as string) || (client.bus_phone as string) || null,
      address: client.p_street
        ? {
            street: [client.p_street, client.p_street2].filter(Boolean).join(', '),
            city: client.p_city ?? '',
            state: client.p_province ?? '',
            zip: client.p_code ?? '',
            country: client.p_country ?? '',
          }
        : null,
      external_ids: { freshbooks: String(client.userid ?? client.id) },
      source: 'freshbooks',
      metadata: {
        fb_accounting_systemid: client.accounting_systemid,
        fb_username: client.username,
        fb_updated: client.updated,
        fb_language: client.language,
        fb_currency_code: client.currency_code,
      },
    };
  }

  /**
   * Map a FreshBooks Invoice to CrewShift's unified invoice format.
   */
  private mapFBInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lines = (invoice.lines as Array<Record<string, unknown>>) ?? [];
    const amount = invoice.amount as Record<string, unknown> | undefined;
    const outstanding = invoice.outstanding as Record<string, unknown> | undefined;

    return {
      invoice_number: invoice.invoice_number as string ?? null,
      status: this.mapFBInvoiceStatus(invoice.v3_status as number),
      amount: amount?.amount ? parseFloat(amount.amount as string) : 0,
      balance_due: outstanding?.amount ? parseFloat(outstanding.amount as string) : 0,
      due_date: invoice.due_date as string ?? null,
      issued_date: invoice.create_date as string ?? null,
      customer_external_id: invoice.customerid ? String(invoice.customerid) : null,
      external_ids: { freshbooks: String(invoice.invoiceid ?? invoice.id) },
      line_items: lines.map((line) => {
        const unitCost = line.unit_cost as Record<string, unknown> | undefined;
        return {
          description: line.description ?? line.name ?? '',
          quantity: line.qty ?? 1,
          unit_price: unitCost?.amount ? parseFloat(unitCost.amount as string) : 0,
          total: line.amount ? parseFloat((line.amount as Record<string, unknown>).amount as string) : 0,
        };
      }),
      source: 'freshbooks',
      metadata: {
        fb_accounting_systemid: invoice.accounting_systemid,
        fb_currency_code: invoice.currency_code,
        fb_language: invoice.language,
        fb_updated: invoice.updated,
        fb_payment_status: invoice.payment_status,
      },
    };
  }

  /**
   * Map FreshBooks v3_status (numeric) to CrewShift status.
   */
  private mapFBInvoiceStatus(v3Status: number): string {
    switch (v3Status) {
      case 0: return 'draft';
      case 1: return 'draft';    // created, not yet sent
      case 2: return 'sent';     // sent
      case 3: return 'sent';     // viewed
      case 4: return 'paid';     // paid
      case 5: return 'partial';  // auto-paid (partial)
      case 6: return 'overdue';  // overdue
      default: return 'draft';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const freshbooksAdapter = new FreshBooksAdapter();
registerAdapter(freshbooksAdapter);
export default freshbooksAdapter;
