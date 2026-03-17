/**
 * Tyler EnerGov Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Tyler Technologies EnerGov.
 * Handles OAuth2 and permit record sync.
 *
 * Tyler EnerGov API Reference:
 * - API Base: https://api.tylertech.com/energov/v1
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - Permit sync via GET /permits
 * - NOTE: Enterprise contract required, documentation available upon request
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

const TYLER_API_BASE = 'https://api.tylertech.com/energov/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.TYLER_CLIENT_ID;
  if (!id) throw new Error('TYLER_CLIENT_ID is not configured — enterprise contract with Tyler Technologies required');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.TYLER_CLIENT_SECRET;
  if (!secret) throw new Error('TYLER_CLIENT_SECRET is not configured — enterprise contract with Tyler Technologies required');
  return secret;
}

/**
 * Make an authenticated request to the Tyler EnerGov API.
 */
async function tylerFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${TYLER_API_BASE}${path}`;

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
      'Tyler EnerGov API error',
    );
    throw new Error(`Tyler EnerGov API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class TylerEnerGovAdapter extends BaseAdapter {
  readonly provider = 'tyler-energov' as const;
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

    return `https://auth.tylertech.com/oauth2/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch('https://auth.tylertech.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/tyler-energov/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Tyler EnerGov token exchange failed');
      throw new Error(`Tyler EnerGov token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Tyler EnerGov');
    }

    const response = await fetch('https://auth.tylertech.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
      logger.error({ status: response.status, errorBody }, 'Tyler EnerGov token refresh failed');
      throw new Error(`Tyler EnerGov token refresh failed: ${response.status}`);
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

  // ── Sync: Tyler EnerGov → CrewShift ─────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await tylerFetch('/permits', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const permits = (data.permits as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const permit of permits) {
      try {
        records.push({
          title: `Permit — ${permit.permitNumber ?? 'N/A'}`,
          status: permit.status ?? null,
          scheduled_start: permit.issuedDate ?? null,
          scheduled_end: permit.expirationDate ?? null,
          external_ids: { 'tyler-energov': String(permit.id) },
          source: 'tyler-energov',
          metadata: {
            tyler_permit_number: permit.permitNumber,
            tyler_permit_type: permit.permitType,
            tyler_project_name: permit.projectName,
            tyler_jurisdiction: permit.jurisdiction,
            tyler_applicant: permit.applicantName,
            tyler_address: permit.address,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: permit, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: permits.length, created, errors: errors.length },
      'Tyler EnerGov permit sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new TylerEnerGovAdapter();
registerAdapter(adapter);
export default adapter;
