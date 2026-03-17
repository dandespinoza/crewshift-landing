/**
 * Thimble Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Thimble.
 * Handles API Key auth and on-demand insurance policy sync.
 *
 * Thimble API Reference:
 * - API Base: https://api.thimble.com/v1
 *
 * Key details:
 * - API Key authentication
 * - Policy sync via GET /policies
 * - NOTE: Free partner API — apply at thimble.com/partners
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

const THIMBLE_API_BASE = 'https://api.thimble.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.THIMBLE_API_KEY;
  if (!key) throw new Error('THIMBLE_API_KEY is not configured — apply at thimble.com/partners');
  return key;
}

/**
 * Make an authenticated request to the Thimble API.
 */
async function thimbleFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${THIMBLE_API_BASE}${path}`;

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
      'Thimble API error',
    );
    throw new Error(`Thimble API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ThimbleAdapter extends BaseAdapter {
  readonly provider = 'thimble' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Thimble uses API Key authentication, not OAuth. Configure THIMBLE_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Thimble uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Thimble uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Thimble → CrewShift ───────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await thimbleFetch('/policies', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const policies = (data.policies as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const policy of policies) {
      try {
        records.push({
          title: `Insurance Policy — ${policy.policyNumber ?? 'N/A'}`,
          status: policy.status ?? null,
          scheduled_start: policy.startDate ?? null,
          scheduled_end: policy.endDate ?? null,
          external_ids: { thimble: String(policy.id) },
          source: 'thimble',
          metadata: {
            thimble_policy_number: policy.policyNumber,
            thimble_policy_type: policy.policyType,
            thimble_coverage: policy.coverage,
            thimble_premium: policy.premium,
            thimble_duration: policy.duration,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: policy, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: policies.length, created, errors: errors.length },
      'Thimble policy sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ThimbleAdapter();
registerAdapter(adapter);
export default adapter;
