/**
 * RSMeans (Gordian) Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for RSMeans Data by Gordian.
 * Handles API Key auth and construction cost data sync.
 *
 * RSMeans API Reference:
 * - API Base: https://dataapi.gordian.com/v2
 * - Auth: x-api-key header
 * - Swagger docs available upon subscription
 *
 * Key details:
 * - API Key authentication via x-api-key header
 * - Cost data sync via GET /costdata
 * - No webhooks
 * - NOTE: Annual subscription required
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

const RSMEANS_API_BASE = 'https://dataapi.gordian.com/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.RSMEANS_API_KEY;
  if (!key) throw new Error('RSMEANS_API_KEY is not configured — annual RSMeans/Gordian subscription required');
  return key;
}

/**
 * Make an authenticated request to the RSMeans (Gordian) API.
 */
async function rsmeansFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${RSMEANS_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'RSMeans API error',
    );
    throw new Error(`RSMeans API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class RSMeansAdapter extends BaseAdapter {
  readonly provider = 'rsmeans' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('RSMeans uses API Key authentication (x-api-key header), not OAuth. Configure RSMEANS_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('RSMeans uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('RSMeans uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: RSMeans → CrewShift ──────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await rsmeansFetch('/costdata', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const costItems = (data.items as Record<string, unknown>[]) ??
      (data.costdata as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const item of costItems) {
      try {
        records.push({
          title: `Cost Data — ${item.description ?? item.lineNumber ?? 'N/A'}`,
          status: 'reference',
          external_ids: { rsmeans: String(item.id ?? item.lineNumber) },
          source: 'rsmeans',
          metadata: {
            rsmeans_line_number: item.lineNumber,
            rsmeans_description: item.description,
            rsmeans_unit: item.unit,
            rsmeans_material_cost: item.materialCost,
            rsmeans_labor_cost: item.laborCost,
            rsmeans_equipment_cost: item.equipmentCost,
            rsmeans_total_cost: item.totalCost,
            rsmeans_city_cost_index: item.cityCostIndex,
            rsmeans_division: item.division,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: costItems.length, created, errors: errors.length },
      'RSMeans cost data sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new RSMeansAdapter();
registerAdapter(adapter);
export default adapter;
