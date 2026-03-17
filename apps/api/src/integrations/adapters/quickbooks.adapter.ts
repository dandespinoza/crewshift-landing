/**
 * QuickBooks Online Integration Adapter
 *
 * Native (Tier 1) adapter for QuickBooks Online.
 * Handles OAuth2, customer/invoice sync, invoice creation, and webhooks.
 *
 * QuickBooks API Reference:
 * - Auth: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization
 * - Query: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account
 * - Webhooks: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks
 *
 * Key details:
 * - Token exchange uses HTTP Basic auth: base64(clientId:clientSecret)
 * - Query API supports max 1000 records per request, pagination via startPosition
 * - Rate limit: 500 requests/minute per realm
 * - Webhook verification: HMAC-SHA256 with verifier token
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

const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QB_SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const QB_SCOPES = 'com.intuit.quickbooks.accounting';
const QB_MAX_PAGE_SIZE = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiBase(): string {
  return env.NODE_ENV === 'production' ? QB_API_BASE : QB_SANDBOX_API_BASE;
}

function getBasicAuthHeader(): string {
  const clientId = env.QUICKBOOKS_CLIENT_ID ?? '';
  const clientSecret = env.QUICKBOOKS_CLIENT_SECRET ?? '';
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the QuickBooks API.
 */
async function qbFetch(
  realmId: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const base = getApiBase();
  const url = `${base}/${realmId}/${path}`;

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
      { status: response.status, path, realmId, errorBody },
      'QuickBooks API error',
    );
    throw new Error(`QuickBooks API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Run a paginated query against the QuickBooks Query API.
 * Automatically handles pagination using startPosition.
 */
async function qbQueryAll(
  realmId: string,
  entity: string,
  accessToken: string,
  whereClause?: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let startPosition = 1;
  let hasMore = true;

  while (hasMore) {
    let query = `SELECT * FROM ${entity}`;
    if (whereClause) query += ` WHERE ${whereClause}`;
    query += ` STARTPOSITION ${startPosition} MAXRESULTS ${QB_MAX_PAGE_SIZE}`;

    const response = await qbFetch(
      realmId,
      `query?query=${encodeURIComponent(query)}`,
      accessToken,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const queryResponse = data.QueryResponse as Record<string, unknown> | undefined;

    if (!queryResponse) break;

    const entities = (queryResponse[entity] as Record<string, unknown>[] | undefined) ?? [];
    results.push(...entities);

    const totalCount = queryResponse.totalCount as number | undefined;
    if (totalCount && results.length < totalCount) {
      startPosition += QB_MAX_PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class QuickBooksAdapter extends BaseAdapter {
  readonly provider = 'quickbooks' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID ?? env.QUICKBOOKS_CLIENT_ID;
    if (!clientId) {
      throw new Error('QUICKBOOKS_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: QB_SCOPES,
      state: orgId,
    });

    return `${QB_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/quickbooks/callback`;

    const response = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'QB token exchange failed');
      throw new Error(`QuickBooks token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for QuickBooks');
    }

    const response = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'QB token refresh failed');
      throw new Error(`QuickBooks token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: QB → CrewShift ─────────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // For this to work, we need the realmId. It's stored in the integration's
    // external_account_id field. The sync service passes it via the accessToken
    // parameter as "accessToken|realmId" — see sync.service.ts
    const [token, realmId] = this.parseAccessToken(accessToken);

    const whereClause = lastSyncAt
      ? `MetaData.LastUpdatedTime > '${lastSyncAt}'`
      : undefined;

    const qbCustomers = await qbQueryAll(realmId, 'Customer', token, whereClause);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const qbCust of qbCustomers) {
      try {
        const mapped = this.mapQBCustomer(qbCust);
        records.push(mapped);
        // In a real flow, sync.service checks external_ids to determine create vs update
        created++;
      } catch (err) {
        errors.push({ item: qbCust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: qbCustomers.length, created, errors: errors.length },
      'QuickBooks customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, realmId] = this.parseAccessToken(accessToken);

    const whereClause = lastSyncAt
      ? `MetaData.LastUpdatedTime > '${lastSyncAt}'`
      : undefined;

    const qbInvoices = await qbQueryAll(realmId, 'Invoice', token, whereClause);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const qbInv of qbInvoices) {
      try {
        const mapped = this.mapQBInvoice(qbInv);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: qbInv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: qbInvoices.length, created, errors: errors.length },
      'QuickBooks invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → QB ───────────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, realmId] = this.parseAccessToken(accessToken);

    // Map CrewShift invoice format to QB format
    const qbInvoice = {
      CustomerRef: { value: invoiceData.customer_external_id },
      Line: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        Amount: item.total,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: item.item_id ?? '1' },
          Qty: item.quantity,
          UnitPrice: item.unit_price,
        },
        Description: item.description,
      })) ?? [],
      DueDate: invoiceData.due_date,
      DocNumber: invoiceData.invoice_number,
    };

    const response = await qbFetch(realmId, 'invoice', token, {
      method: 'POST',
      body: JSON.stringify(qbInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const invoice = result.Invoice as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(invoice.Id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const webhookVerifierToken = process.env.QUICKBOOKS_CLIENT_SECRET ?? env.QUICKBOOKS_CLIENT_SECRET;
    if (!webhookVerifierToken) {
      logger.warn('No QuickBooks webhook verifier token configured');
      return false;
    }

    const hash = createHmac('sha256', webhookVerifierToken)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // QB webhook payload structure:
    // { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name, id, operation }] } }] }
    const notifications = payload.eventNotifications as Array<Record<string, unknown>> | undefined;
    const firstNotification = notifications?.[0];
    const dataChange = firstNotification?.dataChangeEvent as Record<string, unknown> | undefined;
    const entities = dataChange?.entities as Array<Record<string, unknown>> | undefined;
    const firstEntity = entities?.[0];

    return {
      provider: this.provider,
      event_type: (firstEntity?.operation as string) ?? 'unknown',
      resource_type: (firstEntity?.name as string)?.toLowerCase() ?? 'unknown',
      resource_id: firstEntity?.id as string | undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|realmId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('QuickBooks adapter requires accessToken in format "token|realmId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  /**
   * Map a QuickBooks Customer object to CrewShift's unified customer format.
   */
  private mapQBCustomer(qbCust: Record<string, unknown>): Record<string, unknown> {
    const primaryAddr = qbCust.BillAddr as Record<string, unknown> | undefined;
    const primaryPhone = qbCust.PrimaryPhone as Record<string, unknown> | undefined;
    const primaryEmail = qbCust.PrimaryEmailAddr as Record<string, unknown> | undefined;

    return {
      name: `${qbCust.GivenName ?? ''} ${qbCust.FamilyName ?? ''}`.trim() || qbCust.DisplayName,
      company_name: qbCust.CompanyName ?? null,
      email: (primaryEmail?.Address as string) ?? null,
      phone: (primaryPhone?.FreeFormNumber as string) ?? null,
      address: primaryAddr
        ? {
            street: [primaryAddr.Line1, primaryAddr.Line2].filter(Boolean).join(', '),
            city: primaryAddr.City ?? '',
            state: primaryAddr.CountrySubDivisionCode ?? '',
            zip: primaryAddr.PostalCode ?? '',
          }
        : null,
      external_ids: { quickbooks: String(qbCust.Id) },
      source: 'quickbooks',
      metadata: {
        qb_display_name: qbCust.DisplayName,
        qb_active: qbCust.Active,
        qb_balance: qbCust.Balance,
        qb_last_updated: (qbCust.MetaData as Record<string, unknown>)?.LastUpdatedTime,
      },
    };
  }

  /**
   * Map a QuickBooks Invoice object to CrewShift's unified invoice format.
   */
  private mapQBInvoice(qbInv: Record<string, unknown>): Record<string, unknown> {
    const lines = (qbInv.Line as Array<Record<string, unknown>> | undefined) ?? [];
    const customerRef = qbInv.CustomerRef as Record<string, unknown> | undefined;

    return {
      invoice_number: qbInv.DocNumber ?? null,
      status: this.mapQBInvoiceStatus(qbInv),
      amount: qbInv.TotalAmt ?? 0,
      balance_due: qbInv.Balance ?? 0,
      due_date: qbInv.DueDate ?? null,
      issued_date: qbInv.TxnDate ?? null,
      customer_external_id: customerRef?.value ? String(customerRef.value) : null,
      external_ids: { quickbooks: String(qbInv.Id) },
      line_items: lines
        .filter((l) => l.DetailType === 'SalesItemLineDetail')
        .map((l) => {
          const detail = l.SalesItemLineDetail as Record<string, unknown> | undefined;
          return {
            description: l.Description ?? '',
            quantity: detail?.Qty ?? 1,
            unit_price: detail?.UnitPrice ?? 0,
            total: l.Amount ?? 0,
          };
        }),
      source: 'quickbooks',
      metadata: {
        qb_sync_token: qbInv.SyncToken,
        qb_email_status: qbInv.EmailStatus,
        qb_last_updated: (qbInv.MetaData as Record<string, unknown>)?.LastUpdatedTime,
      },
    };
  }

  /**
   * Map QB invoice balance to a CrewShift status.
   */
  private mapQBInvoiceStatus(qbInv: Record<string, unknown>): string {
    const balance = (qbInv.Balance as number) ?? 0;
    const total = (qbInv.TotalAmt as number) ?? 0;

    if (balance === 0 && total > 0) return 'paid';
    if (balance < total && balance > 0) return 'partial';

    const dueDate = qbInv.DueDate as string | undefined;
    if (dueDate && new Date(dueDate) < new Date()) return 'overdue';

    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const quickbooksAdapter = new QuickBooksAdapter();
registerAdapter(quickbooksAdapter);
export default quickbooksAdapter;
