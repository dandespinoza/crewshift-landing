/**
 * inFlow Inventory Integration Adapter
 *
 * Native (Tier 1) adapter for inFlow Inventory (cloud-based inventory management).
 * Handles API key auth and product/inventory sync.
 *
 * inFlow Cloud API Reference:
 * - API: https://cloudapi.inflowinventory.com/api
 *
 * Key details:
 * - Auth via API key in header
 * - Inventory-only integration (products/stock levels)
 * - No customer or invoice sync (inventory-focused)
 * - No webhook support
 * - Rate limit: 60 requests per minute
 * - API is a paid add-on to the inFlow subscription
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

const API_BASE = 'https://cloudapi.inflowinventory.com/api';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.INFLOW_API_KEY ?? env.INFLOW_API_KEY;
  if (!key) throw new Error('INFLOW_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the inFlow API.
 */
async function inflowFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'inFlow API error',
    );
    throw new Error(`inFlow API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through an inFlow list endpoint.
 */
async function inflowFetchAllPages(
  path: string,
  apiKey: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`;

    const response = await inflowFetch(pagedPath, apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    const totalPages = data.totalPages as number | undefined;
    if (totalPages && page < totalPages) {
      page++;
    } else if (!totalPages && items.length === DEFAULT_PAGE_SIZE) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class InflowAdapter extends BaseAdapter {
  readonly provider = 'inflow' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API key auth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('inFlow uses API key authentication, not OAuth. Configure INFLOW_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('inFlow uses API key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('inFlow uses API key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: inFlow → CrewShift ──────────────────────────────────────────

  // Note: inFlow is inventory-only. syncCustomers and syncInvoices use base class defaults (no-op).

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    // inFlow uses "products" as its main entity — we map these to inventory items
    const products = await inflowFetchAllPages('/products', apiKey, 'products');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const product of products) {
      try {
        const locations = (product.locations as Array<Record<string, unknown>>) ?? [];
        const totalQuantity = locations.reduce((sum, loc) => {
          return sum + ((loc.quantityOnHand as number) ?? (loc.quantity as number) ?? 0);
        }, 0);

        records.push({
          title: (product.name as string) ?? `Product ${product.id}`,
          status: totalQuantity > 0 ? 'in_stock' : 'out_of_stock',
          type: 'inventory_item',
          external_ids: { inflow: String(product.id ?? product.productId) },
          source: 'inflow',
          metadata: {
            inflow_sku: product.sku,
            inflow_barcode: product.barcode,
            inflow_category: product.category,
            inflow_description: product.description,
            inflow_cost: product.cost,
            inflow_price: product.price,
            inflow_quantity_on_hand: totalQuantity,
            inflow_reorder_point: product.reorderPoint,
            inflow_locations: locations.map((loc) => ({
              name: loc.name ?? loc.locationName,
              quantity: loc.quantityOnHand ?? loc.quantity ?? 0,
            })),
            inflow_updated_at: product.lastModified ?? product.updatedAt,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: product, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: products.length, created, errors: errors.length },
      'inFlow product/inventory sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ─────────────────────────────────────────────

  // inFlow does not support webhooks. The base class defaults apply:
  // verifyWebhook returns false, processWebhook throws.
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new InflowAdapter();
registerAdapter(adapter);
export default adapter;
