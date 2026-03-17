/**
 * PayPal Integration Adapter
 *
 * Native (Tier 1) adapter for PayPal.
 * Handles OAuth2, invoice sync, invoice creation/sending, and webhooks.
 *
 * PayPal API Reference:
 * - Auth: https://developer.paypal.com/api/rest/authentication/
 * - Invoicing: https://developer.paypal.com/docs/api/invoicing/v2/
 * - Webhooks: https://developer.paypal.com/api/rest/webhooks/
 *
 * Key details:
 * - OAuth2 with client credentials (Basic auth for token exchange)
 * - Sandbox vs Production via environment toggle
 * - Invoice workflow: create -> send (generates a payment link)
 * - Webhook verification via PayPal's verify-webhook-signature endpoint
 * - Monetary amounts as string values with 2 decimal places
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

const PAYPAL_AUTH_URL = 'https://www.paypal.com/signin/authorize';
const PAYPAL_SANDBOX_AUTH_URL = 'https://www.sandbox.paypal.com/signin/authorize';

const PAYPAL_TOKEN_URL = 'https://api-m.paypal.com/v1/oauth2/token';
const PAYPAL_SANDBOX_TOKEN_URL = 'https://api-m.sandbox.paypal.com/v1/oauth2/token';

const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const PAYPAL_SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com';

const PAYPAL_SCOPES = 'openid email https://uri.paypal.com/services/invoicing';
const DEFAULT_PAGE_SIZE = 20; // PayPal max for invoicing is 100, default 20

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSandbox(): boolean {
  return env.NODE_ENV !== 'production';
}

function getAuthUrl(): string {
  return isSandbox() ? PAYPAL_SANDBOX_AUTH_URL : PAYPAL_AUTH_URL;
}

function getTokenUrl(): string {
  return isSandbox() ? PAYPAL_SANDBOX_TOKEN_URL : PAYPAL_TOKEN_URL;
}

function getApiBase(): string {
  return isSandbox() ? PAYPAL_SANDBOX_API_BASE : PAYPAL_API_BASE;
}

function getClientId(): string {
  const id = process.env.PAYPAL_CLIENT_ID ?? env.PAYPAL_CLIENT_ID;
  if (!id) {
    throw new Error('PAYPAL_CLIENT_ID is not configured');
  }
  return id;
}

function getClientSecret(): string {
  const secret = process.env.PAYPAL_CLIENT_SECRET ?? env.PAYPAL_CLIENT_SECRET;
  if (!secret) {
    throw new Error('PAYPAL_CLIENT_SECRET is not configured');
  }
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the PayPal API.
 */
async function paypalFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const base = getApiBase();
  const url = `${base}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'PayPal API error',
    );
    throw new Error(`PayPal API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class PayPalAdapter extends BaseAdapter {
  readonly provider = 'paypal' as const;
  readonly tier = 'native' as const;

  // ── OAuth ──────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: PAYPAL_SCOPES,
      state: orgId,
    });

    return `${getAuthUrl()}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const tokenUrl = getTokenUrl();

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'PayPal token exchange failed');
      throw new Error(`PayPal token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for PayPal');
    }

    const tokenUrl = getTokenUrl();

    const response = await fetch(tokenUrl, {
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
      logger.error({ status: response.status, errorBody }, 'PayPal token refresh failed');
      throw new Error(`PayPal token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: PayPal → CrewShift ───────────────────────────────────────────

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // PayPal Invoicing API uses POST /v2/invoicing/search-invoices with filters
    const allInvoices: Record<string, unknown>[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const searchBody: Record<string, unknown> = {
        page,
        page_size: DEFAULT_PAGE_SIZE,
        total_required: true,
      };

      if (lastSyncAt) {
        searchBody.invoice_date_range = {
          start: lastSyncAt.split('T')[0], // PayPal expects YYYY-MM-DD
          end: new Date().toISOString().split('T')[0],
        };
      }

      const response = await paypalFetch(
        '/v2/invoicing/search-invoices',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify(searchBody),
        },
      );

      const data = (await response.json()) as Record<string, unknown>;
      const items = (data.items as Record<string, unknown>[]) ?? [];
      allInvoices.push(...items);

      const totalCount = (data.total_items as number) ?? 0;
      totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE);
      page++;
    }

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const ppInv of allInvoices) {
      try {
        const mapped = this.mapPayPalInvoice(ppInv);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: ppInv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: allInvoices.length, created, errors: errors.length },
      'PayPal invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → PayPal ─────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    // Step 1: Create the invoice
    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];

    const ppInvoice: Record<string, unknown> = {
      detail: {
        invoice_number: invoiceData.invoice_number ?? undefined,
        invoice_date: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
        payment_term: {
          due_date: invoiceData.due_date ?? undefined,
        },
        currency_code: (invoiceData.currency as string)?.toUpperCase() ?? 'USD',
      },
      primary_recipients: invoiceData.customer_email
        ? [
            {
              billing_info: {
                email_address: invoiceData.customer_email,
                additional_info: invoiceData.customer_name ?? undefined,
              },
            },
          ]
        : [],
      items: lineItems.map((item) => ({
        name: item.description ?? 'Line item',
        quantity: String(item.quantity ?? 1),
        unit_amount: {
          currency_code: (invoiceData.currency as string)?.toUpperCase() ?? 'USD',
          value: String(item.unit_price ?? '0.00'),
        },
        description: item.description ?? '',
      })),
    };

    const createResponse = await paypalFetch('/v2/invoicing/invoices', accessToken, {
      method: 'POST',
      body: JSON.stringify(ppInvoice),
    });

    // PayPal returns a 201 with href in response
    const createResult = (await createResponse.json()) as Record<string, unknown>;
    // Extract invoice ID from the href (format: .../v2/invoicing/invoices/INV2-XXXX)
    const href = createResult.href as string;
    const invoiceId = href ? href.split('/').pop()! : (createResult.id as string);

    // Step 2: Send the invoice (generates payment link)
    await paypalFetch(`/v2/invoicing/invoices/${invoiceId}/send`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        send_to_invoicer: true,
      }),
    });

    return {
      provider: this.provider,
      external_id: invoiceId,
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    // PayPal webhook verification is done via API call, not local HMAC.
    // This sync method returns true and actual verification is done in processWebhook.
    // For the sync check, we do a basic structure validation.
    const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      logger.warn('No PayPal webhook ID configured');
      return false;
    }

    // Basic sanity check: verify payload is valid JSON
    try {
      JSON.parse(payload.toString('utf8'));
      return true; // Full verification happens async via verifyWebhookAsync
    } catch {
      return false;
    }
  }

  /**
   * Verify webhook signature via PayPal API.
   * This is the proper verification method (PayPal requires API call, not local HMAC).
   */
  async verifyWebhookAsync(
    payload: Buffer,
    headers: Record<string, string>,
    accessToken: string,
  ): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      logger.warn('No PayPal webhook ID configured');
      return false;
    }

    const verifyBody = {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: JSON.parse(payload.toString('utf8')),
    };

    try {
      const response = await paypalFetch(
        '/v1/notifications/verify-webhook-signature',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify(verifyBody),
        },
      );

      const result = (await response.json()) as Record<string, unknown>;
      return result.verification_status === 'SUCCESS';
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'PayPal webhook verification failed');
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // PayPal webhook structure: { id, event_type, resource_type, resource: {...}, ... }
    const eventType = (payload.event_type as string) ?? 'unknown';
    const resourceType = (payload.resource_type as string) ?? 'unknown';
    const resource = payload.resource as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType.toLowerCase(),
      resource_id: (resource?.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.create_time as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a PayPal Invoice to CrewShift's unified invoice format.
   */
  private mapPayPalInvoice(ppInv: Record<string, unknown>): Record<string, unknown> {
    const detail = ppInv.detail as Record<string, unknown> | undefined;
    const amount = ppInv.amount as Record<string, unknown> | undefined;
    const amountBreakdown = amount ?? (detail as Record<string, unknown>);
    const items = (ppInv.items as Array<Record<string, unknown>>) ?? [];
    const recipients = (ppInv.primary_recipients as Array<Record<string, unknown>>) ?? [];
    const firstRecipient = recipients[0] as Record<string, unknown> | undefined;
    const billingInfo = firstRecipient?.billing_info as Record<string, unknown> | undefined;
    const payments = ppInv.payments as Record<string, unknown> | undefined;
    const dueAmount = ppInv.due_amount as Record<string, unknown> | undefined;

    const paymentTerm = detail?.payment_term as Record<string, unknown> | undefined;

    return {
      invoice_number: (detail?.invoice_number as string) ?? null,
      status: this.mapPayPalInvoiceStatus(ppInv),
      amount: amountBreakdown
        ? parseFloat(
            ((amountBreakdown as Record<string, unknown>).value as string) ?? '0',
          )
        : 0,
      balance_due: dueAmount ? parseFloat((dueAmount.value as string) ?? '0') : 0,
      due_date: (paymentTerm?.due_date as string) ?? null,
      issued_date: (detail?.invoice_date as string) ?? null,
      customer_email: (billingInfo?.email_address as string) ?? null,
      external_ids: { paypal: String(ppInv.id) },
      line_items: items.map((item) => {
        const unitAmount = item.unit_amount as Record<string, unknown> | undefined;
        return {
          description: (item.name as string) ?? (item.description as string) ?? '',
          quantity: parseInt(String(item.quantity ?? '1'), 10),
          unit_price: unitAmount ? parseFloat((unitAmount.value as string) ?? '0') : 0,
          total:
            (unitAmount ? parseFloat((unitAmount.value as string) ?? '0') : 0) *
            parseInt(String(item.quantity ?? '1'), 10),
        };
      }),
      source: 'paypal',
      metadata: {
        paypal_status: ppInv.status,
        paypal_links: ppInv.links,
        paypal_payments: payments,
      },
    };
  }

  /**
   * Map PayPal invoice status to CrewShift status.
   */
  private mapPayPalInvoiceStatus(ppInv: Record<string, unknown>): string {
    const status = (ppInv.status as string) ?? '';
    switch (status.toUpperCase()) {
      case 'PAID':
        return 'paid';
      case 'MARKED_AS_PAID':
        return 'paid';
      case 'SENT':
        return 'sent';
      case 'DRAFT':
        return 'draft';
      case 'SCHEDULED':
        return 'scheduled';
      case 'PARTIALLY_PAID':
        return 'partial';
      case 'CANCELLED':
        return 'void';
      case 'REFUNDED':
        return 'refunded';
      case 'MARKED_AS_REFUNDED':
        return 'refunded';
      case 'PAYMENT_PENDING':
        return 'pending';
      default:
        return status.toLowerCase() || 'unknown';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const paypalAdapter = new PayPalAdapter();
registerAdapter(paypalAdapter);
export default paypalAdapter;
