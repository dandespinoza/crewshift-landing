/**
 * MYOB Integration Adapter
 *
 * Native (Tier 1) adapter for MYOB AccountRight.
 * Handles OAuth2, customer/invoice sync, invoice creation, and webhooks.
 *
 * MYOB API Reference:
 * - Auth: https://developer.myob.com/api/accountright/api-overview/authentication/
 * - API: https://developer.myob.com/api/accountright/v2/
 * - Company Files: https://developer.myob.com/api/accountright/v2/company-file/
 *
 * Key details:
 * - OAuth2 token exchange and refresh via https://secure.myob.com/oauth2/v1/authorize
 * - Region-specific API base: https://api.myob.com/au (Australia)
 * - Must GET /accountright/ first to discover company file URIs
 * - All API calls require x-myobapi-key header with client ID
 * - Rate limit: 8 requests/second + 1,000,000 requests/day
 * - Webhook verification via HMAC
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

const MYOB_AUTH_URL = 'https://secure.myob.com/oauth2/v1/authorize';
const MYOB_TOKEN_URL = 'https://secure.myob.com/oauth2/v1/authorize';
const MYOB_API_BASE = 'https://api.myob.com/au';
const MYOB_COMPANY_FILES_URL = `${MYOB_API_BASE}/accountright/`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch the first available company file URI from MYOB.
 * The company file URI is required in the path for all accounting API calls.
 */
async function fetchCompanyFileId(accessToken: string): Promise<string> {
  const response = await fetch(MYOB_COMPANY_FILES_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-myobapi-key': env.MYOB_CLIENT_ID ?? '',
      'x-myobapi-version': 'v2',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, errorBody }, 'MYOB company files fetch failed');
    throw new Error(`MYOB company files fetch failed: ${response.status}`);
  }

  const companyFiles = (await response.json()) as Array<Record<string, unknown>>;

  if (companyFiles.length === 0) {
    throw new Error('No MYOB company files found for this user');
  }

  // Use the first company file's Id
  const companyFileId = companyFiles[0].Id as string;
  const companyFileName = companyFiles[0].Name as string;
  logger.info({ companyFileId, companyFileName }, 'MYOB company file selected');

  return companyFileId;
}

/**
 * Make an authenticated request to the MYOB AccountRight API.
 */
async function myobFetch(
  companyFileId: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${MYOB_API_BASE}/${companyFileId}/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-myobapi-key': env.MYOB_CLIENT_ID ?? '',
      'x-myobapi-version': 'v2',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, companyFileId, errorBody },
      'MYOB API error',
    );
    throw new Error(`MYOB API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a MYOB list endpoint.
 * MYOB uses $top/$skip OData-style pagination.
 */
async function myobFetchAllPages(
  companyFileId: string,
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const pageSize = 400;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}$top=${pageSize}&$skip=${skip}`;

    const response = await myobFetch(companyFileId, pagedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.Items as Array<Record<string, unknown>>) ?? [];

    results.push(...items);

    if (items.length < pageSize) {
      hasMore = false;
    } else {
      skip += pageSize;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class MyobAdapter extends BaseAdapter {
  readonly provider = 'myob' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.MYOB_CLIENT_ID;
    if (!clientId) {
      throw new Error('MYOB_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'CompanyFile',
      state: orgId,
    });

    return `${MYOB_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.MYOB_CLIENT_ID ?? '';
    const clientSecret = env.MYOB_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/myob/callback`;

    const response = await fetch(MYOB_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'MYOB token exchange failed');
      throw new Error(`MYOB token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Fetch the company file ID immediately after token exchange
    const companyFileId = await fetchCompanyFileId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${companyFileId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for MYOB');
    }

    const clientId = env.MYOB_CLIENT_ID ?? '';
    const clientSecret = env.MYOB_CLIENT_SECRET ?? '';

    const response = await fetch(MYOB_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'MYOB token refresh failed');
      throw new Error(`MYOB token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Re-fetch company file ID with fresh token
    const companyFileId = await fetchCompanyFileId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${companyFileId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: MYOB → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, companyFileId] = this.parseAccessToken(accessToken);

    const myobCustomers = await myobFetchAllPages(
      companyFileId,
      'Contact/Customer',
      token,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const customer of myobCustomers) {
      try {
        const mapped = this.mapMyobCustomer(customer);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: customer, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: myobCustomers.length, created, errors: errors.length },
      'MYOB customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, companyFileId] = this.parseAccessToken(accessToken);

    const myobInvoices = await myobFetchAllPages(
      companyFileId,
      'Sale/Invoice',
      token,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of myobInvoices) {
      try {
        const mapped = this.mapMyobInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: myobInvoices.length, created, errors: errors.length },
      'MYOB invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → MYOB ───────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, companyFileId] = this.parseAccessToken(accessToken);

    const myobInvoice = {
      Customer: { UID: invoiceData.customer_external_id },
      Date: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
      TermsOfPayment: {
        DueDate: invoiceData.due_date,
      },
      Number: invoiceData.invoice_number ?? undefined,
      Lines: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        Type: 'Transaction',
        Description: item.description ?? 'Service',
        ShipQuantity: item.quantity ?? 1,
        UnitPrice: item.unit_price ?? 0,
        Total: (item.quantity as number ?? 1) * (item.unit_price as number ?? 0),
        Account: item.account_uid
          ? { UID: item.account_uid }
          : undefined,
        TaxCode: item.tax_code_uid
          ? { UID: item.tax_code_uid }
          : undefined,
      })) ?? [],
      IsTaxInclusive: invoiceData.is_tax_inclusive ?? false,
      Comment: invoiceData.notes as string ?? '',
    };

    const response = await myobFetch(companyFileId, 'Sale/Invoice', token, {
      method: 'POST',
      body: JSON.stringify(myobInvoice),
    });

    // MYOB returns the UID in the Location header
    const locationHeader = response.headers.get('Location') ?? '';
    const uidMatch = locationHeader.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    let externalId: string;

    if (uidMatch) {
      externalId = uidMatch[1];
    } else {
      // Fallback: try to parse the response body
      const result = (await response.json()) as Record<string, unknown>;
      externalId = String(result.UID ?? result.Id ?? 'unknown');
    }

    return {
      provider: this.provider,
      external_id: externalId,
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.MYOB_CLIENT_SECRET;
    if (!secret) {
      logger.warn('No MYOB client secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // MYOB webhook payload structure varies by event type.
    // Normalize to a standard WebhookEvent.
    const eventType = (payload.EventType as string) ?? (payload.event_type as string) ?? 'unknown';
    const resourceType = (payload.ResourceType as string) ?? (payload.resource_type as string) ?? 'unknown';
    const resourceId = (payload.ResourceUID as string) ?? (payload.resource_uid as string) ?? undefined;

    return {
      provider: this.provider,
      event_type: eventType.toLowerCase(),
      resource_type: resourceType.toLowerCase(),
      resource_id: resourceId,
      data: payload,
      timestamp: (payload.EventDate as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|companyFileId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('MYOB adapter requires accessToken in format "token|companyFileId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  /**
   * Map a MYOB Customer to CrewShift's unified customer format.
   */
  private mapMyobCustomer(customer: Record<string, unknown>): Record<string, unknown> {
    const addresses = customer.Addresses as Array<Record<string, unknown>> | undefined;
    const primaryAddr = addresses?.[0];

    return {
      name: `${customer.FirstName ?? ''} ${customer.LastName ?? ''}`.trim() || customer.CompanyName || customer.DisplayID,
      company_name: customer.CompanyName as string ?? null,
      email: primaryAddr?.Email as string ?? null,
      phone: primaryAddr?.Phone1 as string ?? primaryAddr?.Phone2 as string ?? null,
      address: primaryAddr
        ? {
            street: [primaryAddr.Street, primaryAddr.Street2].filter(Boolean).join(', '),
            city: primaryAddr.City ?? '',
            state: primaryAddr.State ?? '',
            zip: primaryAddr.PostCode ?? '',
            country: primaryAddr.Country ?? '',
          }
        : null,
      external_ids: { myob: String(customer.UID) },
      source: 'myob',
      metadata: {
        myob_display_id: customer.DisplayID,
        myob_is_active: customer.IsActive,
        myob_current_balance: customer.CurrentBalance,
        myob_last_modified: customer.LastModified,
      },
    };
  }

  /**
   * Map a MYOB Sale/Invoice to CrewShift's unified invoice format.
   */
  private mapMyobInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lines = (invoice.Lines as Array<Record<string, unknown>>) ?? [];
    const customer = invoice.Customer as Record<string, unknown> | undefined;
    const terms = invoice.Terms as Record<string, unknown> | undefined;

    return {
      invoice_number: invoice.Number as string ?? null,
      status: this.mapMyobInvoiceStatus(invoice.Status as string),
      amount: invoice.TotalAmount ?? invoice.Subtotal ?? 0,
      balance_due: invoice.BalanceDueAmount ?? 0,
      due_date: (terms?.DueDate as string) ?? null,
      issued_date: invoice.Date as string ?? null,
      customer_external_id: customer?.UID ? String(customer.UID) : null,
      external_ids: { myob: String(invoice.UID) },
      line_items: lines
        .filter((l) => l.Type === 'Transaction')
        .map((line) => ({
          description: line.Description ?? '',
          quantity: line.ShipQuantity ?? line.UnitCount ?? 1,
          unit_price: line.UnitPrice ?? 0,
          total: line.Total ?? 0,
        })),
      source: 'myob',
      metadata: {
        myob_display_id: invoice.DisplayID,
        myob_journal_memo: invoice.JournalMemo,
        myob_is_tax_inclusive: invoice.IsTaxInclusive,
        myob_last_modified: invoice.LastModified,
      },
    };
  }

  /**
   * Map MYOB invoice status to CrewShift status.
   */
  private mapMyobInvoiceStatus(myobStatus: string): string {
    switch (myobStatus) {
      case 'Closed': return 'paid';
      case 'Open': return 'sent';
      case 'CreditNote': return 'voided';
      default: return 'draft';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const myobAdapter = new MyobAdapter();
registerAdapter(myobAdapter);
export default myobAdapter;
