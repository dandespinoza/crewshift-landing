/**
 * Asana Integration Adapter
 *
 * Tier 2 adapter for Asana.
 * Handles OAuth2, project/task (job) sync, and webhook verification.
 *
 * Asana API Reference:
 * - Auth: https://developers.asana.com/docs/oauth
 * - Projects: https://developers.asana.com/reference/getprojects
 * - Tasks: https://developers.asana.com/reference/gettasks
 * - Webhooks: https://developers.asana.com/docs/webhooks-guide
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Tasks retrieved per project, paginated with offset
 * - Webhook handshake via X-Hook-Secret; ongoing events verified with HMAC-SHA256
 * - Rate limit: 1,500 requests per minute
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

const ASANA_AUTH_URL = 'https://app.asana.com/-/oauth_authorize';
const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token';
const ASANA_API_BASE = 'https://app.asana.com/api/1.0';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.ASANA_CLIENT_ID ?? env.ASANA_CLIENT_ID;
  if (!id) throw new Error('ASANA_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.ASANA_CLIENT_SECRET ?? env.ASANA_CLIENT_SECRET;
  if (!secret) throw new Error('ASANA_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Asana API.
 */
async function asanaFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${ASANA_API_BASE}${path}`;

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
    logger.error({ status: response.status, path, errorBody }, 'Asana API error');
    throw new Error(`Asana API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class AsanaAdapter extends BaseAdapter {
  readonly provider = 'asana' as const;
  readonly tier = 'native' as const;

  // Store webhook secret per-connection for handshake
  private webhookSecrets = new Map<string, string>();

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${ASANA_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/asana/callback`;

    const response = await fetch(ASANA_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Asana token exchange failed');
      throw new Error(`Asana token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Asana');
    }

    const response = await fetch(ASANA_TOKEN_URL, {
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
      logger.error({ status: response.status, errorBody }, 'Asana token refresh failed');
      throw new Error(`Asana token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: undefined,
    };
  }

  // ── Sync: Asana → CrewShift ───────────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // Step 1: Get all projects
    const projects = await this.fetchAllProjects(accessToken);

    // Step 2: For each project, get tasks
    for (const project of projects) {
      const projectId = project.gid as string;
      const projectName = (project.name as string) ?? 'Untitled Project';

      try {
        const tasks = await this.fetchTasksForProject(accessToken, projectId, lastSyncAt);

        for (const task of tasks) {
          try {
            records.push(this.mapAsanaTask(task, projectId, projectName));
            created++;
          } catch (err) {
            errors.push({ item: task, error: (err as Error).message });
          }
        }
      } catch (err) {
        errors.push({
          item: { projectId, projectName },
          error: `Failed to fetch tasks: ${(err as Error).message}`,
        });
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Asana task sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Verify Asana webhook.
   * - For handshake: X-Hook-Secret is sent; must be stored and echoed back
   * - For events: HMAC-SHA256 of payload using X-Hook-Secret as key
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    // If this is a handshake request (X-Hook-Secret), signature IS the secret
    // Store it and return true
    if (signature.startsWith('hook-secret:')) {
      const secret = signature.slice('hook-secret:'.length);
      this.webhookSecrets.set('default', secret);
      return true;
    }

    // For regular events, verify HMAC-SHA256
    const secret = this.webhookSecrets.get('default') ?? getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Asana webhook: { events: [{ action, resource: { gid, resource_type }, parent: { gid }, ... }] }
    const events = (payload.events as Array<Record<string, unknown>>) ?? [];
    const firstEvent = events[0] ?? {};

    const action = (firstEvent.action as string) ?? 'unknown';
    const resource = (firstEvent.resource as Record<string, unknown>) ?? {};
    const parent = firstEvent.parent as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: action,
      resource_type: ((resource.resource_type as string) ?? 'unknown').toLowerCase(),
      resource_id: (resource.gid as string) ?? undefined,
      data: {
        events,
        parent_gid: parent?.gid,
        ...payload,
      },
      timestamp: (firstEvent.created_at as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Fetch all projects with pagination.
   */
  private async fetchAllProjects(accessToken: string): Promise<Record<string, unknown>[]> {
    const projects: Record<string, unknown>[] = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        limit: String(DEFAULT_PAGE_SIZE),
        opt_fields: 'gid,name,archived,created_at,modified_at,current_status',
      });
      if (offset) params.set('offset', offset);

      const response = await asanaFetch(`/projects?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const results = (data.data as Record<string, unknown>[]) ?? [];

      projects.push(...results);

      const nextPage = data.next_page as Record<string, unknown> | undefined;
      offset = nextPage?.offset as string | undefined;
    } while (offset);

    return projects;
  }

  /**
   * Fetch tasks for a specific project with pagination.
   */
  private async fetchTasksForProject(
    accessToken: string,
    projectId: string,
    lastSyncAt?: string,
  ): Promise<Record<string, unknown>[]> {
    const tasks: Record<string, unknown>[] = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        project: projectId,
        limit: String(DEFAULT_PAGE_SIZE),
        opt_fields: 'gid,name,notes,completed,completed_at,due_on,due_at,start_on,start_at,assignee,created_at,modified_at,tags,custom_fields',
      });
      if (offset) params.set('offset', offset);
      if (lastSyncAt) {
        params.set('modified_since', lastSyncAt);
      }

      const response = await asanaFetch(`/tasks?${params.toString()}`, accessToken);
      const data = (await response.json()) as Record<string, unknown>;
      const results = (data.data as Record<string, unknown>[]) ?? [];

      tasks.push(...results);

      const nextPage = data.next_page as Record<string, unknown> | undefined;
      offset = nextPage?.offset as string | undefined;
    } while (offset);

    return tasks;
  }

  private mapAsanaTask(
    task: Record<string, unknown>,
    projectId: string,
    projectName: string,
  ): Record<string, unknown> {
    const assignee = task.assignee as Record<string, unknown> | undefined;
    const completed = task.completed as boolean;

    return {
      title: (task.name as string) ?? 'Untitled Task',
      status: completed ? 'completed' : 'active',
      description: (task.notes as string) ?? null,
      start: (task.start_at as string) ?? (task.start_on as string) ?? null,
      end: (task.due_at as string) ?? (task.due_on as string) ?? null,
      external_ids: { asana: String(task.gid) },
      source: 'asana',
      metadata: {
        asana_gid: task.gid,
        asana_project_id: projectId,
        asana_project_name: projectName,
        asana_completed: completed,
        asana_completed_at: task.completed_at,
        asana_assignee_gid: assignee?.gid,
        asana_assignee_name: assignee?.name,
        asana_created_at: task.created_at,
        asana_modified_at: task.modified_at,
        asana_due_on: task.due_on,
        asana_due_at: task.due_at,
        asana_start_on: task.start_on,
        asana_tags: task.tags,
        asana_custom_fields: task.custom_fields,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new AsanaAdapter();
registerAdapter(adapter);
export default adapter;
