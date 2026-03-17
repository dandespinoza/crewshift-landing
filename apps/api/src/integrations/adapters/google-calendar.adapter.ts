/**
 * Google Calendar Integration Adapter
 *
 * Native (Tier 1) adapter for Google Calendar.
 * Handles OAuth 2.0, calendar event sync, and push notification webhooks.
 *
 * Google Calendar API Reference:
 * - Auth: https://developers.google.com/identity/protocols/oauth2
 * - Events: https://developers.google.com/calendar/api/v3/reference/events
 * - Push Notifications: https://developers.google.com/calendar/api/guides/push
 *
 * Key details:
 * - OAuth2 with offline access for refresh tokens
 * - Events API supports incremental sync via timeMin and syncToken
 * - Pagination via pageToken with default 250 events per page
 * - Push notifications use channel tokens for verification
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

// -- Constants ----------------------------------------------------------------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const MAX_RESULTS_PER_PAGE = 250;

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the Google Calendar API.
 */
async function googleFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${GOOGLE_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Google Calendar API error',
    );
    throw new Error(`Google Calendar API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map a Google Calendar event to the CrewShift unified job format.
 */
function mapEventToJob(event: Record<string, unknown>): Record<string, unknown> {
  const start = event.start as Record<string, unknown> | undefined;
  const end = event.end as Record<string, unknown> | undefined;

  return {
    title: (event.summary as string) ?? 'Untitled Event',
    start: (start?.dateTime as string) ?? (start?.date as string) ?? null,
    end: (end?.dateTime as string) ?? (end?.date as string) ?? null,
    location: (event.location as string) ?? null,
    description: (event.description as string) ?? null,
    status: (event.status as string) ?? 'confirmed',
    external_ids: { 'google-calendar': event.id as string },
    source: 'google-calendar',
    metadata: {
      google_event_id: event.id,
      google_calendar_id: event.organizer
        ? (event.organizer as Record<string, unknown>).email
        : null,
      google_html_link: event.htmlLink,
      google_updated: event.updated,
      google_recurring_event_id: event.recurringEventId ?? null,
      google_attendees_count: Array.isArray(event.attendees)
        ? (event.attendees as unknown[]).length
        : 0,
    },
  };
}

// -- Adapter ------------------------------------------------------------------

class GoogleCalendarAdapter extends BaseAdapter {
  readonly provider = 'google-calendar' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: orgId,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/google-calendar/callback`;

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Google Calendar token exchange failed');
      throw new Error(`Google Calendar token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Google Calendar');
    }

    const clientId = env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Google Calendar token refresh failed');
      throw new Error(`Google Calendar token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: currentTokens.refresh_token, // Google does not always return a new refresh token
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // -- Sync: Google Calendar -> CrewShift -------------------------------------

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        maxResults: String(MAX_RESULTS_PER_PAGE),
        singleEvents: 'true',
        orderBy: 'startTime',
      });

      if (lastSyncAt) {
        params.set('timeMin', lastSyncAt);
      } else {
        // Default: sync events from the last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        params.set('timeMin', thirtyDaysAgo.toISOString());
      }

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const response = await googleFetch(
        `/calendars/primary/events?${params.toString()}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const items = (data.items as Record<string, unknown>[]) ?? [];

      for (const event of items) {
        try {
          // Skip cancelled events
          if (event.status === 'cancelled') continue;

          const mapped = mapEventToJob(event);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: event, error: (err as Error).message });
        }
      }

      pageToken = data.nextPageToken as string | undefined;
    } while (pageToken);

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Google Calendar event sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * Verify Google push notification webhook.
   *
   * Google Calendar push notifications use channel-based verification:
   * - X-Goog-Channel-Token: a secret token set when creating the watch channel
   * - X-Goog-Resource-State: the type of notification (sync, exists, not_exists)
   *
   * The signature parameter is expected to contain the X-Goog-Channel-Token value.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    // The signature is the X-Goog-Channel-Token header value.
    // It should match a secret we set when registering the watch channel.
    const expectedToken = env.GOOGLE_CLIENT_SECRET;
    if (!expectedToken) {
      logger.warn('No Google webhook channel token configured');
      return false;
    }

    // Use a constant-time comparison to prevent timing attacks
    if (signature.length !== expectedToken.length) return false;

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedToken);
    if (sigBuf.length !== expectedBuf.length) return false;

    let mismatch = 0;
    for (let i = 0; i < sigBuf.length; i++) {
      mismatch |= sigBuf[i]! ^ expectedBuf[i]!;
    }
    return mismatch === 0;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Google push notifications include headers as the main signal:
    // X-Goog-Resource-State: sync | exists | not_exists
    // X-Goog-Resource-ID: the resource being watched
    // X-Goog-Channel-ID: the channel ID we provided
    const resourceState = (payload['X-Goog-Resource-State'] as string) ?? (payload.resourceState as string) ?? 'unknown';
    const resourceId = (payload['X-Goog-Resource-ID'] as string) ?? (payload.resourceId as string) ?? undefined;

    return {
      provider: this.provider,
      event_type: resourceState,
      resource_type: 'event',
      resource_id: resourceId,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new GoogleCalendarAdapter();
registerAdapter(adapter);
export default adapter;
