/**
 * Melio Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Melio.
 * Handles OAuth2 and B2B payment data sync.
 *
 * Melio API Reference:
 * - API Base: https://api.melio.com/v1
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - B2B payment sync via GET /payments
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

const MELIO_API_BASE = 'https://api.melio.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.MELIO_CLIENT_ID;
  if (!id) throw new Error('MELIO_CLIENT_ID is not configured — Melio partner program required');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.MELIO_CLIENT_SECRET;
  if (!secret) throw new Error('MELIO_CLIENT_SECRET is not configured — Melio partner program required');
  return secret;
}

/**
 * Make an authenticated request to the Melio API.
 */
async function melioFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${MELIO_API_BASE}${path}`;

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
      'Melio API error',
    );
    throw new Error(`Melio API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class MelioAdapter extends BaseAdapter {
  readonly provider = 'melio' as const;
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

    // Melio partner program provides the auth URL upon enrollment
    return `https://app.melio.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(`${MELIO_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/melio/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Melio token exchange failed');
      throw new Error(`Melio token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Melio');
    }

    const response = await fetch(`${MELIO_API_BASE}/oauth/token`, {
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
      logger.error({ status: response.status, errorBody }, 'Melio token refresh failed');
      throw new Error(`Melio token refresh failed: ${response.status}`);
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

  // ── Sync: Melio → CrewShift ─────────────────────────────────────────────

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await melioFetch('/payments', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const payments = (data.payments as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const payment of payments) {
      try {
        records.push({
          invoice_number: payment.referenceNumber ?? null,
          status: payment.status ?? null,
          amount: payment.amount ?? 0,
          balance_due: 0,
          due_date: payment.scheduledDate ?? null,
          issued_date: payment.createdAt ?? null,
          external_ids: { melio: String(payment.id) },
          source: 'melio',
          metadata: {
            melio_vendor: payment.vendorId,
            melio_delivery_method: payment.deliveryMethod,
            melio_memo: payment.memo,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: payment, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: payments.length, created, errors: errors.length },
      'Melio payment sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new MelioAdapter();
registerAdapter(adapter);
export default adapter;
