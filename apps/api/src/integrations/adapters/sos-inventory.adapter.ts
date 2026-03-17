/**
 * SOS Inventory Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for SOS Inventory.
 * Handles API Key auth and inventory item sync (pull-only).
 *
 * SOS Inventory API Reference:
 * - API Base: https://api.sosinventory.com/api/v2
 *
 * Key details:
 * - API Key authentication in header
 * - Inventory item sync via GET /items (pull-only)
 * - No webhooks
 * - NOTE: Pull-only — no write-back support
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

const SOS_API_BASE = 'https://api.sosinventory.com/api/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.SOS_INVENTORY_API_KEY;
  if (!key) throw new Error('SOS_INVENTORY_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the SOS Inventory API.
 */
async function sosFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SOS_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'SOS Inventory API error',
    );
    throw new Error(`SOS Inventory API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SosInventoryAdapter extends BaseAdapter {
  readonly provider = 'sos-inventory' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('SOS Inventory uses API Key authentication, not OAuth. Configure SOS_INVENTORY_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('SOS Inventory uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('SOS Inventory uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: SOS Inventory → CrewShift (pull-only) ────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await sosFetch('/items', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.items as Record<string, unknown>[]) ??
      (data.data as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const item of items) {
      try {
        records.push({
          title: `Inventory — ${item.name ?? item.sku ?? 'N/A'}`,
          status: item.active === false ? 'inactive' : 'active',
          external_ids: { 'sos-inventory': String(item.id) },
          source: 'sos-inventory',
          metadata: {
            sos_name: item.name,
            sos_sku: item.sku,
            sos_description: item.description,
            sos_quantity_on_hand: item.quantityOnHand,
            sos_unit_cost: item.unitCost,
            sos_sale_price: item.salePrice,
            sos_category: item.category,
            sos_vendor: item.vendor,
            sos_reorder_point: item.reorderPoint,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: items.length, created, errors: errors.length },
      'SOS Inventory item sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Write-back (not supported — pull-only) ──────────────────────────────

  async createInvoice(_accessToken: string, _invoiceData: Record<string, unknown>): Promise<ExternalId> {
    throw new Error('SOS Inventory is pull-only — write-back is not supported');
  }

  async updateJobStatus(_accessToken: string, _externalId: string, _status: string): Promise<void> {
    throw new Error('SOS Inventory is pull-only — write-back is not supported');
  }

  async createPayment(_accessToken: string, _paymentData: Record<string, unknown>): Promise<ExternalId> {
    throw new Error('SOS Inventory is pull-only — write-back is not supported');
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SosInventoryAdapter();
registerAdapter(adapter);
export default adapter;
