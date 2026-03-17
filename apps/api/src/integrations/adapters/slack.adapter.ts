/**
 * Slack Integration Adapter
 *
 * Native (Tier 1) adapter for Slack messaging platform.
 * Handles OAuth 2.0 bot token auth, webhook verification, and event processing.
 *
 * Slack API Reference:
 * - OAuth V2: https://api.slack.com/authentication/oauth-v2
 * - Web API: https://api.slack.com/web
 * - Events API: https://api.slack.com/events-api
 * - Request Verification: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Key details:
 * - OAuth 2.0 for workspace installation (bot tokens)
 * - Slack bot tokens (xoxb-*) do not expire — no refresh needed
 * - Webhook verification: HMAC-SHA256 using the signing secret
 *   Signature = v0=sha256(v0:timestamp:body)
 *   Compared against X-Slack-Signature header
 * - Events API uses a challenge-response URL verification
 * - Rate limit: Tier-based (1+ req/sec for most methods)
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

const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_API_BASE = 'https://slack.com/api';
const SLACK_SCOPES = 'chat:write,channels:read';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const clientId = process.env.SLACK_CLIENT_ID ?? (env as Record<string, unknown>).SLACK_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('SLACK_CLIENT_ID is not configured');
  return clientId;
}

function getClientSecret(): string {
  const clientSecret = process.env.SLACK_CLIENT_SECRET ?? (env as Record<string, unknown>).SLACK_CLIENT_SECRET as string | undefined;
  if (!clientSecret) throw new Error('SLACK_CLIENT_SECRET is not configured');
  return clientSecret;
}

function getSigningSecret(): string {
  const secret = process.env.SLACK_SIGNING_SECRET ?? (env as Record<string, unknown>).SLACK_SIGNING_SECRET as string | undefined;
  if (!secret) throw new Error('SLACK_SIGNING_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Slack Web API.
 */
async function slackFetch(
  method: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const url = `${SLACK_API_BASE}/${method}`;

  const options: RequestInit = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, method, errorBody },
      'Slack API HTTP error',
    );
    throw new Error(`Slack API HTTP error: ${response.status} — ${errorBody}`);
  }

  // Slack returns 200 even for logical errors — check the `ok` field
  const data = (await response.json()) as Record<string, unknown>;
  if (!data.ok) {
    logger.error(
      { method, error: data.error, response_metadata: data.response_metadata },
      'Slack API logical error',
    );
    throw new Error(`Slack API error: ${data.error}`);
  }

  // Return a synthetic Response with the parsed data for consistency
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SlackAdapter extends BaseAdapter {
  readonly provider = 'slack' as const;
  readonly tier = 'native' as const;

  // ── OAuth ───────────────────────────────────────────────────────────────

  /**
   * Generate the Slack OAuth authorization URL.
   *
   * Uses OAuth V2 flow for Slack apps:
   * - client_id: The app's client ID
   * - scope: Bot token scopes (e.g., chat:write, channels:read)
   * - redirect_uri: Where to redirect after authorization
   * - state: Used to verify the request (set to orgId)
   */
  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      scope: SLACK_SCOPES,
      redirect_uri: redirectUri,
      state: orgId,
    });

    return `${SLACK_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Handle the Slack OAuth callback and exchange the code for a bot token.
   *
   * The oauth.v2.access endpoint returns:
   * - ok: boolean
   * - access_token: The bot token (xoxb-*)
   * - token_type: "bot"
   * - scope: Granted scopes
   * - bot_user_id: Bot user ID
   * - app_id: App ID
   * - team: { id, name }
   * - authed_user: { id, scope, access_token, token_type }
   */
  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(SLACK_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${env.API_URL}/api/integrations/slack/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, errorBody },
        'Slack token exchange HTTP error',
      );
      throw new Error(`Slack token exchange failed: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (!data.ok) {
      logger.error(
        { error: data.error },
        'Slack token exchange logical error',
      );
      throw new Error(`Slack token exchange error: ${data.error}`);
    }

    const team = data.team as Record<string, unknown> | undefined;

    return {
      access_token: data.access_token as string,
      refresh_token: undefined, // Slack bot tokens don't use refresh tokens
      expires_at: undefined, // Slack bot tokens don't expire
      scope: `team_id:${team?.id ?? 'unknown'}|${data.scope as string ?? ''}`,
    };
  }

  /**
   * Slack bot tokens do not expire and cannot be refreshed.
   * If a token is revoked, the workspace must re-authorize the app.
   */
  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error("Slack tokens don't expire — re-install the app if the token was revoked");
  }

  // ── Sync (not applicable — messaging platform) ──────────────────────────

  // Base class no-op implementations are sufficient for a messaging adapter.

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a Slack webhook/event request signature.
   *
   * Slack request verification:
   * 1. Extract X-Slack-Request-Timestamp header
   * 2. Concatenate: v0:{timestamp}:{raw_body}
   * 3. Compute HMAC-SHA256 using the signing secret
   * 4. Prepend "v0=" to the hex digest
   * 5. Compare with X-Slack-Signature header
   *
   * The payload Buffer should contain the string: "v0:{timestamp}:{raw_body}"
   * pre-assembled by the webhook middleware.
   * The signature parameter should be the full X-Slack-Signature value (e.g., "v0=abc123...").
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    let signingSecret: string;
    try {
      signingSecret = getSigningSecret();
    } catch {
      logger.warn('No Slack signing secret configured for webhook verification');
      return false;
    }

    const hash = `v0=${createHmac('sha256', signingSecret).update(payload).digest('hex')}`;

    // Timing-safe comparison
    try {
      const hashBuf = Buffer.from(hash);
      const sigBuf = Buffer.from(signature);

      if (hashBuf.length !== sigBuf.length) return false;
      return timingSafeEqual(hashBuf, sigBuf);
    } catch {
      return false;
    }
  }

  /**
   * Parse a Slack Events API payload into a normalized WebhookEvent.
   *
   * Slack Events API payload structure:
   * - token: Verification token (deprecated — use signing secret)
   * - type: "event_callback" or "url_verification"
   * - team_id: Workspace ID
   * - api_app_id: App ID
   * - event: The actual event object
   *   - type: Event type (e.g., "message", "app_mention", "member_joined_channel")
   *   - user: User ID who triggered the event
   *   - text: Message text (for message events)
   *   - channel: Channel ID
   *   - ts: Event timestamp
   *   - event_ts: Event timestamp (same as ts usually)
   *   - channel_type: "channel", "group", "im", or "mpim"
   * - event_id: Unique event ID
   * - event_time: Unix timestamp
   *
   * For url_verification challenges:
   * - type: "url_verification"
   * - challenge: Challenge string to echo back
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const type = payload.type as string | undefined;
    const event = payload.event as Record<string, unknown> | undefined;
    const eventId = payload.event_id as string | undefined;
    const eventTime = payload.event_time as number | undefined;

    // Handle URL verification challenge
    if (type === 'url_verification') {
      return {
        provider: this.provider,
        event_type: 'url_verification',
        resource_type: 'challenge',
        resource_id: undefined,
        data: {
          type: 'url_verification',
          challenge: payload.challenge ?? null,
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Regular event callback
    const eventType = event?.type as string | undefined;
    const subtype = event?.subtype as string | undefined;
    const normalizedEventType = subtype
      ? `${eventType}.${subtype}`
      : eventType ?? 'unknown';

    return {
      provider: this.provider,
      event_type: normalizedEventType,
      resource_type: eventType ?? 'event',
      resource_id: eventId,
      data: {
        type: eventType ?? null,
        subtype: subtype ?? null,
        user: event?.user ?? null,
        text: event?.text ?? null,
        channel: event?.channel ?? null,
        channel_type: event?.channel_type ?? null,
        ts: event?.ts ?? null,
        thread_ts: event?.thread_ts ?? null,
        team_id: payload.team_id ?? null,
        api_app_id: payload.api_app_id ?? null,
        event_id: eventId ?? null,
        // Bot message fields
        bot_id: event?.bot_id ?? null,
        bot_profile: event?.bot_profile ?? null,
        // File-related fields
        files: event?.files ?? null,
        // Reaction fields
        reaction: event?.reaction ?? null,
        item: event?.item ?? null,
      },
      timestamp: eventTime
        ? new Date(eventTime * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  // ── Public Helpers ──────────────────────────────────────────────────────

  /**
   * Send a message to a Slack channel using the Web API.
   */
  async postMessage(
    accessToken: string,
    channel: string,
    text: string,
    options?: { thread_ts?: string; blocks?: unknown[] },
  ): Promise<Record<string, unknown>> {
    const response = await slackFetch('chat.postMessage', accessToken, {
      channel,
      text,
      thread_ts: options?.thread_ts,
      blocks: options?.blocks,
    });

    const result = (await response.json()) as Record<string, unknown>;
    logger.info(
      { channel, ts: result.ts },
      'Slack message posted',
    );

    return result;
  }

  /**
   * List channels the bot has access to.
   */
  async listChannels(
    accessToken: string,
    cursor?: string,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      types: 'public_channel,private_channel',
      limit: 200,
    };
    if (cursor) body.cursor = cursor;

    const response = await slackFetch('conversations.list', accessToken, body);
    const result = (await response.json()) as Record<string, unknown>;

    return result;
  }

  /**
   * Get information about a Slack user.
   */
  async getUserInfo(
    accessToken: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    const response = await slackFetch('users.info', accessToken, { user: userId });
    const result = (await response.json()) as Record<string, unknown>;
    return result;
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SlackAdapter();
registerAdapter(adapter);
export default adapter;
