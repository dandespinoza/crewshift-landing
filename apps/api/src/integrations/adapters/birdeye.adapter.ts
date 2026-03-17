/**
 * Birdeye Integration Adapter
 *
 * Tier 2 adapter for Birdeye.
 * Handles API key authentication, review (customer feedback) sync, and webhooks.
 *
 * Birdeye API Reference:
 * - API Docs: https://developer.birdeye.com/docs
 * - Reviews: https://developer.birdeye.com/docs/reviews-api
 *
 * Key details:
 * - API Key authentication via query parameter (api_key=)
 * - No OAuth flow — API key provisioned from Birdeye dashboard
 * - Reviews synced as customer records (feedback data)
 * - Webhook verification via API key comparison
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

const BE_API_BASE = 'https://api.birdeye.com/resources/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.BIRDEYE_API_KEY ?? env.BIRDEYE_API_KEY;
  if (!key) throw new Error('BIRDEYE_API_KEY is not configured');
  return key;
}

function getBusinessId(): string {
  const id = process.env.BIRDEYE_BUSINESS_ID ?? env.BIRDEYE_BUSINESS_ID;
  if (!id) throw new Error('BIRDEYE_BUSINESS_ID is not configured');
  return id;
}

/**
 * Make an authenticated request to the Birdeye API.
 * Birdeye uses API key as a query parameter.
 */
async function birdeyeFetch(
  path: string,
  extraParams: Record<string, string> = {},
  options: RequestInit = {},
): Promise<Response> {
  const apiKey = getApiKey();
  const params = new URLSearchParams({
    api_key: apiKey,
    ...extraParams,
  });

  const separator = path.includes('?') ? '&' : '?';
  const url = `${BE_API_BASE}${path}${separator}${params.toString()}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, path, errorBody }, 'Birdeye API error');
    throw new Error(`Birdeye API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class BirdeyeAdapter extends BaseAdapter {
  readonly provider = 'birdeye' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ─────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Birdeye uses API key authentication, not OAuth. Configure BIRDEYE_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Birdeye uses API key authentication. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Birdeye uses API key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Birdeye → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    _accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Sync reviews as customer feedback records
    const businessId = getBusinessId();
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor = 0;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, string> = {
        sindex: String(cursor),
        count: String(DEFAULT_PAGE_SIZE),
      };
      if (lastSyncAt) {
        params.fromDate = new Date(lastSyncAt).toISOString().split('T')[0];
      }

      const response = await birdeyeFetch(
        `/business/${businessId}/review`,
        params,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const reviews = (data as unknown as Record<string, unknown>[]) ?? [];

      // Birdeye may return an array directly or nested
      const reviewList = Array.isArray(data) ? data : (data.reviews as Record<string, unknown>[]) ?? [];

      for (const review of reviewList) {
        try {
          records.push(this.mapBirdeyeReview(review));
          created++;
        } catch (err) {
          errors.push({ item: review, error: (err as Error).message });
        }
      }

      if (reviewList.length < DEFAULT_PAGE_SIZE) {
        hasMore = false;
      } else {
        cursor += DEFAULT_PAGE_SIZE;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Birdeye review sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    // Birdeye webhook verification uses API key comparison
    const apiKey = getApiKey();

    // Verify using HMAC-SHA256 of payload with API key
    const hash = createHmac('sha256', apiKey)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Birdeye webhook: { type, businessId, data: { reviewId, rating, ... } }
    const eventType = (payload.type as string) ?? (payload.event as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? payload;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'review',
      resource_id: (data.reviewId as string) ?? (data.id as string) ?? undefined,
      data: payload,
      timestamp: (data.reviewDate as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapBirdeyeReview(review: Record<string, unknown>): Record<string, unknown> {
    const reviewer = review.reviewer as Record<string, unknown> | undefined;

    return {
      name: (reviewer?.nickName as string) ?? (reviewer?.firstName as string) ?? null,
      company_name: null,
      email: null, // Birdeye reviews don't expose reviewer email
      phone: null,
      address: null,
      external_ids: { birdeye: String(review.reviewId ?? review.id) },
      source: 'birdeye',
      metadata: {
        birdeye_rating: review.rating,
        birdeye_review_text: review.comments ?? review.reviewText,
        birdeye_source_type: review.sourceType ?? review.reviewSource,
        birdeye_review_date: review.reviewDate,
        birdeye_response: review.response,
        birdeye_business_id: review.businessId,
        birdeye_status: review.status,
        birdeye_reviewer_name: reviewer?.nickName ?? reviewer?.firstName,
        birdeye_reviewer_image: reviewer?.thumbnailUrl,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new BirdeyeAdapter();
registerAdapter(adapter);
export default adapter;
