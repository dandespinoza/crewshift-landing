/**
 * EagleView Integration Adapter
 *
 * Tier 2 adapter for EagleView.
 * Handles OAuth2 and measurement report (job) sync.
 *
 * EagleView API Reference:
 * - Auth: https://developer.eagleview.com/docs/authentication
 * - Reports: https://developer.eagleview.com/docs/api-reference
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Reports represent aerial measurement reports
 * - No webhook support
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

const EV_AUTH_URL = 'https://auth.eagleview.com/oauth/authorize';
const EV_TOKEN_URL = 'https://auth.eagleview.com/oauth/token';
const EV_API_BASE = 'https://api.eagleview.com/v2';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.EAGLEVIEW_CLIENT_ID ?? env.EAGLEVIEW_CLIENT_ID;
  if (!id) throw new Error('EAGLEVIEW_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.EAGLEVIEW_CLIENT_SECRET ?? env.EAGLEVIEW_CLIENT_SECRET;
  if (!secret) throw new Error('EAGLEVIEW_CLIENT_SECRET is not configured');
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the EagleView API.
 */
async function evFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${EV_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'EagleView API error');
    throw new Error(`EagleView API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class EagleViewAdapter extends BaseAdapter {
  readonly provider = 'eagleview' as const;
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

    return `${EV_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/eagleview/callback`;

    const response = await fetch(EV_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'EagleView token exchange failed');
      throw new Error(`EagleView token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for EagleView');
    }

    const response = await fetch(EV_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'EagleView token refresh failed');
      throw new Error(`EagleView token refresh failed: ${response.status}`);
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

  // ── Sync: EagleView → CrewShift ───────────────────────────────────────────

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
        params.set('since', lastSyncAt);
      }

      const response = await evFetch(`/reports?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const reports = (data.reports as Record<string, unknown>[]) ?? (data.results as Record<string, unknown>[]) ?? [];

      for (const report of reports) {
        try {
          records.push(this.mapEagleViewReport(report));
          created++;
        } catch (err) {
          errors.push({ item: report, error: (err as Error).message });
        }
      }

      if (reports.length < DEFAULT_PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += DEFAULT_PAGE_SIZE;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'EagleView report sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported by EagleView) ──────────────────────────────────

  // verifyWebhook and processWebhook — inherited no-ops from BaseAdapter

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapEagleViewReport(report: Record<string, unknown>): Record<string, unknown> {
    const address = report.address as Record<string, unknown> | undefined;

    return {
      title: (report.report_name as string) ?? `EagleView Report ${report.report_id ?? report.id}`,
      status: ((report.status as string) ?? 'unknown').toLowerCase(),
      description: (report.product_type as string) ?? null,
      location: address
        ? {
            street: (address.street as string) ?? (address.line1 as string) ?? '',
            city: (address.city as string) ?? '',
            state: (address.state as string) ?? '',
            zip: (address.zip as string) ?? (address.postal_code as string) ?? '',
            country: 'US',
            latitude: address.latitude as number | undefined,
            longitude: address.longitude as number | undefined,
          }
        : null,
      external_ids: { eagleview: String(report.report_id ?? report.id) },
      source: 'eagleview',
      metadata: {
        ev_report_id: report.report_id ?? report.id,
        ev_order_id: report.order_id,
        ev_status: report.status,
        ev_product_type: report.product_type,
        ev_created_date: report.created_date,
        ev_completed_date: report.completed_date,
        ev_measurements: report.measurements,
        ev_report_url: report.report_url,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new EagleViewAdapter();
registerAdapter(adapter);
export default adapter;
