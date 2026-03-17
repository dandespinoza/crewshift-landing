/**
 * monday.com Integration Adapter
 *
 * Tier 2 adapter for monday.com.
 * Handles OAuth2, board/item (job) sync via GraphQL, and webhook verification.
 *
 * monday.com API Reference:
 * - Auth: https://developer.monday.com/apps/docs/oauth
 * - GraphQL API: https://developer.monday.com/api-reference/reference/api-reference-overview
 * - Webhooks: https://developer.monday.com/apps/docs/webhooks
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - API is GraphQL-based (POST /v2 with query body)
 * - Board items synced as jobs
 * - Webhook verification via challenge-response + token
 * - Rate limit: 5,000 complexity points per minute
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

const MONDAY_AUTH_URL = 'https://auth.monday.com/oauth2/authorize';
const MONDAY_TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const MONDAY_API_BASE = 'https://api.monday.com/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.MONDAY_CLIENT_ID ?? env.MONDAY_CLIENT_ID;
  if (!id) throw new Error('MONDAY_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.MONDAY_CLIENT_SECRET ?? env.MONDAY_CLIENT_SECRET;
  if (!secret) throw new Error('MONDAY_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Execute a GraphQL query against the monday.com API.
 */
async function mondayGraphQL(
  query: string,
  accessToken: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  const response = await fetch(MONDAY_API_BASE, {
    method: 'POST',
    headers: {
      'Authorization': accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'API-Version': '2024-10',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, errorBody }, 'monday.com GraphQL error');
    throw new Error(`monday.com API error: ${response.status} — ${errorBody}`);
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (result.errors) {
    const errors = result.errors as Array<Record<string, unknown>>;
    const errorMsg = errors.map((e) => e.message).join('; ');
    logger.error({ errors: result.errors }, 'monday.com GraphQL errors');
    throw new Error(`monday.com GraphQL errors: ${errorMsg}`);
  }

  return (result.data as Record<string, unknown>) ?? {};
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class MondayAdapter extends BaseAdapter {
  readonly provider = 'monday' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: orgId,
    });

    return `${MONDAY_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/monday/callback`;

    const response = await fetch(MONDAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'monday.com token exchange failed');
      throw new Error(`monday.com token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: undefined, // monday.com tokens don't expire
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for monday.com. monday.com tokens are long-lived.');
    }

    const response = await fetch(MONDAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: getClientId(),
        client_secret: getClientSecret(),
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'monday.com token refresh failed');
      throw new Error(`monday.com token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: monday.com → CrewShift ──────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // Query all boards and their items using GraphQL
    const boardsQuery = `
      query {
        boards (limit: 50) {
          id
          name
          state
          board_folder_id
          items_page (limit: 100) {
            cursor
            items {
              id
              name
              state
              group {
                id
                title
              }
              column_values {
                id
                text
                type
                value
              }
              created_at
              updated_at
            }
          }
        }
      }
    `;

    const data = await mondayGraphQL(boardsQuery, accessToken);
    const boards = (data.boards as Array<Record<string, unknown>>) ?? [];

    for (const board of boards) {
      const boardName = (board.name as string) ?? 'Untitled Board';
      const boardId = board.id as string;
      const itemsPage = board.items_page as Record<string, unknown> | undefined;
      const items = (itemsPage?.items as Array<Record<string, unknown>>) ?? [];

      for (const item of items) {
        try {
          records.push(this.mapMondayItem(item, boardId, boardName));
          created++;
        } catch (err) {
          errors.push({ item, error: (err as Error).message });
        }
      }

      // Handle pagination for items
      let cursor = itemsPage?.cursor as string | undefined;
      while (cursor) {
        const nextPageQuery = `
          query ($cursor: String!) {
            next_items_page (cursor: $cursor, limit: 100) {
              cursor
              items {
                id
                name
                state
                group {
                  id
                  title
                }
                column_values {
                  id
                  text
                  type
                  value
                }
                created_at
                updated_at
              }
            }
          }
        `;

        const nextData = await mondayGraphQL(nextPageQuery, accessToken, { cursor });
        const nextPage = nextData.next_items_page as Record<string, unknown> | undefined;
        const nextItems = (nextPage?.items as Array<Record<string, unknown>>) ?? [];

        for (const item of nextItems) {
          try {
            records.push(this.mapMondayItem(item, boardId, boardName));
            created++;
          } catch (err) {
            errors.push({ item, error: (err as Error).message });
          }
        }

        cursor = nextPage?.cursor as string | undefined;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'monday.com item sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Verify monday.com webhook.
   * monday.com uses challenge-response for subscription setup.
   * For ongoing events, the signing secret is used.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // monday.com webhook payload:
    // { event: { type, boardId, pulseId, columnValues, ... }, ... }
    // or challenge: { challenge }

    // Check for challenge-response handshake
    if (payload.challenge) {
      return {
        provider: this.provider,
        event_type: 'challenge',
        resource_type: 'webhook',
        resource_id: undefined,
        data: payload,
        timestamp: new Date().toISOString(),
      };
    }

    const event = (payload.event as Record<string, unknown>) ?? {};
    const eventType = (event.type as string) ?? 'unknown';
    const boardId = event.boardId as string | undefined;
    const pulseId = event.pulseId as string | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'item',
      resource_id: pulseId ?? undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapMondayItem(
    item: Record<string, unknown>,
    boardId: string,
    boardName: string,
  ): Record<string, unknown> {
    const columnValues = (item.column_values as Array<Record<string, unknown>>) ?? [];
    const group = item.group as Record<string, unknown> | undefined;

    // Build a map of column values for easy access
    const columns: Record<string, string> = {};
    for (const col of columnValues) {
      const colId = col.id as string;
      const colText = (col.text as string) ?? '';
      if (colId) columns[colId] = colText;
    }

    // Try to extract status from column values
    const status = columns['status'] ?? columns['Status'] ?? ((item.state as string) ?? 'active');

    return {
      title: (item.name as string) ?? 'Untitled Item',
      status: status.toLowerCase(),
      description: null,
      external_ids: { monday: String(item.id) },
      source: 'monday',
      metadata: {
        monday_item_id: item.id,
        monday_board_id: boardId,
        monday_board_name: boardName,
        monday_group: group?.title,
        monday_group_id: group?.id,
        monday_state: item.state,
        monday_created_at: item.created_at,
        monday_updated_at: item.updated_at,
        monday_column_values: columns,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new MondayAdapter();
registerAdapter(adapter);
export default adapter;
