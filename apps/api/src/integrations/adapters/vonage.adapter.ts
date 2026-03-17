/**
 * Vonage (formerly Nexmo) Integration Adapter
 *
 * Native (Tier 1) adapter for Vonage communications platform.
 * Handles SMS/messaging webhooks and message sending via Vonage APIs.
 *
 * Vonage API Reference:
 * - Messages API: https://developer.vonage.com/en/api/messages-olympus
 * - SMS API (legacy): https://developer.vonage.com/en/api/sms
 * - JWT Auth: https://developer.vonage.com/en/getting-started/concepts/authentication
 * - Webhooks: https://developer.vonage.com/en/getting-started/concepts/webhooks
 *
 * Key details:
 * - Two auth methods: API Key + Secret (basic), or JWT from Application ID + Private Key
 * - Legacy API base: https://api.nexmo.com
 * - New Messages API base: https://api.vonage.com/v1/messages
 * - JWT tokens are generated locally (no token URL — signed with private key)
 * - Webhook verification uses JWT signature on inbound payloads or HMAC-SHA256
 */

import { createHmac, createSign } from 'node:crypto';
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

const VONAGE_API_BASE_LEGACY = 'https://api.nexmo.com';
const VONAGE_API_BASE = 'https://api.vonage.com';
const VONAGE_MESSAGES_API = `${VONAGE_API_BASE}/v1/messages`;
const VONAGE_SMS_API = `${VONAGE_API_BASE_LEGACY}/sms/json`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.VONAGE_API_KEY ?? (env as Record<string, unknown>).VONAGE_API_KEY as string | undefined;
  if (!key) throw new Error('VONAGE_API_KEY is not configured');
  return key;
}

function getApiSecret(): string {
  const secret = process.env.VONAGE_API_SECRET ?? (env as Record<string, unknown>).VONAGE_API_SECRET as string | undefined;
  if (!secret) throw new Error('VONAGE_API_SECRET is not configured');
  return secret;
}

function getApplicationId(): string | undefined {
  return process.env.VONAGE_APPLICATION_ID ?? (env as Record<string, unknown>).VONAGE_APPLICATION_ID as string | undefined;
}

function getPrivateKey(): string | undefined {
  return process.env.VONAGE_PRIVATE_KEY ?? (env as Record<string, unknown>).VONAGE_PRIVATE_KEY as string | undefined;
}

/**
 * Generate a Vonage JWT for application-level authentication.
 *
 * The JWT is created locally by signing with the application's private key.
 * Claims include: application_id, iat, jti, and exp.
 */
function generateVonageJwt(): string {
  const applicationId = getApplicationId();
  const privateKey = getPrivateKey();

  if (!applicationId || !privateKey) {
    throw new Error('VONAGE_APPLICATION_ID and VONAGE_PRIVATE_KEY are required for JWT auth');
  }

  const now = Math.floor(Date.now() / 1000);
  const jti = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const claims = {
    application_id: applicationId,
    iat: now,
    jti,
    exp: now + 900, // 15-minute expiry
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${headerB64}.${claimsB64}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKey, 'base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Make an authenticated request to the Vonage Messages API using JWT.
 */
async function vonageFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const jwt = generateVonageJwt();

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, url, errorBody },
      'Vonage API error',
    );
    throw new Error(`Vonage API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Make an authenticated request using API Key + Secret (for legacy SMS API).
 */
async function vonageLegacyFetch(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      api_secret: apiSecret,
      ...body,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, url, errorBody },
      'Vonage legacy API error',
    );
    throw new Error(`Vonage API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class VonageAdapter extends BaseAdapter {
  readonly provider = 'vonage' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — JWT/API key auth) ───────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Vonage uses JWT/API Key auth — OAuth flow is not supported');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Vonage uses JWT/API Key auth — OAuth callback is not supported');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Vonage uses JWT/API Key auth — token refresh is not supported');
  }

  // ── Sync (not applicable — communication service) ───────────────────────

  // Base class no-op implementations are sufficient for a communication adapter.

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a Vonage webhook request.
   *
   * Vonage supports two verification methods:
   * 1. JWT signature verification (Messages API) — verify the JWT in the Authorization header
   * 2. HMAC-SHA256 signature verification — compute HMAC of the payload using the signature secret
   *
   * This implementation uses HMAC-SHA256 with the API secret as the key,
   * which works for both inbound message webhooks and status webhooks.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const apiSecret = process.env.VONAGE_API_SECRET ?? (env as Record<string, unknown>).VONAGE_API_SECRET as string | undefined;
    if (!apiSecret) {
      logger.warn('No Vonage API secret configured for webhook verification');
      return false;
    }

    // Vonage uses HMAC-SHA256 with the signature secret
    // The signature is a hex-encoded hash prefixed with "sha256="
    const hash = createHmac('sha256', apiSecret)
      .update(payload)
      .digest('hex');

    const expectedSignature = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;

    // Timing-safe comparison
    if (hash.length !== expectedSignature.length) return false;

    let result = 0;
    for (let i = 0; i < hash.length; i++) {
      result |= hash.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Parse a Vonage webhook payload into a normalized WebhookEvent.
   *
   * Vonage Messages API webhook payload:
   * - type: Message type (e.g., "text", "image")
   * - message_uuid: Unique message identifier
   * - from: Sender details { type, number }
   * - to: Recipient details { type, number }
   * - text: Message content (for text messages)
   * - timestamp: ISO 8601 timestamp
   * - status: Message status (for status webhooks)
   *
   * Legacy SMS API webhook:
   * - msisdn: Sender number
   * - to: Recipient number
   * - messageId: Message ID
   * - text: Message text
   * - type: "text"
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Determine if this is a Messages API or legacy SMS webhook
    const messageUuid = payload.message_uuid as string | undefined;
    const messageId = payload.messageId as string | undefined;
    const status = payload.status as string | undefined;

    // Messages API format
    if (messageUuid) {
      const from = payload.from as Record<string, unknown> | undefined;
      const to = payload.to as Record<string, unknown> | undefined;

      return {
        provider: this.provider,
        event_type: status ?? 'message.inbound',
        resource_type: 'message',
        resource_id: messageUuid,
        data: {
          message_uuid: messageUuid,
          type: payload.type ?? 'text',
          from_type: from?.type ?? null,
          from_number: from?.number ?? null,
          to_type: to?.type ?? null,
          to_number: to?.number ?? null,
          text: payload.text ?? null,
          channel: payload.channel ?? null,
          status: status ?? null,
        },
        timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
      };
    }

    // Legacy SMS format
    return {
      provider: this.provider,
      event_type: status ?? 'sms.inbound',
      resource_type: 'sms',
      resource_id: messageId,
      data: {
        message_id: messageId ?? null,
        type: payload.type ?? 'text',
        from: payload.msisdn ?? null,
        to: payload.to ?? null,
        text: payload.text ?? null,
        keyword: payload.keyword ?? null,
        message_timestamp: payload['message-timestamp'] ?? null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ── Public Helpers ──────────────────────────────────────────────────────

  /**
   * Send an SMS via the Vonage Messages API.
   */
  async sendSms(to: string, text: string, from: string): Promise<Record<string, unknown>> {
    const response = await vonageFetch(VONAGE_MESSAGES_API, {
      method: 'POST',
      body: JSON.stringify({
        message_type: 'text',
        text,
        to,
        from,
        channel: 'sms',
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { messageUuid: result.message_uuid, to, from },
      'Vonage SMS sent',
    );

    return result;
  }

  /**
   * Send an SMS via the legacy Vonage (Nexmo) SMS API.
   */
  async sendSmsLegacy(to: string, text: string, from: string): Promise<Record<string, unknown>> {
    const response = await vonageLegacyFetch(VONAGE_SMS_API, {
      to,
      from,
      text,
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { to, from },
      'Vonage legacy SMS sent',
    );

    return result;
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new VonageAdapter();
registerAdapter(adapter);
export default adapter;
