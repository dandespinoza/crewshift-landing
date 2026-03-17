/**
 * CompanyCam Integration Adapter
 *
 * Tier 2 adapter for CompanyCam.
 * Handles OAuth2, project (job) sync, and webhook verification.
 *
 * CompanyCam API Reference:
 * - Auth: https://docs.companycam.com/#section/Authentication
 * - Projects: https://docs.companycam.com/#tag/Projects
 * - Webhooks: https://docs.companycam.com/#section/Webhooks
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Projects use page-based pagination
 * - Webhook verification via HMAC
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

const CC_AUTH_URL = 'https://app.companycam.com/oauth/authorize';
const CC_TOKEN_URL = 'https://app.companycam.com/oauth/token';
const CC_API_BASE = 'https://api.companycam.com/v2';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.COMPANYCAM_CLIENT_ID ?? env.COMPANYCAM_CLIENT_ID;
  if (!id) throw new Error('COMPANYCAM_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.COMPANYCAM_CLIENT_SECRET ?? env.COMPANYCAM_CLIENT_SECRET;
  if (!secret) throw new Error('COMPANYCAM_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the CompanyCam API.
 */
async function companycamFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${CC_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'CompanyCam API error');
    throw new Error(`CompanyCam API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class CompanyCamAdapter extends BaseAdapter {
  readonly provider = 'companycam' as const;
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

    return `${CC_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/companycam/callback`;

    const response = await fetch(CC_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'CompanyCam token exchange failed');
      throw new Error(`CompanyCam token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for CompanyCam');
    }

    const response = await fetch(CC_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'CompanyCam token refresh failed');
      throw new Error(`CompanyCam token refresh failed: ${response.status}`);
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

  // ── Sync: CompanyCam → CrewShift ──────────────────────────────────────────

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
        // Filter by updated_at timestamp (Unix epoch seconds)
        const since = Math.floor(new Date(lastSyncAt).getTime() / 1000);
        params.set('updated_after', String(since));
      }

      const response = await companycamFetch(`/projects?${params.toString()}`, accessToken);
      const projects = (await response.json()) as Record<string, unknown>[];

      // CompanyCam returns an array of projects directly
      const projectList = Array.isArray(projects) ? projects : [];

      for (const project of projectList) {
        try {
          records.push(this.mapCompanyCamProject(project));
          created++;
        } catch (err) {
          errors.push({ item: project, error: (err as Error).message });
        }
      }

      if (projectList.length < DEFAULT_PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'CompanyCam project sync complete',
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
    // CompanyCam webhook: { type, data: { id, name, ... }, timestamp }
    const eventType = (payload.type as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? {};

    // Extract resource type from event type (e.g., "project.created" -> "project")
    const resourceType = eventType.split('.')[0] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType.toLowerCase(),
      resource_id: (data.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapCompanyCamProject(project: Record<string, unknown>): Record<string, unknown> {
    const address = project.address as Record<string, unknown> | undefined;
    const coordinates = project.coordinates as Record<string, unknown> | undefined;

    return {
      title: (project.name as string) ?? 'Untitled Project',
      status: ((project.status as string) ?? 'active').toLowerCase(),
      description: null,
      location: address
        ? {
            street: (address.street_address_1 as string) ?? '',
            city: (address.city as string) ?? '',
            state: (address.state as string) ?? '',
            zip: (address.postal_code as string) ?? '',
            country: (address.country as string) ?? '',
            latitude: coordinates?.lat as number | undefined,
            longitude: coordinates?.lon as number | undefined,
          }
        : null,
      external_ids: { companycam: String(project.id) },
      source: 'companycam',
      metadata: {
        cc_project_url: project.project_url,
        cc_created_at: project.created_at,
        cc_updated_at: project.updated_at,
        cc_photo_count: project.photo_count,
        cc_integrations: project.integrations,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new CompanyCamAdapter();
registerAdapter(adapter);
export default adapter;
