/**
 * Dispatch Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Dispatch.me.
 * Handles OAuth2 and job/work order sync.
 *
 * Dispatch API Reference:
 * - API Base: https://api.dispatch.me/v1
 *
 * Key details:
 * - OAuth2 authorization_code grant
 * - Job sync via GET /jobs
 * - NOTE: Enterprise only — contact sales for API access
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

const DISPATCH_API_BASE = 'https://api.dispatch.me/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.DISPATCH_CLIENT_ID;
  if (!id) throw new Error('DISPATCH_CLIENT_ID is not configured — enterprise access required, contact Dispatch sales');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.DISPATCH_CLIENT_SECRET;
  if (!secret) throw new Error('DISPATCH_CLIENT_SECRET is not configured — enterprise access required, contact Dispatch sales');
  return secret;
}

/**
 * Make an authenticated request to the Dispatch API.
 */
async function dispatchFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${DISPATCH_API_BASE}${path}`;

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
      'Dispatch API error',
    );
    throw new Error(`Dispatch API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class DispatchAdapter extends BaseAdapter {
  readonly provider = 'dispatch' as const;
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

    return `https://app.dispatch.me/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(`${DISPATCH_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/dispatch/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Dispatch token exchange failed');
      throw new Error(`Dispatch token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Dispatch');
    }

    const response = await fetch(`${DISPATCH_API_BASE}/oauth/token`, {
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
      logger.error({ status: response.status, errorBody }, 'Dispatch token refresh failed');
      throw new Error(`Dispatch token refresh failed: ${response.status}`);
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

  // ── Sync: Dispatch → CrewShift ──────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const response = await dispatchFetch('/jobs', accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const jobs = (data.jobs as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const job of jobs) {
      try {
        records.push({
          title: job.title ?? job.description ?? null,
          status: job.status ?? null,
          scheduled_start: job.scheduledAt ?? null,
          scheduled_end: job.completedAt ?? null,
          customer_external_id: job.customerId ? String(job.customerId) : null,
          external_ids: { dispatch: String(job.id) },
          source: 'dispatch',
          metadata: {
            dispatch_job_type: job.serviceType,
            dispatch_priority: job.priority,
            dispatch_address: job.address,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: job, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: jobs.length, created, errors: errors.length },
      'Dispatch job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new DispatchAdapter();
registerAdapter(adapter);
export default adapter;
