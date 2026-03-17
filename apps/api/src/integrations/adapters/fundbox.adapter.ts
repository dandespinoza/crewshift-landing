/**
 * Fundbox Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Fundbox.
 * Handles OAuth2 and invoice financing data sync.
 *
 * Fundbox API Reference:
 * - API Base: https://api.fundbox.com/v1
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - Invoice financing data via GET /invoices
 * - NOTE: Partner program required for API access
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

const FUNDBOX_API_BASE = 'https://api.fundbox.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.FUNDBOX_CLIENT_ID;
  if (!id) throw new Error('FUNDBOX_CLIENT_ID is not configured — Fundbox partner program required');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.FUNDBOX_CLIENT_SECRET;
  if (!secret) throw new Error('FUNDBOX_CLIENT_SECRET is not configured — Fundbox partner program required');
  return secret;
}

/**
 * Make an authenticated request to the Fundbox API.
 */
async function fundboxFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${FUNDBOX_API_BASE}${path}`;

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
      'Fundbox API error',
    );
    throw new Error(`Fundbox API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class FundboxAdapter extends BaseAdapter {
  readonly provider = 'fundbox' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `https://app.fundbox.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(`${FUNDBOX_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/fundbox/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Fundbox token exchange failed');
      throw new Error(`Fundbox token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Fundbox');
    }

    const response = await fetch(`${FUNDBOX_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Fundbox token refresh failed');
      throw new Error(`Fundbox token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  // ── Sync: Fundbox → CrewShift ───────────────────────────────────────────

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await fundboxFetch('/invoices', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const invoices = (data.invoices as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const inv of invoices) {
      try {
        records.push({
          invoice_number: inv.invoiceNumber ?? null,
          status: inv.status ?? null,
          amount: inv.amount ?? 0,
          balance_due: inv.outstandingAmount ?? 0,
          due_date: inv.dueDate ?? null,
          issued_date: inv.createdAt ?? null,
          external_ids: { fundbox: String(inv.id) },
          source: 'fundbox',
          metadata: {
            fundbox_financing_status: inv.financingStatus,
            fundbox_advance_amount: inv.advanceAmount,
            fundbox_customer_name: inv.customerName,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Fundbox invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new FundboxAdapter();
registerAdapter(adapter);
export default adapter;
