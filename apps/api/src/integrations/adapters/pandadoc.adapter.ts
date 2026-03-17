/**
 * PandaDoc Integration Adapter
 *
 * Tier 2 adapter for PandaDoc.
 * Handles OAuth2 (or API Key), document sync (proposals), invoice creation, and webhooks.
 *
 * PandaDoc API Reference:
 * - Auth: https://developers.pandadoc.com/reference/about-authentication
 * - Documents: https://developers.pandadoc.com/reference/list-documents
 * - Templates: https://developers.pandadoc.com/reference/list-templates
 * - Webhooks: https://developers.pandadoc.com/reference/about-webhooks
 *
 * Key details:
 * - OAuth2 or API Key authentication
 * - Documents use page/count pagination
 * - Documents = proposals in CrewShift context
 * - Webhook verification via shared key
 * - Rate limit: 50 document creations per minute
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

const PANDADOC_AUTH_URL = 'https://app.pandadoc.com/oauth2/authorize';
const PANDADOC_TOKEN_URL = 'https://api.pandadoc.com/oauth2/access_token';
const PANDADOC_API_BASE = 'https://api.pandadoc.com/public/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.PANDADOC_CLIENT_ID ?? env.PANDADOC_CLIENT_ID;
  if (!id) throw new Error('PANDADOC_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.PANDADOC_CLIENT_SECRET ?? env.PANDADOC_CLIENT_SECRET;
  if (!secret) throw new Error('PANDADOC_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the PandaDoc API.
 */
async function pandadocFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${PANDADOC_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'PandaDoc API error');
    throw new Error(`PandaDoc API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class PandaDocAdapter extends BaseAdapter {
  readonly provider = 'pandadoc' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'read+write',
      state: orgId,
    });

    return `${PANDADOC_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/pandadoc/callback`;

    const response = await fetch(PANDADOC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: redirectUri,
        scope: 'read+write',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'PandaDoc token exchange failed');
      throw new Error(`PandaDoc token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for PandaDoc');
    }

    const response = await fetch(PANDADOC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'PandaDoc token refresh failed');
      throw new Error(`PandaDoc token refresh failed: ${response.status}`);
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

  // ── Sync: PandaDoc → CrewShift ────────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Documents in PandaDoc represent proposals/contracts
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        page: String(page),
        count: String(DEFAULT_PAGE_SIZE),
        order_by: 'date_modified',
      });
      if (lastSyncAt) {
        params.set('modified_from', lastSyncAt);
      }

      const response = await pandadocFetch(`/documents?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const results = (data.results as Record<string, unknown>[]) ?? [];

      for (const doc of results) {
        try {
          records.push(this.mapPandaDocDocument(doc));
          created++;
        } catch (err) {
          errors.push({ item: doc, error: (err as Error).message });
        }
      }

      if (results.length < DEFAULT_PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'PandaDoc document sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → PandaDoc ──────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    // PandaDoc creates documents from templates
    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];

    const docBody = {
      name: (invoiceData.description as string) ?? `Invoice ${invoiceData.invoice_number ?? ''}`,
      template_uuid: (invoiceData.template_id as string) ?? undefined,
      recipients: invoiceData.customer_email
        ? [
            {
              email: invoiceData.customer_email,
              first_name: (invoiceData.customer_name as string)?.split(' ')[0] ?? '',
              last_name: (invoiceData.customer_name as string)?.split(' ').slice(1).join(' ') ?? '',
              role: 'Client',
            },
          ]
        : [],
      tokens: [
        { name: 'Invoice.Number', value: (invoiceData.invoice_number as string) ?? '' },
        { name: 'Invoice.DueDate', value: (invoiceData.due_date as string) ?? '' },
      ],
      pricing_tables: lineItems.length > 0
        ? [
            {
              name: 'Pricing Table 1',
              data_merge: true,
              options: { currency: (invoiceData.currency as string) ?? 'USD' },
              sections: [
                {
                  title: 'Line Items',
                  default: true,
                  rows: lineItems.map((item) => ({
                    options: {
                      qty_editable: false,
                      optional: false,
                    },
                    data: {
                      name: (item.description as string) ?? 'Item',
                      price: item.unit_price,
                      qty: item.quantity ?? 1,
                    },
                  })),
                },
              ],
            },
          ]
        : undefined,
      metadata: {
        crewshift_invoice_number: invoiceData.invoice_number,
        crewshift_due_date: invoiceData.due_date,
      },
    };

    const response = await pandadocFetch('/documents', accessToken, {
      method: 'POST',
      body: JSON.stringify(docBody),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.id ?? result.uuid),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const sharedKey = getClientSecret();

    const hash = createHmac('sha256', sharedKey)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // PandaDoc webhook: [{ event, data: { id, name, status, ... } }]
    // Webhooks come as an array; take the first event
    const events = Array.isArray(payload) ? payload : [payload];
    const firstEvent = (events[0] as Record<string, unknown>) ?? {};

    const eventType = (firstEvent.event as string) ?? 'unknown';
    const data = (firstEvent.data as Record<string, unknown>) ?? {};

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'document',
      resource_id: (data.id as string) ?? undefined,
      data: firstEvent,
      timestamp: (data.date_modified as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapPandaDocDocument(doc: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (doc.name as string) ?? 'Untitled Document',
      status: ((doc.status as string) ?? 'unknown').toLowerCase(),
      description: null,
      external_ids: { pandadoc: String(doc.id ?? doc.uuid) },
      source: 'pandadoc',
      metadata: {
        pandadoc_status: doc.status,
        pandadoc_date_created: doc.date_created,
        pandadoc_date_modified: doc.date_modified,
        pandadoc_expiration_date: doc.expiration_date,
        pandadoc_version: doc.version,
        pandadoc_template_id: (doc.template as Record<string, unknown>)?.id,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new PandaDocAdapter();
registerAdapter(adapter);
export default adapter;
