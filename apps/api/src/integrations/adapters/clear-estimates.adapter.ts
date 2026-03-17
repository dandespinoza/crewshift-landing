/**
 * Clear Estimates Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for Clear Estimates.
 * Handles API Key auth and estimate data sync.
 *
 * Clear Estimates API Reference:
 * - API Base: https://estimates.clearestimates.com/api/v1
 *
 * Key details:
 * - API Key authentication
 * - Estimate sync via GET /estimates
 * - No webhooks
 * - NOTE: Enterprise pricing required
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

const CLEAR_ESTIMATES_API_BASE = 'https://estimates.clearestimates.com/api/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.CLEAR_ESTIMATES_API_KEY;
  if (!key) throw new Error('CLEAR_ESTIMATES_API_KEY is not configured — enterprise pricing required');
  return key;
}

/**
 * Make an authenticated request to the Clear Estimates API.
 */
async function clearEstimatesFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${CLEAR_ESTIMATES_API_BASE}${path}`;

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
      'Clear Estimates API error',
    );
    throw new Error(`Clear Estimates API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ClearEstimatesAdapter extends BaseAdapter {
  readonly provider = 'clear-estimates' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Clear Estimates uses API Key authentication, not OAuth. Configure CLEAR_ESTIMATES_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Clear Estimates uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Clear Estimates uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Clear Estimates → CrewShift ──────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await clearEstimatesFetch('/estimates', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const estimates = (data.estimates as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const est of estimates) {
      try {
        records.push({
          title: `Estimate — ${est.name ?? est.number ?? 'N/A'}`,
          status: est.status ?? null,
          scheduled_start: est.createdAt ?? null,
          scheduled_end: est.expirationDate ?? null,
          external_ids: { 'clear-estimates': String(est.id) },
          source: 'clear-estimates',
          metadata: {
            ce_estimate_number: est.number,
            ce_customer_name: est.customerName,
            ce_total: est.total,
            ce_profit_margin: est.profitMargin,
            ce_template: est.template,
            ce_line_items_count: est.lineItemsCount,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: est, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: estimates.length, created, errors: errors.length },
      'Clear Estimates sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ClearEstimatesAdapter();
registerAdapter(adapter);
export default adapter;
