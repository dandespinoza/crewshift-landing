/**
 * OpenGov Integration Adapter
 *
 * Tier 2 adapter for OpenGov.
 * Handles OAuth2, permit data (job) sync, and webhook verification.
 *
 * OpenGov API Reference:
 * - Auth: https://developer.opengov.com/docs/authentication
 * - Permits: https://developer.opengov.com/docs/permits-api
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Permits synced as jobs (building permits, inspections)
 * - Standard HMAC webhook verification
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

const OG_AUTH_URL = 'https://auth.opengov.com/oauth/authorize';
const OG_TOKEN_URL = 'https://auth.opengov.com/oauth/token';
const OG_API_BASE = 'https://api.opengov.com/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.OPENGOV_CLIENT_ID ?? env.OPENGOV_CLIENT_ID;
  if (!id) throw new Error('OPENGOV_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.OPENGOV_CLIENT_SECRET ?? env.OPENGOV_CLIENT_SECRET;
  if (!secret) throw new Error('OPENGOV_CLIENT_SECRET is not configured');
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the OpenGov API.
 */
async function ogFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${OG_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'OpenGov API error');
    throw new Error(`OpenGov API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class OpenGovAdapter extends BaseAdapter {
  readonly provider = 'opengov' as const;
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

    return `${OG_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/opengov/callback`;

    const response = await fetch(OG_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'OpenGov token exchange failed');
      throw new Error(`OpenGov token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for OpenGov');
    }

    const response = await fetch(OG_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'OpenGov token refresh failed');
      throw new Error(`OpenGov token refresh failed: ${response.status}`);
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

  // ── Sync: OpenGov → CrewShift ─────────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(DEFAULT_PAGE_SIZE),
      });
      if (lastSyncAt) {
        params.set('updated_since', lastSyncAt);
      }

      const response = await ogFetch(`/permits?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const permits = (data.permits as Record<string, unknown>[]) ?? (data.results as Record<string, unknown>[]) ?? (data.data as Record<string, unknown>[]) ?? [];

      for (const permit of permits) {
        try {
          records.push(this.mapOpenGovPermit(permit));
          created++;
        } catch (err) {
          errors.push({ item: permit, error: (err as Error).message });
        }
      }

      const totalCount = (data.total as number) ?? (data.total_count as number) ?? 0;
      offset += DEFAULT_PAGE_SIZE;

      if (offset >= totalCount || permits.length === 0) {
        hasMore = false;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'OpenGov permit sync complete',
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
    // OpenGov webhook: { event, data: { permit_id, permit_number, status, ... } }
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? payload;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'permit',
      resource_id: (data.permit_id as string) ?? (data.id as string) ?? undefined,
      data: payload,
      timestamp: (data.updated_at as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapOpenGovPermit(permit: Record<string, unknown>): Record<string, unknown> {
    const address = permit.address as Record<string, unknown> | undefined;
    const location = permit.location as Record<string, unknown> | undefined;
    const addr = address ?? location;

    return {
      title: (permit.permit_number as string) ?? (permit.record_number as string) ?? `Permit ${permit.id}`,
      status: ((permit.status as string) ?? 'unknown').toLowerCase(),
      description: (permit.description as string) ?? (permit.permit_type as string) ?? null,
      location: addr
        ? {
            street: (addr.street as string) ?? (addr.address as string) ?? '',
            city: (addr.city as string) ?? '',
            state: (addr.state as string) ?? '',
            zip: (addr.zip as string) ?? (addr.postal_code as string) ?? '',
            country: 'US',
          }
        : null,
      start: (permit.issued_date as string) ?? (permit.applied_date as string) ?? null,
      end: (permit.expiration_date as string) ?? (permit.finaled_date as string) ?? null,
      external_ids: { opengov: String(permit.id ?? permit.permit_id) },
      source: 'opengov',
      metadata: {
        og_permit_id: permit.id ?? permit.permit_id,
        og_permit_number: permit.permit_number ?? permit.record_number,
        og_permit_type: permit.permit_type ?? permit.record_type,
        og_status: permit.status,
        og_applied_date: permit.applied_date,
        og_issued_date: permit.issued_date,
        og_expiration_date: permit.expiration_date,
        og_finaled_date: permit.finaled_date,
        og_applicant: permit.applicant,
        og_contractor: permit.contractor,
        og_valuation: permit.valuation,
        og_inspections: permit.inspections,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new OpenGovAdapter();
registerAdapter(adapter);
export default adapter;
