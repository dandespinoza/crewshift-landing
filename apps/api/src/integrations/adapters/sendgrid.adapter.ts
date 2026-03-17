/**
 * SendGrid Integration Adapter
 *
 * Native (Tier 1) adapter for SendGrid email platform.
 * Handles email sending and event webhook processing.
 *
 * SendGrid API Reference:
 * - Mail Send: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 * - Event Webhook: https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook
 * - Webhook Verification: https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 *
 * Key details:
 * - Authentication uses Bearer token (API key) in Authorization header
 * - No OAuth flow — API key based only
 * - Webhook verification uses ECDSA signature with SendGrid's public verification key
 * - Event webhooks deliver arrays of events in a single POST
 * - Rate limit: Based on plan tier
 */

import { createVerify, createPublicKey } from 'node:crypto';
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

const SENDGRID_API_BASE = 'https://api.sendgrid.com/v3';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.SENDGRID_API_KEY ?? (env as Record<string, unknown>).SENDGRID_API_KEY as string | undefined;
  if (!key) throw new Error('SENDGRID_API_KEY is not configured');
  return key;
}

function getWebhookVerificationKey(): string | undefined {
  return process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY ?? (env as Record<string, unknown>).SENDGRID_WEBHOOK_VERIFICATION_KEY as string | undefined;
}

/**
 * Make an authenticated request to the SendGrid API.
 */
async function sendgridFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SENDGRID_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'SendGrid API error',
    );
    throw new Error(`SendGrid API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SendGridAdapter extends BaseAdapter {
  readonly provider = 'sendgrid' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable) ──────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('SendGrid uses API Key auth — OAuth flow is not supported');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('SendGrid uses API Key auth — OAuth callback is not supported');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('SendGrid uses API Key auth — token refresh is not supported');
  }

  // ── Sync (not applicable — email delivery service) ──────────────────────

  // Base class no-op implementations are sufficient for an email delivery adapter.

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a SendGrid Event Webhook signature.
   *
   * SendGrid uses Elliptic Curve Digital Signature Algorithm (ECDSA) with P-256.
   * Verification steps:
   * 1. Concatenate the timestamp + payload body
   * 2. Verify the ECDSA signature against SendGrid's public verification key
   * 3. The signature is provided in the X-Twilio-Email-Event-Webhook-Signature header
   * 4. The timestamp is in the X-Twilio-Email-Event-Webhook-Timestamp header
   *
   * For this method, the payload Buffer should contain: timestamp + raw body
   * and the signature parameter should be the base64-encoded ECDSA signature.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const verificationKey = getWebhookVerificationKey();
    if (!verificationKey) {
      logger.warn('No SendGrid webhook verification key configured');
      return false;
    }

    try {
      // SendGrid provides an ECDSA public key in base64 format
      // Convert to a PEM-formatted public key for verification
      const publicKey = createPublicKey({
        key: Buffer.from(verificationKey, 'base64'),
        format: 'der',
        type: 'spki',
      });

      const verifier = createVerify('SHA256');
      verifier.update(payload);

      return verifier.verify(publicKey, signature, 'base64');
    } catch (err) {
      logger.error(
        { error: (err as Error).message },
        'SendGrid webhook verification error',
      );
      return false;
    }
  }

  /**
   * Parse a SendGrid Event Webhook payload into a normalized WebhookEvent.
   *
   * SendGrid event webhook delivers an array of events, each containing:
   * - event: Event type (delivered, open, click, bounce, dropped, deferred, etc.)
   * - email: Recipient email address
   * - timestamp: Unix timestamp
   * - sg_message_id: SendGrid internal message ID
   * - sg_event_id: Unique event ID
   * - category: User-defined category tags
   * - reason: Reason for bounces/drops
   * - response: SMTP server response
   * - url: Clicked URL (for click events)
   * - useragent: User agent string (for open/click events)
   * - ip: IP address (for open/click events)
   *
   * Note: The payload is typically an array. We process the first event and
   * attach the full batch in the data field for downstream processing.
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // SendGrid sends an array of events; the payload may be wrapped or raw
    const events = Array.isArray(payload)
      ? payload as Array<Record<string, unknown>>
      : (payload.events as Array<Record<string, unknown>> | undefined) ?? [payload];

    const firstEvent = events[0] ?? {};

    const eventType = firstEvent.event as string | undefined;
    const sgMessageId = firstEvent.sg_message_id as string | undefined;
    const email = firstEvent.email as string | undefined;
    const timestamp = firstEvent.timestamp as number | undefined;

    return {
      provider: this.provider,
      event_type: eventType ?? 'unknown',
      resource_type: 'email',
      resource_id: sgMessageId,
      data: {
        event: eventType ?? null,
        email: email ?? null,
        sg_message_id: sgMessageId ?? null,
        sg_event_id: firstEvent.sg_event_id ?? null,
        reason: firstEvent.reason ?? null,
        response: firstEvent.response ?? null,
        category: firstEvent.category ?? null,
        url: firstEvent.url ?? null,
        useragent: firstEvent.useragent ?? null,
        ip: firstEvent.ip ?? null,
        batch_size: events.length,
        all_events: events,
      },
      timestamp: timestamp
        ? new Date(timestamp * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  // ── Public Helpers ──────────────────────────────────────────────────────

  /**
   * Send an email via SendGrid Mail Send API v3.
   */
  async sendEmail(
    to: string | string[],
    subject: string,
    content: { type: 'text/plain' | 'text/html'; value: string },
    from: { email: string; name?: string },
  ): Promise<Record<string, unknown>> {
    const toArray = Array.isArray(to) ? to : [to];
    const personalizations = [
      {
        to: toArray.map((email) => ({ email })),
      },
    ];

    const response = await sendgridFetch('/mail/send', {
      method: 'POST',
      body: JSON.stringify({
        personalizations,
        from,
        subject,
        content: [content],
      }),
    });

    // SendGrid returns 202 Accepted with no body on success
    const messageId = response.headers.get('X-Message-Id') ?? undefined;

    logger.info(
      { messageId, to: toArray, subject },
      'SendGrid email sent',
    );

    return { message_id: messageId, status: 'accepted' };
  }

  /**
   * Get suppression bounces from SendGrid.
   */
  async getSuppressionBounces(): Promise<Record<string, unknown>[]> {
    const response = await sendgridFetch('/suppression/bounces');
    const data = (await response.json()) as Record<string, unknown>[];
    return data;
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SendGridAdapter();
registerAdapter(adapter);
export default adapter;
