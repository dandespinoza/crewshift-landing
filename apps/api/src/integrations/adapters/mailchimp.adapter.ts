/**
 * Mailchimp Integration Adapter
 *
 * Native (Tier 1) adapter for Mailchimp email marketing platform.
 * Handles OAuth 2.0 auth, audience member sync, and webhook processing.
 *
 * Mailchimp API Reference:
 * - Marketing API: https://mailchimp.com/developer/marketing/api/
 * - OAuth 2.0: https://mailchimp.com/developer/marketing/guides/access-user-data-oauth-2/
 * - Webhooks: https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/
 *
 * Key details:
 * - OAuth 2.0 for user authorization; API key also supported for direct access
 * - After OAuth, call metadata endpoint to discover data center (dc)
 * - API base varies by data center: https://{dc}.api.mailchimp.com/3.0
 * - List members are paginated with offset/count params (max 1000 per page)
 * - Webhooks use URL secret (no signature verification)
 * - Rate limit: 10 concurrent connections per user
 */

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

const MAILCHIMP_AUTH_URL = 'https://login.mailchimp.com/oauth2/authorize';
const MAILCHIMP_TOKEN_URL = 'https://login.mailchimp.com/oauth2/token';
const MAILCHIMP_METADATA_URL = 'https://login.mailchimp.com/oauth2/metadata';
const MAILCHIMP_MAX_PAGE_SIZE = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const clientId = process.env.MAILCHIMP_CLIENT_ID ?? (env as Record<string, unknown>).MAILCHIMP_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('MAILCHIMP_CLIENT_ID is not configured');
  return clientId;
}

function getClientSecret(): string {
  const clientSecret = process.env.MAILCHIMP_CLIENT_SECRET ?? (env as Record<string, unknown>).MAILCHIMP_CLIENT_SECRET as string | undefined;
  if (!clientSecret) throw new Error('MAILCHIMP_CLIENT_SECRET is not configured');
  return clientSecret;
}

/**
 * Discover the Mailchimp data center for an access token by calling the
 * OAuth 2.0 metadata endpoint.
 *
 * Returns the data center string (e.g., "us1", "us6").
 */
async function getDataCenter(accessToken: string): Promise<string> {
  const response = await fetch(MAILCHIMP_METADATA_URL, {
    headers: {
      'Authorization': `OAuth ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, errorBody },
      'Mailchimp metadata request failed',
    );
    throw new Error(`Mailchimp metadata request failed: ${response.status}`);
  }

  const metadata = (await response.json()) as Record<string, unknown>;
  const dc = metadata.dc as string | undefined;

  if (!dc) {
    throw new Error('Unable to determine Mailchimp data center from metadata');
  }

  return dc;
}

/**
 * Build the Mailchimp API base URL for a given data center.
 */
function getApiBase(dc: string): string {
  return `https://${dc}.api.mailchimp.com/3.0`;
}

/**
 * Make an authenticated request to the Mailchimp API.
 */
async function mailchimpFetch(
  dc: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBase(dc)}${path}`;

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
      { status: response.status, path, dc, errorBody },
      'Mailchimp API error',
    );
    throw new Error(`Mailchimp API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class MailchimpAdapter extends BaseAdapter {
  readonly provider = 'mailchimp' as const;
  readonly tier = 'native' as const;

  // ── OAuth ───────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: orgId,
    });

    return `${MAILCHIMP_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/mailchimp/callback`;

    const response = await fetch(MAILCHIMP_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, errorBody },
        'Mailchimp token exchange failed',
      );
      throw new Error(`Mailchimp token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;
    const accessToken = tokens.access_token as string;

    // Discover data center and store it in the scope field for later use
    const dc = await getDataCenter(accessToken);

    return {
      access_token: accessToken,
      refresh_token: undefined, // Mailchimp OAuth tokens don't expire but also can't be refreshed
      expires_at: undefined,
      scope: `dc:${dc}`, // Store data center in scope for later retrieval
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // Mailchimp OAuth tokens do not expire and cannot be refreshed.
    // If revoked, the user must re-authorize.
    throw new Error('Mailchimp OAuth tokens do not expire — re-authorize if revoked');
  }

  // ── Sync: Mailchimp → CrewShift ─────────────────────────────────────────

  /**
   * Sync audience members (contacts) from a Mailchimp list/audience.
   *
   * The accessToken should be in format "token|dc|listId" where:
   * - token: The OAuth access token
   * - dc: The data center (e.g., "us6")
   * - listId: The Mailchimp audience/list ID to sync
   */
  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, dc, listId] = this.parseAccessToken(accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let path = `/lists/${listId}/members?count=${MAILCHIMP_MAX_PAGE_SIZE}&offset=${offset}`;

      if (lastSyncAt) {
        path += `&since_last_changed=${encodeURIComponent(lastSyncAt)}`;
      }

      const response = await mailchimpFetch(dc, path, token);
      const data = (await response.json()) as Record<string, unknown>;
      const members = (data.members as Array<Record<string, unknown>>) ?? [];
      const totalItems = (data.total_items as number) ?? 0;

      for (const member of members) {
        try {
          const mapped = this.mapMailchimpMember(member, listId);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: member, error: (err as Error).message });
        }
      }

      offset += MAILCHIMP_MAX_PAGE_SIZE;
      hasMore = offset < totalItems;
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length, listId },
      'Mailchimp audience member sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Verify a Mailchimp webhook request.
   *
   * Mailchimp does not provide cryptographic webhook signatures.
   * Verification is done by comparing a shared secret included in the
   * webhook URL (e.g., /webhooks/mailchimp?secret=xyz).
   *
   * The signature parameter should contain the secret from the webhook URL.
   * We compare it against a hash of the client secret.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const clientSecret = process.env.MAILCHIMP_CLIENT_SECRET ?? (env as Record<string, unknown>).MAILCHIMP_CLIENT_SECRET as string | undefined;
    if (!clientSecret) {
      logger.warn('No Mailchimp client secret configured for webhook verification');
      return false;
    }

    // The webhook URL contains a secret token that should match what we configured
    // We do a simple constant-time string comparison
    if (signature.length !== clientSecret.length) return false;

    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ clientSecret.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Parse a Mailchimp webhook payload into a normalized WebhookEvent.
   *
   * Mailchimp webhook payload structure:
   * - type: Event type (subscribe, unsubscribe, profile, upemail, cleaned, campaign)
   * - fired_at: ISO 8601 timestamp of when the event occurred
   * - data: Object containing event-specific fields
   *   - id: Member ID (for member events)
   *   - email: Email address
   *   - email_type: "html" or "text"
   *   - list_id: Audience/list ID
   *   - merges: Merge field values (FNAME, LNAME, etc.)
   *   - ip_opt: IP address used for opt-in
   *   - ip_signup: IP address used for signup
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const type = payload.type as string | undefined;
    const firedAt = payload.fired_at as string | undefined;
    const data = payload.data as Record<string, unknown> | undefined;

    // Map Mailchimp webhook types to normalized event types
    const eventTypeMap: Record<string, string> = {
      subscribe: 'audience.subscribed',
      unsubscribe: 'audience.unsubscribed',
      profile: 'audience.profile_updated',
      upemail: 'audience.email_changed',
      cleaned: 'audience.cleaned',
      campaign: 'campaign.sent',
    };

    const eventType = eventTypeMap[type ?? ''] ?? `audience.${type ?? 'unknown'}`;

    const merges = data?.merges as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: type === 'campaign' ? 'campaign' : 'audience_member',
      resource_id: (data?.id as string) ?? undefined,
      data: {
        type: type ?? null,
        email: data?.email ?? null,
        email_type: data?.email_type ?? null,
        list_id: data?.list_id ?? null,
        first_name: merges?.FNAME ?? null,
        last_name: merges?.LNAME ?? null,
        ip_opt: data?.ip_opt ?? null,
        ip_signup: data?.ip_signup ?? null,
        reason: data?.reason ?? null,
        old_email: data?.old_email ?? null,
        new_email: data?.new_email ?? null,
      },
      timestamp: firedAt ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|dc|listId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string, string] {
    const parts = accessToken.split('|');
    if (parts.length < 3) {
      throw new Error('Mailchimp adapter requires accessToken in format "token|dc|listId"');
    }
    return [parts[0], parts[1], parts[2]];
  }

  /**
   * Map a Mailchimp list member to CrewShift's unified customer format.
   */
  private mapMailchimpMember(
    member: Record<string, unknown>,
    listId: string,
  ): Record<string, unknown> {
    const mergeFields = member.merge_fields as Record<string, unknown> | undefined;
    const location = member.location as Record<string, unknown> | undefined;
    const stats = member.stats as Record<string, unknown> | undefined;

    return {
      name: [mergeFields?.FNAME, mergeFields?.LNAME]
        .filter(Boolean)
        .join(' ') || null,
      email: member.email_address ?? null,
      phone: mergeFields?.PHONE ?? null,
      company_name: mergeFields?.COMPANY ?? null,
      address: mergeFields?.ADDRESS
        ? {
            street: (mergeFields.ADDRESS as Record<string, unknown>)?.addr1 ?? '',
            city: (mergeFields.ADDRESS as Record<string, unknown>)?.city ?? '',
            state: (mergeFields.ADDRESS as Record<string, unknown>)?.state ?? '',
            zip: (mergeFields.ADDRESS as Record<string, unknown>)?.zip ?? '',
          }
        : null,
      external_ids: { mailchimp: member.id as string },
      source: 'mailchimp',
      metadata: {
        mailchimp_list_id: listId,
        mailchimp_status: member.status,
        mailchimp_email_type: member.email_type,
        mailchimp_member_rating: member.member_rating,
        mailchimp_language: member.language,
        mailchimp_vip: member.vip,
        mailchimp_location: location
          ? { latitude: location.latitude, longitude: location.longitude }
          : null,
        mailchimp_tags: member.tags,
        mailchimp_open_rate: stats?.avg_open_rate,
        mailchimp_click_rate: stats?.avg_click_rate,
        mailchimp_last_changed: member.last_changed,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new MailchimpAdapter();
registerAdapter(adapter);
export default adapter;
