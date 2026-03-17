/**
 * Notion Integration Adapter
 *
 * Tier 2 adapter for Notion.
 * Handles OAuth2, database/page search (job sync), and webhook verification.
 *
 * Notion API Reference:
 * - Auth: https://developers.notion.com/docs/authorization
 * - Search: https://developers.notion.com/reference/post-search
 * - Databases: https://developers.notion.com/reference/retrieve-a-database
 *
 * Key details:
 * - OAuth2 with Basic auth (base64 client_id:client_secret) for token exchange
 * - Requires Notion-Version header (2022-06-28)
 * - Search via POST /search with filter for databases/pages
 * - Webhook verification via HMAC-SHA256 (X-Notion-Signature, not yet GA)
 * - Rate limit: 3 requests per second
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

const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.NOTION_CLIENT_ID ?? env.NOTION_CLIENT_ID;
  if (!id) throw new Error('NOTION_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.NOTION_CLIENT_SECRET ?? env.NOTION_CLIENT_SECRET;
  if (!secret) throw new Error('NOTION_CLIENT_SECRET is not configured');
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Notion API.
 */
async function notionFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${NOTION_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Notion-Version': NOTION_VERSION,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, path, errorBody }, 'Notion API error');
    throw new Error(`Notion API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class NotionAdapter extends BaseAdapter {
  readonly provider = 'notion' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
      state: orgId,
    });

    return `${NOTION_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/notion/callback`;

    // Notion requires Basic auth (base64 client_id:client_secret) for token exchange
    const response = await fetch(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Notion token exchange failed');
      throw new Error(`Notion token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Notion access tokens don't expire (they're tied to the integration)
    return {
      access_token: tokens.access_token as string,
      refresh_token: undefined, // Notion tokens don't have refresh tokens
      expires_at: undefined, // Tokens don't expire
      scope: undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // Notion access tokens are long-lived and don't need refresh
    throw new Error('Notion access tokens do not expire. Re-authorize if access is revoked.');
  }

  // ── Sync: Notion → CrewShift ──────────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let startCursor: string | undefined;
    let hasMore = true;

    // Search for databases and pages
    while (hasMore) {
      const searchBody: Record<string, unknown> = {
        page_size: DEFAULT_PAGE_SIZE,
        filter: {
          value: 'database',
          property: 'object',
        },
      };
      if (startCursor) {
        searchBody.start_cursor = startCursor;
      }

      const response = await notionFetch('/search', accessToken, {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });

      const data = (await response.json()) as Record<string, unknown>;
      const results = (data.results as Record<string, unknown>[]) ?? [];

      for (const item of results) {
        try {
          records.push(this.mapNotionItem(item));
          created++;
        } catch (err) {
          errors.push({ item, error: (err as Error).message });
        }
      }

      hasMore = (data.has_more as boolean) ?? false;
      startCursor = data.next_cursor as string | undefined;
    }

    // Also search for pages
    startCursor = undefined;
    hasMore = true;

    while (hasMore) {
      const searchBody: Record<string, unknown> = {
        page_size: DEFAULT_PAGE_SIZE,
        filter: {
          value: 'page',
          property: 'object',
        },
      };
      if (startCursor) {
        searchBody.start_cursor = startCursor;
      }

      const response = await notionFetch('/search', accessToken, {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });

      const data = (await response.json()) as Record<string, unknown>;
      const results = (data.results as Record<string, unknown>[]) ?? [];

      for (const item of results) {
        try {
          records.push(this.mapNotionItem(item));
          created++;
        } catch (err) {
          errors.push({ item, error: (err as Error).message });
        }
      }

      hasMore = (data.has_more as boolean) ?? false;
      startCursor = data.next_cursor as string | undefined;
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Notion search sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Verify Notion webhook (not yet GA).
   * Uses HMAC-SHA256 via X-Notion-Signature header when available.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Notion webhook structure (anticipated, not yet GA):
    // { type, data: { id, object, ... }, timestamp }
    const eventType = (payload.type as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? {};

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: (data.object as string) ?? 'unknown',
      resource_id: (data.id as string) ?? undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Extract the title from a Notion item (database or page).
   */
  private extractTitle(item: Record<string, unknown>): string {
    const objectType = item.object as string;

    if (objectType === 'database') {
      // Database title is in title array
      const titleArray = item.title as Array<Record<string, unknown>> | undefined;
      if (titleArray && titleArray.length > 0) {
        return (titleArray[0].plain_text as string) ?? 'Untitled Database';
      }
      return 'Untitled Database';
    }

    // Page title is in properties.title or properties.Name
    const properties = item.properties as Record<string, unknown> | undefined;
    if (properties) {
      // Find the title property
      for (const prop of Object.values(properties)) {
        const propObj = prop as Record<string, unknown>;
        if (propObj.type === 'title') {
          const titleArr = propObj.title as Array<Record<string, unknown>> | undefined;
          if (titleArr && titleArr.length > 0) {
            return (titleArr[0].plain_text as string) ?? 'Untitled Page';
          }
        }
      }
    }

    return 'Untitled Page';
  }

  private mapNotionItem(item: Record<string, unknown>): Record<string, unknown> {
    const objectType = item.object as string;
    const title = this.extractTitle(item);

    return {
      title,
      status: 'active',
      description: null,
      external_ids: { notion: String(item.id) },
      source: 'notion',
      metadata: {
        notion_id: item.id,
        notion_object_type: objectType,
        notion_url: item.url,
        notion_created_time: item.created_time,
        notion_last_edited_time: item.last_edited_time,
        notion_archived: item.archived,
        notion_parent: item.parent,
        notion_created_by: item.created_by,
        notion_last_edited_by: item.last_edited_by,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new NotionAdapter();
registerAdapter(adapter);
export default adapter;
