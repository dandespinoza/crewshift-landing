/**
 * Ferguson Integration Adapter
 *
 * Tier 3 (native) adapter for Ferguson — plumbing/HVAC supply distributor.
 * Handles API Key auth (Apigee gateway), product catalog search.
 *
 * Ferguson API Reference:
 * - API Base: https://api.ferguson.com/v1
 * - Auth: API Key via x-api-key header (Apigee gateway)
 *
 * Key details:
 * - Case-by-case developer application approval required
 * - No OAuth flow — API Key via x-api-key header (Apigee gateway)
 * - syncJobs pulls /products/search for product catalog data
 * - No webhook support
 * - Env: FERGUSON_API_KEY
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

const API_BASE = 'https://api.ferguson.com/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.FERGUSON_API_KEY ?? (env as Record<string, unknown>).FERGUSON_API_KEY as string | undefined;
  if (!key) throw new Error('FERGUSON_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the Ferguson API.
 * Auth is via x-api-key header (Apigee gateway pattern).
 */
async function fergusonFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Ferguson API error',
    );
    throw new Error(`Ferguson API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Ferguson list endpoints using offset-based pagination.
 */
async function fergusonPaginateAll(
  path: string,
  apiKey: string,
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

    const response = await fergusonFetch(
      `${path}?${searchParams.toString()}`,
      apiKey,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[])
      ?? (data.products as Record<string, unknown>[])
      ?? (data.results as Record<string, unknown>[])
      ?? [];

    results.push(...items);

    const total = data.total as number | undefined;
    hasMore = total ? results.length < total : items.length === DEFAULT_PAGE_SIZE;
    offset += DEFAULT_PAGE_SIZE;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class FergusonAdapter extends BaseAdapter {
  readonly provider = 'ferguson' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API Key auth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Ferguson uses API Key authentication via Apigee, not OAuth. Configure FERGUSON_API_KEY instead. Access requires case-by-case approval.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Ferguson uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Ferguson uses API Key authentication. API keys do not expire through OAuth refresh.');
  }

  // ── Sync: Ferguson → CrewShift ─────────────────────────────────────────

  /**
   * Sync product catalog data from Ferguson.
   * Ferguson is a supply distributor, so "jobs" maps to product catalog items.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const products = await fergusonPaginateAll('/products/search', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const product of products) {
      try {
        const mapped = this.mapProduct(product);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: product, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: products.length, created, errors: errors.length },
      'Ferguson product catalog sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class no-op implementations are sufficient — Ferguson does not support webhooks.

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Ferguson Product to CrewShift's unified job format.
   * Products are mapped as job/item records for supply tracking.
   */
  private mapProduct(product: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (product.name as string) ?? (product.title as string) ?? (product.description as string) ?? null,
      description: (product.description as string) ?? (product.longDescription as string) ?? null,
      status: (product.availability as string) ?? (product.status as string) ?? 'available',
      type: 'product',
      external_ids: { ferguson: String(product.id ?? product.sku ?? product.productId) },
      source: 'ferguson',
      metadata: {
        ferguson_sku: product.sku,
        ferguson_upc: product.upc,
        ferguson_brand: product.brand ?? product.manufacturer,
        ferguson_category: product.category,
        ferguson_subcategory: product.subcategory,
        ferguson_price: product.price ?? product.listPrice,
        ferguson_unit_of_measure: product.unitOfMeasure,
        ferguson_availability: product.availability,
        ferguson_image_url: product.imageUrl ?? product.image,
        ferguson_product_url: product.productUrl ?? product.url,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new FergusonAdapter();
registerAdapter(adapter);
export default adapter;
