/**
 * Sortly Integration Adapter
 *
 * Native (Tier 1) adapter for Sortly inventory management.
 * Handles OAuth2 and inventory item sync.
 *
 * Sortly API Reference:
 * - Auth: https://app.sortly.com/oauth/authorize
 * - API: https://api.sortly.com/api/v1
 *
 * Key details:
 * - OAuth 2.0 authorization code flow
 * - Inventory-only integration (items/folders)
 * - No webhook support
 * - Rate limit: 1,000 requests per 15 minutes
 * - Ultra or Enterprise plan required
 */

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

const AUTH_URL = 'https://app.sortly.com/oauth/authorize';
const TOKEN_URL = 'https://app.sortly.com/oauth/token';
const API_BASE = 'https://api.sortly.com/api/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.SORTLY_CLIENT_ID ?? env.SORTLY_CLIENT_ID;
  if (!id) throw new Error('SORTLY_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.SORTLY_CLIENT_SECRET ?? env.SORTLY_CLIENT_SECRET;
  if (!secret) throw new Error('SORTLY_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Sortly API.
 */
async function sortlyFetch(
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
      'Sortly API error',
    );
    throw new Error(`Sortly API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Sortly list endpoint.
 */
async function sortlyFetchAllPages(
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&per_page=${DEFAULT_PAGE_SIZE}`;

    const response = await sortlyFetch(pagedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    const meta = data.meta as Record<string, unknown> | undefined;
    const lastPage = meta?.last_page as number | undefined;
    const totalPages = meta?.total_pages as number | undefined;
    const maxPage = lastPage ?? totalPages;

    if (maxPage && page < maxPage) {
      page++;
    } else if (!maxPage && items.length === DEFAULT_PAGE_SIZE) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SortlyAdapter extends BaseAdapter {
  readonly provider = 'sortly' as const;
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
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = `${env.API_URL}/api/integrations/sortly/callback`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Sortly token exchange failed');
      throw new Error(`Sortly token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Sortly');
    }

    const clientId = getClientId();
    const clientSecret = getClientSecret();

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Sortly token refresh failed');
      throw new Error(`Sortly token refresh failed: ${response.status}`);
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

  // ── Sync: Sortly → CrewShift ──────────────────────────────────────────

  // Note: Sortly is inventory-only. syncCustomers and syncInvoices use base class defaults (no-op).

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const items = await sortlyFetchAllPages('/items', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const item of items) {
      try {
        const customFields = (item.custom_field_values as Array<Record<string, unknown>>) ?? [];
        const quantityField = customFields.find((cf) =>
          ((cf.name as string) ?? '').toLowerCase().includes('quantity'),
        );
        const quantity = (quantityField?.value as number) ?? (item.quantity as number) ?? 0;

        records.push({
          title: (item.name as string) ?? `Item ${item.id}`,
          status: quantity > 0 ? 'in_stock' : 'out_of_stock',
          type: 'inventory_item',
          external_ids: { sortly: String(item.id) },
          source: 'sortly',
          metadata: {
            sortly_sid: item.sid,
            sortly_parent_id: item.parent_id,
            sortly_type: item.type,
            sortly_quantity: quantity,
            sortly_min_quantity: item.min_quantity,
            sortly_price: item.price,
            sortly_tags: item.tags,
            sortly_notes: item.notes,
            sortly_custom_fields: customFields.map((cf) => ({
              name: cf.name,
              value: cf.value,
            })),
            sortly_photos: item.photos,
            sortly_updated_at: item.updated_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: items.length, created, errors: errors.length },
      'Sortly inventory item sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ─────────────────────────────────────────────

  // Sortly does not support webhooks. The base class defaults apply:
  // verifyWebhook returns false, processWebhook throws.
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SortlyAdapter();
registerAdapter(adapter);
export default adapter;
