/**
 * Worldpay Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Worldpay (FIS).
 * Handles Basic Auth, payment authorization, and webhook verification.
 *
 * Worldpay API Reference:
 * - Sandbox: https://try.access.worldpay.com
 * - Production: https://access.worldpay.com
 * - Payments: POST /payments/authorizations
 *
 * Key details:
 * - Basic Auth with merchant code and XML password
 * - Payment authorization via POST /payments/authorizations
 * - Webhook signature verification
 * - NOTE: Implementation Manager required for production access
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

const WORLDPAY_SANDBOX_BASE = 'https://try.access.worldpay.com';
const WORLDPAY_PRODUCTION_BASE = 'https://access.worldpay.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMerchantCode(): string {
  const code = process.env.WORLDPAY_MERCHANT_CODE;
  if (!code) throw new Error('WORLDPAY_MERCHANT_CODE is not configured — Implementation Manager required');
  return code;
}

function getXmlPassword(): string {
  const password = process.env.WORLDPAY_XML_PASSWORD;
  if (!password) throw new Error('WORLDPAY_XML_PASSWORD is not configured — Implementation Manager required');
  return password;
}

function getApiBase(): string {
  return env.NODE_ENV === 'production' ? WORLDPAY_PRODUCTION_BASE : WORLDPAY_SANDBOX_BASE;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getMerchantCode()}:${getXmlPassword()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Worldpay API.
 */
async function worldpayFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBase()}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getBasicAuthHeader(),
      'Content-Type': 'application/vnd.worldpay.payments-v6+json',
      'Accept': 'application/vnd.worldpay.payments-v6+json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Worldpay API error',
    );
    throw new Error(`Worldpay API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class WorldpayAdapter extends BaseAdapter {
  readonly provider = 'worldpay' as const;
  readonly tier = 'native' as const;

  // ── Auth (Basic Auth — no OAuth) ─────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'Worldpay uses Basic Auth (merchant code + XML password), not OAuth. Configure WORLDPAY_MERCHANT_CODE and WORLDPAY_XML_PASSWORD.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Worldpay uses Basic Auth, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Worldpay uses Basic Auth credentials. No token refresh required.');
  }

  // ── Write-back: CrewShift → Worldpay ────────────────────────────────────

  async createPayment(
    _accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const response = await worldpayFetch('/payments/authorizations', {
      method: 'POST',
      body: JSON.stringify({
        transactionReference: paymentData.reference ?? `cs_${Date.now()}`,
        merchant: {
          entity: getMerchantCode(),
        },
        instruction: {
          narrative: {
            line1: paymentData.description ?? 'CrewShift Payment',
          },
          value: {
            currency: paymentData.currency ?? 'USD',
            amount: Math.round((paymentData.amount as number) * 100), // cents
          },
          paymentInstrument: paymentData.paymentInstrument ?? {},
        },
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: (result.outcome as Record<string, unknown>)?.transactionReference
        ? String((result.outcome as Record<string, unknown>).transactionReference)
        : String(result._links ?? 'unknown'),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getXmlPassword();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    return {
      provider: this.provider,
      event_type: (payload.eventType as string) ?? 'unknown',
      resource_type: 'payment',
      resource_id: payload.transactionReference ? String(payload.transactionReference) : undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new WorldpayAdapter();
registerAdapter(adapter);
export default adapter;
