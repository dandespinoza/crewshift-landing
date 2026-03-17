/**
 * Postmark Integration Adapter
 *
 * Native (Tier 1) adapter for Postmark transactional email service.
 * Handles email sending, delivery tracking, and webhook processing.
 *
 * Postmark API Reference:
 * - API Overview: https://postmarkapp.com/developer
 * - Sending Email: https://postmarkapp.com/developer/api/email-api
 * - Webhooks: https://postmarkapp.com/developer/webhooks/webhooks-overview
 * - Bounce Webhook: https://postmarkapp.com/developer/webhooks/bounce-webhook
 *
 * Key details:
 * - Authentication uses Server Token in X-Postmark-Server-Token header
 * - No OAuth flow — server token based only
 * - API base: https://api.postmarkapp.com
 * - No built-in webhook signature verification — use shared secret URL comparison
 * - Webhook payloads include RecordType to identify the event kind
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
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

const POSTMARK_API_BASE = 'https://api.postmarkapp.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getServerToken(): string {
  const token = process.env.POSTMARK_SERVER_TOKEN ?? (env as Record<string, unknown>).POSTMARK_SERVER_TOKEN as string | undefined;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the Postmark API.
 */
async function postmarkFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${POSTMARK_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Postmark-Server-Token': getServerToken(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Postmark API error',
    );
    throw new Error(`Postmark API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class PostmarkAdapter extends BaseAdapter {
  readonly provider = 'postmark' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable) ──────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Postmark uses Server Token auth — OAuth flow is not supported');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Postmark uses Server Token auth — OAuth callback is not supported');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Postmark uses Server Token auth — token refresh is not supported');
  }

  // ── Sync (not applicable — email delivery service) ──────────────────────

  // Base class no-op implementations are sufficient for an email delivery adapter.

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a Postmark webhook request.
   *
   * Postmark does not have built-in webhook signature verification.
   * The recommended approach is:
   * 1. Use a secret token in the webhook URL (e.g., /webhooks/postmark?secret=xyz)
   * 2. Compare the provided signature (secret from query string) against
   *    the configured server token using a timing-safe comparison.
   *
   * The payload Buffer is not used for verification. Instead, the signature
   * parameter should contain the shared secret from the webhook URL query string.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const serverToken = process.env.POSTMARK_SERVER_TOKEN ?? (env as Record<string, unknown>).POSTMARK_SERVER_TOKEN as string | undefined;
    if (!serverToken) {
      logger.warn('No Postmark server token configured for webhook verification');
      return false;
    }

    // Timing-safe comparison of the shared secret
    try {
      const sigBuf = Buffer.from(signature);
      const tokenBuf = Buffer.from(serverToken);

      if (sigBuf.length !== tokenBuf.length) return false;
      return timingSafeEqual(sigBuf, tokenBuf);
    } catch {
      return false;
    }
  }

  /**
   * Parse a Postmark webhook payload into a normalized WebhookEvent.
   *
   * Postmark webhook payload structure varies by RecordType:
   *
   * Delivery:
   * - RecordType: "Delivery"
   * - MessageID: Unique message ID
   * - Recipient: Email recipient
   * - DeliveredAt: ISO 8601 timestamp
   * - Tag: Message tag
   *
   * Bounce:
   * - RecordType: "Bounce"
   * - MessageID: Message ID
   * - Type: Bounce type (HardBounce, SoftBounce, etc.)
   * - Email: Bounced email address
   * - BouncedAt: ISO 8601 timestamp
   * - Description: Bounce reason
   *
   * SpamComplaint:
   * - RecordType: "SpamComplaint"
   * - MessageID: Message ID
   * - Email: Complainant email
   *
   * Open:
   * - RecordType: "Open"
   * - MessageID: Message ID
   * - Recipient: Email
   * - FirstOpen: boolean
   *
   * Click:
   * - RecordType: "Click"
   * - MessageID: Message ID
   * - Recipient: Email
   * - OriginalLink: URL clicked
   *
   * SubscriptionChange:
   * - RecordType: "SubscriptionChange"
   * - Recipient: Email
   * - SuppressSending: boolean
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const recordType = payload.RecordType as string | undefined;
    const messageId = payload.MessageID as string | undefined;
    const recipient = payload.Recipient as string | undefined;
    const email = payload.Email as string | undefined;

    // Map RecordType to a normalized event type
    const eventTypeMap: Record<string, string> = {
      Delivery: 'email.delivered',
      Bounce: 'email.bounced',
      SpamComplaint: 'email.spam_complaint',
      Open: 'email.opened',
      Click: 'email.clicked',
      SubscriptionChange: 'email.subscription_change',
    };

    const eventType = eventTypeMap[recordType ?? ''] ?? `email.${(recordType ?? 'unknown').toLowerCase()}`;

    // Extract timestamp from various fields based on record type
    const timestamp =
      (payload.DeliveredAt as string) ??
      (payload.BouncedAt as string) ??
      (payload.ReceivedAt as string) ??
      new Date().toISOString();

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'email',
      resource_id: messageId,
      data: {
        record_type: recordType ?? null,
        message_id: messageId ?? null,
        recipient: recipient ?? email ?? null,
        tag: payload.Tag ?? null,
        server_id: payload.ServerID ?? null,
        // Bounce-specific fields
        bounce_type: payload.Type ?? null,
        type_code: payload.TypeCode ?? null,
        description: payload.Description ?? null,
        details: payload.Details ?? null,
        // Open/Click-specific fields
        first_open: payload.FirstOpen ?? null,
        original_link: payload.OriginalLink ?? null,
        client: payload.Client ?? null,
        os: payload.OS ?? null,
        platform: payload.Platform ?? null,
        geo: payload.Geo ?? null,
        // Subscription-specific fields
        suppress_sending: payload.SuppressSending ?? null,
        message_stream: payload.MessageStream ?? null,
      },
      timestamp,
    };
  }

  // ── Public Helpers ──────────────────────────────────────────────────────

  /**
   * Send an email via Postmark.
   */
  async sendEmail(
    to: string,
    subject: string,
    body: { text?: string; html?: string },
    from: string,
  ): Promise<Record<string, unknown>> {
    const response = await postmarkFetch('/email', {
      method: 'POST',
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: body.text ?? undefined,
        HtmlBody: body.html ?? undefined,
        MessageStream: 'outbound',
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { messageId: result.MessageID, to, subject },
      'Postmark email sent',
    );

    return result;
  }

  /**
   * Send an email using a Postmark template.
   */
  async sendEmailWithTemplate(
    to: string,
    templateAlias: string,
    templateModel: Record<string, unknown>,
    from: string,
  ): Promise<Record<string, unknown>> {
    const response = await postmarkFetch('/email/withTemplate', {
      method: 'POST',
      body: JSON.stringify({
        From: from,
        To: to,
        TemplateAlias: templateAlias,
        TemplateModel: templateModel,
        MessageStream: 'outbound',
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { messageId: result.MessageID, to, templateAlias },
      'Postmark template email sent',
    );

    return result;
  }

  /**
   * Get delivery statistics from Postmark.
   */
  async getDeliveryStats(): Promise<Record<string, unknown>> {
    const response = await postmarkFetch('/deliverystats');
    const data = (await response.json()) as Record<string, unknown>;
    return data;
  }

  /**
   * Get bounced messages from Postmark.
   */
  async getBounces(count = 50, offset = 0): Promise<Record<string, unknown>> {
    const response = await postmarkFetch(`/bounces?count=${count}&offset=${offset}`);
    const data = (await response.json()) as Record<string, unknown>;
    return data;
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new PostmarkAdapter();
registerAdapter(adapter);
export default adapter;
