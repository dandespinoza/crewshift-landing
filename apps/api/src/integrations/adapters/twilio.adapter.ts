/**
 * Twilio Integration Adapter
 *
 * Native (Tier 1) adapter for Twilio communications platform.
 * Handles SMS/voice webhooks and message sending via Twilio REST API.
 *
 * Twilio API Reference:
 * - REST API: https://www.twilio.com/docs/usage/api
 * - Request Validation: https://www.twilio.com/docs/usage/security#validating-requests
 * - Webhooks: https://www.twilio.com/docs/usage/webhooks
 *
 * Key details:
 * - Authentication uses HTTP Basic Auth with Account SID + Auth Token
 * - No OAuth flow — API key based authentication only
 * - Webhook verification: HMAC-SHA1 of URL + sorted POST params
 * - Rate limits vary by endpoint and account tier
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

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAccountSid(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? env.TWILIO_ACCOUNT_SID;
  if (!sid) throw new Error('TWILIO_ACCOUNT_SID is not configured');
  return sid;
}

function getAuthToken(): string {
  const token = process.env.TWILIO_AUTH_TOKEN ?? env.TWILIO_AUTH_TOKEN;
  if (!token) throw new Error('TWILIO_AUTH_TOKEN is not configured');
  return token;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getAccountSid()}:${getAuthToken()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Twilio REST API.
 */
async function twilioFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const accountSid = getAccountSid();
  const url = `${TWILIO_API_BASE}/${accountSid}/${path}`;

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
      'Twilio API error',
    );
    throw new Error(`Twilio API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class TwilioAdapter extends BaseAdapter {
  readonly provider = 'twilio' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable) ──────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Twilio uses Basic Auth — OAuth flow is not supported');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Twilio uses Basic Auth — OAuth callback is not supported');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Twilio uses Basic Auth — token refresh is not supported');
  }

  // ── Sync (not applicable — communication service) ───────────────────────

  // Base class no-op implementations are sufficient for a communication adapter.
  // Twilio is not a data store, so syncCustomers/syncJobs/syncInvoices return
  // empty results via the BaseAdapter defaults.

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a Twilio webhook request.
   *
   * Twilio request validation:
   * 1. Take the full URL of the request (including query string)
   * 2. If the request is a POST, sort all POST parameters alphabetically
   *    and concatenate each parameter name and value (no delimiter) to the URL
   * 3. Compute an HMAC-SHA1 hash using your AuthToken as the key and the
   *    resulting string as the message
   * 4. Base64-encode the hash and compare to the X-Twilio-Signature header
   *
   * For simplicity, the payload Buffer is treated as the concatenated URL + params
   * string that the webhook middleware has already assembled.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      logger.warn('No Twilio auth token configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha1', authToken)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  /**
   * Parse a Twilio webhook payload into a normalized WebhookEvent.
   *
   * Twilio SMS webhook payload fields:
   * - MessageSid: Unique message identifier
   * - AccountSid: Account identifier
   * - From: Sender phone number
   * - To: Recipient phone number
   * - Body: Message text
   * - NumMedia: Number of media attachments
   * - MessageStatus: Status of the message (for status callbacks)
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const messageSid = payload.MessageSid as string | undefined;
    const messageStatus = payload.MessageStatus as string | undefined;
    const callSid = payload.CallSid as string | undefined;
    const callStatus = payload.CallStatus as string | undefined;

    // Determine if this is an SMS or voice webhook
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
   * Send an SMS message via Twilio.
   */
  async sendSms(to: string, body: string, from?: string): Promise<Record<string, unknown>> {
    const fromNumber = from ?? process.env.TWILIO_FROM_NUMBER ?? env.TWILIO_FROM_NUMBER;
    if (!fromNumber) {
      throw new Error('TWILIO_FROM_NUMBER is not configured');
    }

    const params = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    });

    const response = await twilioFetch('Messages.json', {
      method: 'POST',
      body: params.toString(),
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { messageSid: result.sid, to, from: fromNumber },
      'Twilio SMS sent',
    );

    return result;
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new TwilioAdapter();
registerAdapter(adapter);
export default adapter;
