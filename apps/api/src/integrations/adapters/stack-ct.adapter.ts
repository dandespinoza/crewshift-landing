/**
 * STACK Construction Technologies Integration Adapter
 *
 * Tier 2 adapter for STACK CT.
 * Handles OAuth2 and construction takeoff project (job) sync.
 *
 * STACK CT API Reference:
 * - Auth: https://developer.stackct.com/docs/authentication
 * - Projects: https://developer.stackct.com/docs/api-reference
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Projects represent construction takeoff projects
 * - No webhook support
 * - Tokens expire in approximately 8 hours
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

const STACK_AUTH_URL = 'https://auth.stackct.com/oauth/authorize';
const STACK_TOKEN_URL = 'https://auth.stackct.com/oauth/token';
const STACK_API_BASE = 'https://api.stackct.com/api/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.STACK_CLIENT_ID ?? env.STACK_CLIENT_ID;
  if (!id) throw new Error('STACK_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.STACK_CLIENT_SECRET ?? env.STACK_CLIENT_SECRET;
  if (!secret) throw new Error('STACK_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the STACK CT API.
 */
async function stackFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${STACK_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'STACK CT API error');
    throw new Error(`STACK CT API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class StackCTAdapter extends BaseAdapter {
  readonly provider = 'stack-ct' as const;
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

    return `${STACK_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/stack-ct/callback`;

    const response = await fetch(STACK_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'STACK CT token exchange failed');
      throw new Error(`STACK CT token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // STACK tokens expire in ~8 hours
    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // Default 8hr expiry
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for STACK CT. Re-authorization required.');
    }

    const response = await fetch(STACK_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'STACK CT token refresh failed');
      throw new Error(`STACK CT token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: STACK CT → CrewShift ────────────────────────────────────────────

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
        params.set('modified_since', lastSyncAt);
      }

      const response = await stackFetch(`/projects?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const projects = (data.projects as Record<string, unknown>[]) ?? (data.data as Record<string, unknown>[]) ?? [];

      for (const project of projects) {
        try {
          records.push(this.mapStackProject(project));
          created++;
        } catch (err) {
          errors.push({ item: project, error: (err as Error).message });
        }
      }

      // Check pagination metadata
      const meta = data.meta as Record<string, unknown> | undefined;
      const totalPages = (meta?.total_pages as number) ?? 1;

      if (page >= totalPages || projects.length === 0) {
        hasMore = false;
      } else {
        page++;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'STACK CT project sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────────

  // verifyWebhook and processWebhook — inherited no-ops from BaseAdapter

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapStackProject(project: Record<string, unknown>): Record<string, unknown> {
    const location = project.location as Record<string, unknown> | undefined;

    return {
      title: (project.name as string) ?? `STACK Project ${project.id}`,
      status: ((project.status as string) ?? 'active').toLowerCase(),
      description: (project.description as string) ?? null,
      location: location
        ? {
            street: (location.address as string) ?? '',
            city: (location.city as string) ?? '',
            state: (location.state as string) ?? '',
            zip: (location.zip as string) ?? '',
            country: 'US',
          }
        : null,
      external_ids: { 'stack-ct': String(project.id) },
      source: 'stack-ct',
      metadata: {
        stack_project_id: project.id,
        stack_status: project.status,
        stack_created_at: project.created_at,
        stack_updated_at: project.updated_at,
        stack_owner: project.owner,
        stack_bid_date: project.bid_date,
        stack_takeoff_count: project.takeoff_count,
        stack_plan_count: project.plan_count,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new StackCTAdapter();
registerAdapter(adapter);
export default adapter;
