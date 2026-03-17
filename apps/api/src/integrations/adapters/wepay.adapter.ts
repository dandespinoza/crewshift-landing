/**
 * WePay Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for WePay.
 * Handles OAuth2, payment creation, and IPN webhook verification.
 *
 * WePay API Reference:
 * - Auth: https://developer.wepay.com/docs/articles/oauth2
 * - Checkout: https://developer.wepay.com/docs/api/checkout
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - Payment creation via POST /checkout/create
 * - Webhook verification via IPN notification
 * - NOTE: Platform partnership with Chase required
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

const WEPAY_AUTH_URL = 'https://www.wepay.com/v2/oauth2/authorize';
const WEPAY_TOKEN_URL = 'https://wepayapi.com/v2/oauth2/token';
const WEPAY_API_BASE = 'https://wepayapi.com/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.WEPAY_CLIENT_ID;
  if (!id) throw new Error('WEPAY_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.WEPAY_CLIENT_SECRET;
  if (!secret) throw new Error('WEPAY_CLIENT_SECRET is not configured');
  return secret;
}

function getAccountId(): string {
  const accountId = process.env.WEPAY_ACCOUNT_ID;
  if (!accountId) throw new Error('WEPAY_ACCOUNT_ID is not configured');
  return accountId;
}

/**
 * Make an authenticated request to the WePay API.
 */
async function wepayFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${WEPAY_API_BASE}${path}`;

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
      'WePay API error',
    );
    throw new Error(`WePay API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class WePayAdapter extends BaseAdapter {
  readonly provider = 'wepay' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'manage_accounts,collect_payments,view_balance,view_user,preapprove_payments,send_money',
      state: orgId,
    });

    return `${WEPAY_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(WEPAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        redirect_uri: `${process.env.API_URL}/api/integrations/wepay/callback`,
        code,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'WePay token exchange failed');
      throw new Error(`WePay token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: undefined, // WePay tokens don't expire by default
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error(
      'WePay access tokens do not expire. If token is invalid, re-authorize via OAuth flow.',
    );
  }

  // ── Write-back: CrewShift → WePay ───────────────────────────────────────

  async createPayment(
    accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const accountId = getAccountId();

    const response = await wepayFetch('/checkout/create', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        account_id: Number(accountId),
        short_description: paymentData.description ?? 'CrewShift Payment',
        type: paymentData.type ?? 'service',
        amount: paymentData.amount,
        currency: paymentData.currency ?? 'USD',
        fee: paymentData.fee ? { app_fee: paymentData.fee } : undefined,
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.checkout_id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    // WePay IPN verification: verify by making a /checkout call to confirm state
    // For basic HMAC verification if configured:
    const secret = getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    return {
      provider: this.provider,
      event_type: (payload.topic as string) ?? 'unknown',
      resource_type: (payload.resource as string) ?? 'checkout',
      resource_id: payload.checkout_id ? String(payload.checkout_id) : undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new WePayAdapter();
registerAdapter(adapter);
export default adapter;
