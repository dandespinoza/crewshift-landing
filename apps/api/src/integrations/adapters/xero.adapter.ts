/**
 * Xero Integration Adapter
 *
 * Native (Tier 1) adapter for Xero accounting.
 * Handles OAuth2, customer/invoice sync, invoice creation, and webhooks.
 *
 * Xero API Reference:
 * - Auth: https://developer.xero.com/documentation/guides/oauth2/auth-flow
 * - API: https://developer.xero.com/documentation/api/accounting
 * - Webhooks: https://developer.xero.com/documentation/guides/webhooks/overview
 *
 * Key details:
 * - Token exchange uses HTTP Basic auth: base64(clientId:clientSecret)
 * - Xero-Tenant-Id header required on all API calls (retrieved from /connections)
 * - If-Modified-Since header for incremental sync on Contacts and Invoices
 * - Rate limit: 60 requests/minute + 5,000 requests/day
 * - Webhook verification: HMAC-SHA256 with webhook signing key
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

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_SCOPES = 'openid profile email accounting.transactions accounting.contacts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getBasicAuthHeader(): string {
  const clientId = env.XERO_CLIENT_ID ?? '';
  const clientSecret = env.XERO_CLIENT_SECRET ?? '';
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

/**
 * Fetch the tenant ID from the Xero /connections endpoint.
 * Xero requires a Xero-Tenant-Id header on every API call.
 * Returns the first active tenant ID.
 */
async function fetchTenantId(accessToken: string): Promise<string> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, errorBody }, 'Xero connections fetch failed');
    throw new Error(`Xero connections fetch failed: ${response.status}`);
  }

  const connections = (await response.json()) as Array<Record<string, unknown>>;

  if (connections.length === 0) {
    throw new Error('No Xero tenants connected — user must authorize at least one organization');
  }

  return connections[0].tenantId as string;
}

/**
 * Make an authenticated request to the Xero API.
 */
async function xeroFetch(
  path: string,
  accessToken: string,
  tenantId: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${XERO_API_BASE}/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, tenantId, errorBody },
      'Xero API error',
    );
    throw new Error(`Xero API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class XeroAdapter extends BaseAdapter {
  readonly provider = 'xero' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.XERO_CLIENT_ID;
    if (!clientId) {
      throw new Error('XERO_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: XERO_SCOPES,
      state: orgId,
    });

    return `${XERO_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/xero/callback`;

    const response = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Xero token exchange failed');
      throw new Error(`Xero token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Fetch the tenant ID immediately after token exchange
    const tenantId = await fetchTenantId(tokens.access_token as string);
    logger.info({ tenantId }, 'Xero tenant ID retrieved');

    return {
      access_token: `${tokens.access_token as string}|${tenantId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Xero');
    }

    const response = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Xero token refresh failed');
      throw new Error(`Xero token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Fetch updated tenant ID
    const tenantId = await fetchTenantId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${tenantId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Xero → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, tenantId] = this.parseAccessToken(accessToken);

    const headers: Record<string, string> = {};
    if (lastSyncAt) {
      headers['If-Modified-Since'] = new Date(lastSyncAt).toUTCString();
    }

    const response = await xeroFetch('Contacts', token, tenantId, { headers });
    const data = (await response.json()) as Record<string, unknown>;
    const contacts = (data.Contacts as Array<Record<string, unknown>>) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const contact of contacts) {
      try {
        const mapped = this.mapXeroContact(contact);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: contacts.length, created, errors: errors.length },
      'Xero customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, tenantId] = this.parseAccessToken(accessToken);

    const headers: Record<string, string> = {};
    if (lastSyncAt) {
      headers['If-Modified-Since'] = new Date(lastSyncAt).toUTCString();
    }

    const response = await xeroFetch('Invoices', token, tenantId, { headers });
    const data = (await response.json()) as Record<string, unknown>;
    const invoices = (data.Invoices as Array<Record<string, unknown>>) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of invoices) {
      try {
        const mapped = this.mapXeroInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Xero invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Xero ───────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, tenantId] = this.parseAccessToken(accessToken);

    const xeroInvoice = {
      Type: 'ACCREC',
      Contact: { ContactID: invoiceData.customer_external_id },
      LineItems: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        Description: item.description,
        Quantity: item.quantity,
        UnitAmount: item.unit_price,
        AccountCode: (item.account_code as string) ?? '200',
      })) ?? [],
      Date: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
      DueDate: invoiceData.due_date,
      Reference: invoiceData.invoice_number,
      Status: 'AUTHORISED',
    };

    const response = await xeroFetch('Invoices', token, tenantId, {
      method: 'POST',
      body: JSON.stringify(xeroInvoice),
    });

    const result = (await response.json()) as Record<string, unknown>;
    const invoices = result.Invoices as Array<Record<string, unknown>>;
    const createdInvoice = invoices[0];

    return {
      provider: this.provider,
      external_id: String(createdInvoice.InvoiceID),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const webhookKey = env.XERO_WEBHOOK_KEY;
    if (!webhookKey) {
      logger.warn('No Xero webhook key configured');
      return false;
    }

    const hash = createHmac('sha256', webhookKey)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Xero webhook payload structure:
    // { events: [{ resourceUrl, resourceId, eventDateUtc, eventType, eventCategory, tenantId }] }
    const events = payload.events as Array<Record<string, unknown>> | undefined;
    const firstEvent = events?.[0];

    return {
      provider: this.provider,
      event_type: (firstEvent?.eventType as string) ?? 'unknown',
      resource_type: (firstEvent?.eventCategory as string)?.toLowerCase() ?? 'unknown',
      resource_id: firstEvent?.resourceId as string | undefined,
      data: payload,
      timestamp: (firstEvent?.eventDateUtc as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|tenantId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('Xero adapter requires accessToken in format "token|tenantId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  /**
   * Map a Xero Contact to CrewShift's unified customer format.
   */
  private mapXeroContact(contact: Record<string, unknown>): Record<string, unknown> {
    const addresses = contact.Addresses as Array<Record<string, unknown>> | undefined;
    const primaryAddr = addresses?.find((a) => a.AddressType === 'POBOX') ?? addresses?.[0];
    const phones = contact.Phones as Array<Record<string, unknown>> | undefined;
    const primaryPhone = phones?.find((p) => p.PhoneType === 'DEFAULT') ?? phones?.[0];

    return {
      name: (contact.Name as string) ?? `${contact.FirstName ?? ''} ${contact.LastName ?? ''}`.trim(),
      company_name: contact.Name as string ?? null,
      email: contact.EmailAddress as string ?? null,
      phone: primaryPhone
        ? `${primaryPhone.PhoneCountryCode ?? ''}${primaryPhone.PhoneAreaCode ?? ''}${primaryPhone.PhoneNumber ?? ''}`.trim() || null
        : null,
      address: primaryAddr
        ? {
            street: [primaryAddr.AddressLine1, primaryAddr.AddressLine2, primaryAddr.AddressLine3].filter(Boolean).join(', '),
            city: primaryAddr.City ?? '',
            state: primaryAddr.Region ?? '',
            zip: primaryAddr.PostalCode ?? '',
            country: primaryAddr.Country ?? '',
          }
        : null,
      external_ids: { xero: String(contact.ContactID) },
      source: 'xero',
      metadata: {
        xero_contact_status: contact.ContactStatus,
        xero_is_customer: contact.IsCustomer,
        xero_is_supplier: contact.IsSupplier,
        xero_updated_date: contact.UpdatedDateUTC,
      },
    };
  }

  /**
   * Map a Xero Invoice to CrewShift's unified invoice format.
   */
  private mapXeroInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const lineItems = (invoice.LineItems as Array<Record<string, unknown>>) ?? [];
    const contact = invoice.Contact as Record<string, unknown> | undefined;

    return {
      invoice_number: invoice.InvoiceNumber as string ?? null,
      status: this.mapXeroInvoiceStatus(invoice.Status as string),
      amount: invoice.Total ?? 0,
      balance_due: invoice.AmountDue ?? 0,
      due_date: invoice.DueDate ?? null,
      issued_date: invoice.Date ?? null,
      customer_external_id: contact?.ContactID ? String(contact.ContactID) : null,
      external_ids: { xero: String(invoice.InvoiceID) },
      line_items: lineItems.map((line) => ({
        description: line.Description ?? '',
        quantity: line.Quantity ?? 1,
        unit_price: line.UnitAmount ?? 0,
        total: line.LineAmount ?? 0,
        account_code: line.AccountCode ?? null,
      })),
      source: 'xero',
      metadata: {
        xero_type: invoice.Type,
        xero_reference: invoice.Reference,
        xero_currency_code: invoice.CurrencyCode,
        xero_updated_date: invoice.UpdatedDateUTC,
      },
    };
  }

  /**
   * Map Xero invoice status to CrewShift status.
   */
  private mapXeroInvoiceStatus(xeroStatus: string): string {
    switch (xeroStatus) {
      case 'PAID': return 'paid';
      case 'VOIDED': return 'voided';
      case 'DELETED': return 'voided';
      case 'DRAFT': return 'draft';
      case 'SUBMITTED': return 'sent';
      case 'AUTHORISED': return 'sent';
      default: return 'sent';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const xeroAdapter = new XeroAdapter();
registerAdapter(xeroAdapter);
export default xeroAdapter;
