/**
 * NiceJob Integration Adapter
 *
 * Tier 3 (native) adapter for NiceJob — reputation marketing and review platform.
 * Handles OAuth 2.0 auth, reviews sync, and token-based webhook verification.
 *
 * NiceJob API Reference:
 * - Auth: https://developer.nicejob.com/docs/authentication
 * - Reviews: https://developer.nicejob.com/docs/reviews
 *
 * Key details:
 * - Developer application approval required
 * - API is currently in ALPHA — endpoints and payloads may change
 * - OAuth 2.0 with standard code exchange
 * - syncCustomers pulls reviews/reputation data rather than contacts
 * - Webhook verification via token comparison
 * - Env: NICEJOB_CLIENT_ID, NICEJOB_CLIENT_SECRET
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

const AUTH_URL = 'https://api.nicejob.com/oauth/authorize';
const TOKEN_URL = 'https://api.nicejob.com/oauth/token';
const API_BASE = 'https://api.nicejob.com/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.NICEJOB_CLIENT_ID ?? (env as Record<string, unknown>).NICEJOB_CLIENT_ID as string | undefined;
  if (!id) throw new Error('NICEJOB_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.NICEJOB_CLIENT_SECRET ?? (env as Record<string, unknown>).NICEJOB_CLIENT_SECRET as string | undefined;
  if (!secret) throw new Error('NICEJOB_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the NiceJob API.
 */
async function nicejobFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

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
      'NiceJob API error',
    );
    throw new Error(`NiceJob API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through NiceJob list endpoints using offset-based pagination.
 * Note: API is in ALPHA — pagination style may change.
 */
async function nicejobPaginateAll(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const searchParams = new URLSearchParams({
      limit: String(DEFAULT_PAGE_SIZE),
      offset: String(offset),
      ...params,
    });

    const response = await nicejobFetch(
      `${path}?${searchParams.toString()}`,
      accessToken,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? (data.reviews as Record<string, unknown>[]) ?? [];

    results.push(...items);

    hasMore = items.length === DEFAULT_PAGE_SIZE;
    offset += DEFAULT_PAGE_SIZE;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class NiceJobAdapter extends BaseAdapter {
  readonly provider = 'nicejob' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${env.API_URL}/api/integrations/nicejob/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'NiceJob token exchange failed');
      throw new Error(`NiceJob token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for NiceJob');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'NiceJob token refresh failed');
      throw new Error(`NiceJob token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: NiceJob → CrewShift ──────────────────────────────────────────

  /**
   * Sync reviews/reputation data from NiceJob.
   * NiceJob is primarily a reputation platform, so "customers" here
   * are reviews with associated reviewer information.
   *
   * Note: API is in ALPHA — endpoint structure may change.
   */
  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const reviews = await nicejobPaginateAll('/reviews', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const review of reviews) {
      try {
        const mapped = this.mapReview(review);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: review, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: reviews.length, created, errors: errors.length },
      'NiceJob review sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  /**
   * Verify webhook by comparing the provided token against the client secret.
   * NiceJob uses token-based verification for webhook authenticity.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const secret = process.env.NICEJOB_CLIENT_SECRET ?? (env as Record<string, unknown>).NICEJOB_CLIENT_SECRET as string | undefined;
    if (!secret) {
      logger.warn('No NiceJob client secret configured for webhook verification');
      return false;
    }

    return signature === secret;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: (payload.resource_type as string) ?? 'review',
      resource_id: (data?.id as string) ?? (payload.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a NiceJob Review to CrewShift's unified customer format.
   * Reviews contain reviewer info that maps to customer-like records.
   */
  private mapReview(review: Record<string, unknown>): Record<string, unknown> {
    const reviewer = review.reviewer as Record<string, unknown> | undefined;

    return {
      name: (reviewer?.name as string) ?? (review.reviewer_name as string) ?? null,
      company_name: null,
      email: (reviewer?.email as string) ?? null,
      phone: (reviewer?.phone as string) ?? null,
      address: null,
      external_ids: { nicejob: String(review.id) },
      source: 'nicejob',
      metadata: {
        nicejob_rating: review.rating,
        nicejob_content: review.content ?? review.text,
        nicejob_platform: review.platform ?? review.source,
        nicejob_status: review.status,
        nicejob_created_at: review.created_at ?? review.createdAt,
        nicejob_api_alpha: true,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new NiceJobAdapter();
registerAdapter(adapter);
export default adapter;
