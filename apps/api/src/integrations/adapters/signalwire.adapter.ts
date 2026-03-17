/**
 * SignalWire Integration Adapter
 *
 * Native (Tier 1) adapter for SignalWire communications platform.
 * Handles SMS/voice webhooks and messaging via SignalWire REST API.
 *
 * SignalWire API Reference:
 * - REST API: https://developer.signalwire.com/compatibility-api/rest
 * - Authentication: https://developer.signalwire.com/guides/signing-api-calls
 * - Webhooks: https://developer.signalwire.com/guides/how-to-use-webhooks
 *
 * Key details:
 * - Authentication uses HTTP Basic Auth with Project ID + API Token
 * - API is Twilio-compatible (same REST structure under a different domain)
 * - Each SignalWire account has a unique "space" (subdomain)
 * - Webhook verification uses HMAC-SHA1 similar to Twilio
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getProjectId(): string {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID ?? (env as Record<string, unknown>).SIGNALWIRE_PROJECT_ID as string | undefined;
  if (!projectId) throw new Error('SIGNALWIRE_PROJECT_ID is not configured');
  return projectId;
}

function getToken(): string {
  const token = process.env.SIGNALWIRE_TOKEN ?? (env as Record<string, unknown>).SIGNALWIRE_TOKEN as string | undefined;
  if (!token) throw new Error('SIGNALWIRE_TOKEN is not configured');
  return token;
}

function getSpace(): string {
  const space = process.env.SIGNALWIRE_SPACE ?? (env as Record<string, unknown>).SIGNALWIRE_SPACE as string | undefined;
  if (!space) throw new Error('SIGNALWIRE_SPACE is not configured');
  return space;
}

function getApiBase(): string {
  return `https://${getSpace()}.signalwire.com/api/laml/2010-04-01/Accounts/${getProjectId()}`;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getProjectId()}:${getToken()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the SignalWire REST API.
 */
async function signalwireFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBase()}/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getBasicAuthHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'SignalWire API error',
    );
    throw new Error(`SignalWire API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SignalWireAdapter extends BaseAdapter {
  readonly provider = 'signalwire' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable) ──────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('SignalWire uses Basic Auth — OAuth flow is not supported');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('SignalWire uses Basic Auth — OAuth callback is not supported');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('SignalWire uses Basic Auth — token refresh is not supported');
  }

  // ── Sync (not applicable — communication service) ───────────────────────

  // Base class no-op implementations are sufficient for a communication adapter.

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a SignalWire webhook request.
   *
   * SignalWire uses the same request validation algorithm as Twilio:
   * 1. Take the full URL of the request
   * 2. For POST, sort params alphabetically and concatenate name+value to URL
   * 3. Compute HMAC-SHA1 with the API token as the key
   * 4. Base64-encode and compare to X-SignalWire-Signature header
   *
   * The payload Buffer should be the concatenated URL + sorted params string
   * pre-assembled by the webhook middleware.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const token = process.env.SIGNALWIRE_TOKEN ?? (env as Record<string, unknown>).SIGNALWIRE_TOKEN as string | undefined;
    if (!token) {
      logger.warn('No SignalWire token configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha1', token)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  /**
   * Parse a SignalWire webhook payload into a normalized WebhookEvent.
   *
   * SignalWire uses Twilio-compatible webhook format:
   * - MessageSid: Unique message identifier
   * - From: Sender phone number
   * - To: Recipient phone number
   * - Body: Message text
   * - MessageStatus: Message delivery status
   * - CallSid / CallStatus: For voice webhooks
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const messageSid = payload.MessageSid as string | undefined;
    const messageStatus = payload.MessageStatus as string | undefined;
    const callSid = payload.CallSid as string | undefined;
    const callStatus = payload.CallStatus as string | undefined;

    const isVoice = !!callSid && !messageSid;
    const resourceType = isVoice ? 'call' : 'message';
    const resourceId = isVoice ? callSid : messageSid;
    const eventType = isVoice
      ? (callStatus ?? 'call.received')
      : (messageStatus ?? 'message.received');

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId,
      data: {
        message_sid: messageSid ?? null,
        call_sid: callSid ?? null,
        from: payload.From ?? null,
        to: payload.To ?? null,
        body: payload.Body ?? null,
        status: messageStatus ?? callStatus ?? null,
        num_media: payload.NumMedia ?? null,
        account_sid: payload.AccountSid ?? null,
        direction: payload.Direction ?? null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ── Public Helpers ──────────────────────────────────────────────────────

  /**
   * Send an SMS message via SignalWire.
   */
  async sendSms(to: string, body: string, from: string): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    });

    const response = await signalwireFetch('Messages.json', {
      method: 'POST',
      body: params.toString(),
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { messageSid: result.sid, to, from },
      'SignalWire SMS sent',
    );

    return result;
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SignalWireAdapter();
registerAdapter(adapter);
export default adapter;
