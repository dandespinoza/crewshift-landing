/**
 * Simply Business Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Simply Business.
 * Handles OAuth2 and insurance quote sync.
 *
 * Simply Business API Reference:
 * - API Base: https://api.simplybusiness.com/v1
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - Quote sync via GET /quotes
 * - NOTE: Strategic partnership required for API access
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

const SIMPLY_BUSINESS_API_BASE = 'https://api.simplybusiness.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.SIMPLY_BUSINESS_CLIENT_ID;
  if (!id) throw new Error('SIMPLY_BUSINESS_CLIENT_ID is not configured — strategic partnership required');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.SIMPLY_BUSINESS_CLIENT_SECRET;
  if (!secret) throw new Error('SIMPLY_BUSINESS_CLIENT_SECRET is not configured — strategic partnership required');
  return secret;
}

/**
 * Make an authenticated request to the Simply Business API.
 */
async function simplyBusinessFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SIMPLY_BUSINESS_API_BASE}${path}`;

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
    logger.error(
      { status: response.status, path, errorBody },
      'Simply Business API error',
    );
    throw new Error(`Simply Business API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SimplyBusinessAdapter extends BaseAdapter {
  readonly provider = 'simply-business' as const;
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

    return `https://app.simplybusiness.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(`${SIMPLY_BUSINESS_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/simply-business/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Simply Business token exchange failed');
      throw new Error(`Simply Business token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Simply Business');
    }

    const response = await fetch(`${SIMPLY_BUSINESS_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      logger.error({ status: response.status, errorBody }, 'Simply Business token refresh failed');
      throw new Error(`Simply Business token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  // ── Sync: Simply Business → CrewShift ───────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await simplyBusinessFetch('/quotes', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const quotes = (data.quotes as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const quote of quotes) {
      try {
        records.push({
          title: `Insurance Quote — ${quote.quoteNumber ?? 'N/A'}`,
          status: quote.status ?? null,
          scheduled_start: quote.effectiveDate ?? null,
          scheduled_end: quote.expirationDate ?? null,
          external_ids: { 'simply-business': String(quote.id) },
          source: 'simply-business',
          metadata: {
            sb_quote_number: quote.quoteNumber,
            sb_coverage_type: quote.coverageType,
            sb_premium: quote.premium,
            sb_deductible: quote.deductible,
            sb_business_type: quote.businessType,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: quote, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: quotes.length, created, errors: errors.length },
      'Simply Business quote sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SimplyBusinessAdapter();
registerAdapter(adapter);
export default adapter;
