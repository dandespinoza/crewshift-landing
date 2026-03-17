/**
 * Bluebeam Integration Adapter
 *
 * Tier 3 (native) adapter for Bluebeam Studio — construction document management.
 * Handles OAuth 2.0 auth, session/project sync, and HMAC webhook verification.
 *
 * Bluebeam API Reference:
 * - Auth: https://authserver.bluebeam.com/auth/oauth/authorize
 * - Studio API: https://studioapi.bluebeam.com/publicapi/v1
 *
 * Key details:
 * - Developer application approval required — email integrations@bluebeam.com for access
 * - OAuth 2.0 with standard authorization code flow
 * - syncJobs pulls /sessions for studio sessions and /projects for projects
 * - Webhook verification via HMAC
 * - Env: BLUEBEAM_CLIENT_ID, BLUEBEAM_CLIENT_SECRET
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

const AUTH_URL = 'https://authserver.bluebeam.com/auth/oauth/authorize';
const TOKEN_URL = 'https://authserver.bluebeam.com/auth/oauth/token';
const API_BASE = 'https://studioapi.bluebeam.com/publicapi/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.BLUEBEAM_CLIENT_ID ?? (env as Record<string, unknown>).BLUEBEAM_CLIENT_ID as string | undefined;
  if (!id) throw new Error('BLUEBEAM_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.BLUEBEAM_CLIENT_SECRET ?? (env as Record<string, unknown>).BLUEBEAM_CLIENT_SECRET as string | undefined;
  if (!secret) throw new Error('BLUEBEAM_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Bluebeam Studio API.
 */
async function bluebeamFetch(
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
      'Bluebeam API error',
    );
    throw new Error(`Bluebeam API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Bluebeam list endpoints using offset-based pagination.
 */
async function bluebeamPaginateAll(
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

    const response = await bluebeamFetch(
      `${path}?${searchParams.toString()}`,
      accessToken,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[])
      ?? (data.Sessions as Record<string, unknown>[])
      ?? (data.Projects as Record<string, unknown>[])
      ?? [];

    results.push(...items);

    const totalCount = data.totalCount as number | undefined;
    hasMore = totalCount ? results.length < totalCount : items.length === DEFAULT_PAGE_SIZE;
    offset += DEFAULT_PAGE_SIZE;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class BluebeamAdapter extends BaseAdapter {
  readonly provider = 'bluebeam' as const;
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
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${env.API_URL}/api/integrations/bluebeam/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Bluebeam token exchange failed');
      throw new Error(`Bluebeam token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Bluebeam');
    }

    const response = await fetch(TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Bluebeam token refresh failed');
      throw new Error(`Bluebeam token refresh failed: ${response.status}`);
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

  // ── Sync: Bluebeam → CrewShift ─────────────────────────────────────────

  /**
   * Sync studio sessions and projects from Bluebeam.
   * Pulls both /sessions and /projects and merges into job records.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const sessions = await bluebeamPaginateAll('/sessions', accessToken);
    const projects = await bluebeamPaginateAll('/projects', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    // Map sessions
    for (const session of sessions) {
      try {
        const mapped = this.mapSession(session);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: session, error: (err as Error).message });
      }
    }

    // Map projects
    for (const project of projects) {
      try {
        const mapped = this.mapProject(project);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: project, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, sessions: sessions.length, projects: projects.length, created, errors: errors.length },
      'Bluebeam session/project sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  /**
   * Verify webhook via HMAC-SHA256 using the client secret.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = process.env.BLUEBEAM_CLIENT_SECRET ?? (env as Record<string, unknown>).BLUEBEAM_CLIENT_SECRET as string | undefined;
    if (!secret) {
      logger.warn('No Bluebeam client secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    // Derive resource type from event type (e.g., "session.created" -> "session")
    const resourceType = eventType.includes('.')
      ? eventType.split('.')[0]
      : (payload.resource_type as string) ?? 'session';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (data?.id as string) ?? (payload.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Bluebeam Studio Session to CrewShift's unified job format.
   */
  private mapSession(session: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (session.Name as string) ?? (session.name as string) ?? null,
      description: (session.Description as string) ?? (session.description as string) ?? null,
      status: (session.Status as string) ?? (session.status as string) ?? 'active',
      type: 'session',
      scheduled_start: (session.StartDate as string) ?? (session.created as string) ?? null,
      scheduled_end: (session.EndDate as string) ?? (session.expiration as string) ?? null,
      external_ids: { bluebeam: String(session.Id ?? session.id ?? session.SessionId) },
      source: 'bluebeam',
      metadata: {
        bluebeam_type: 'session',
        bluebeam_owner: session.Owner ?? session.owner,
        bluebeam_invited_count: session.InvitedCount ?? session.invitedCount,
        bluebeam_document_count: session.DocumentCount ?? session.documentCount,
        bluebeam_restricted: session.Restricted ?? session.restricted,
        bluebeam_notification: session.Notification ?? session.notification,
        bluebeam_created: session.Created ?? session.created,
      },
    };
  }

  /**
   * Map a Bluebeam Project to CrewShift's unified job format.
   */
  private mapProject(project: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (project.Name as string) ?? (project.name as string) ?? null,
      description: (project.Description as string) ?? (project.description as string) ?? null,
      status: (project.Status as string) ?? (project.status as string) ?? 'active',
      type: 'project',
      external_ids: { bluebeam: String(project.Id ?? project.id ?? project.ProjectId) },
      source: 'bluebeam',
      metadata: {
        bluebeam_type: 'project',
        bluebeam_owner: project.Owner ?? project.owner,
        bluebeam_folder_count: project.FolderCount ?? project.folderCount,
        bluebeam_file_count: project.FileCount ?? project.fileCount,
        bluebeam_created: project.Created ?? project.created,
        bluebeam_modified: project.Modified ?? project.modified,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new BluebeamAdapter();
registerAdapter(adapter);
export default adapter;
