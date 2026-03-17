/**
 * HOVER Integration Adapter
 *
 * Tier 2 adapter for HOVER.
 * Handles OAuth2, property measurement job sync, and webhook verification.
 *
 * HOVER API Reference:
 * - Auth: https://developer.hover.to/docs/authentication
 * - Jobs: https://developer.hover.to/docs/api-reference
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Jobs represent property measurement jobs (3D models, measurements)
 * - Pagination via page parameter
 * - Webhook signature verification
 * - Rate limit: 120 requests per minute
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

const HOVER_AUTH_URL = 'https://accounts.hover.to/oauth/authorize';
const HOVER_TOKEN_URL = 'https://accounts.hover.to/oauth/token';
const HOVER_API_BASE = 'https://api.hover.to/api/v2';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.HOVER_CLIENT_ID ?? env.HOVER_CLIENT_ID;
  if (!id) throw new Error('HOVER_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.HOVER_CLIENT_SECRET ?? env.HOVER_CLIENT_SECRET;
  if (!secret) throw new Error('HOVER_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the HOVER API.
 */
async function hoverFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${HOVER_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, path, errorBody }, 'HOVER API error');
    throw new Error(`HOVER API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class HoverAdapter extends BaseAdapter {
  readonly provider = 'hover' as const;
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

    return `${HOVER_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/hover/callback`;

    const response = await fetch(HOVER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'HOVER token exchange failed');
      throw new Error(`HOVER token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for HOVER');
    }

    const response = await fetch(HOVER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'HOVER token refresh failed');
      throw new Error(`HOVER token refresh failed: ${response.status}`);
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

  // ── Sync: HOVER → CrewShift ───────────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(DEFAULT_PAGE_SIZE),
      });
      if (lastSyncAt) {
        params.set('updated_since', lastSyncAt);
      }

      const response = await hoverFetch(`/jobs?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const jobs = (data.results as Record<string, unknown>[]) ?? (data.jobs as Record<string, unknown>[]) ?? [];

      for (const job of jobs) {
        try {
          records.push(this.mapHoverJob(job));
          created++;
        } catch (err) {
          errors.push({ item: job, error: (err as Error).message });
        }
      }

      // Check pagination
      const pagination = data.pagination as Record<string, unknown> | undefined;
      const totalPages = (pagination?.total_pages as number) ?? 1;

      if (page >= totalPages || jobs.length === 0) {
        hasMore = false;
      } else {
        page++;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'HOVER job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // HOVER webhook: { event, job: { id, state, ... }, timestamp }
    const eventType = (payload.event as string) ?? 'unknown';
    const job = (payload.job as Record<string, unknown>) ?? {};

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'job',
      resource_id: (job.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapHoverJob(job: Record<string, unknown>): Record<string, unknown> {
    const location = job.location as Record<string, unknown> | undefined;
    const deliverable = job.deliverable as Record<string, unknown> | undefined;

    return {
      title: (job.name as string) ?? `HOVER Job ${job.id}`,
      status: ((job.state as string) ?? 'unknown').toLowerCase(),
      description: (job.notes as string) ?? null,
      location: location
        ? {
            street: (location.line_1 as string) ?? '',
            city: (location.city as string) ?? '',
            state: (location.region as string) ?? '',
            zip: (location.postal_code as string) ?? '',
            country: (location.country_code as string) ?? '',
            latitude: location.latitude as number | undefined,
            longitude: location.longitude as number | undefined,
          }
        : null,
      external_ids: { hover: String(job.id) },
      source: 'hover',
      metadata: {
        hover_state: job.state,
        hover_created_at: job.created_at,
        hover_updated_at: job.updated_at,
        hover_deliverable_id: deliverable?.id,
        hover_model_url: job.model_url,
        hover_measurements: job.measurements,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new HoverAdapter();
registerAdapter(adapter);
export default adapter;
