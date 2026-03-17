/**
 * Liberty Mutual Surety Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for Liberty Mutual Surety.
 * Handles API Key + client certificate auth and surety bond data sync.
 *
 * Liberty Mutual Surety API Reference:
 * - API Base (prod): https://api.libertymutual.com/surety/v1
 * - API Base (test): https://test-developers.libertymutual.com/surety/v1
 * - Swagger docs available
 *
 * Key details:
 * - API Key + client certificate authentication
 * - Bond data sync via GET /bonds
 * - No webhooks
 * - NOTE: Swagger docs available from Liberty Mutual developer portal
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

const LM_PRODUCTION_BASE = 'https://api.libertymutual.com/surety/v1';
const LM_TEST_BASE = 'https://test-developers.libertymutual.com/surety/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.LIBERTY_MUTUAL_API_KEY;
  if (!key) throw new Error('LIBERTY_MUTUAL_API_KEY is not configured — developer portal access required');
  return key;
}

function getApiBase(): string {
  return env.NODE_ENV === 'production' ? LM_PRODUCTION_BASE : LM_TEST_BASE;
}

/**
 * Make an authenticated request to the Liberty Mutual Surety API.
 * Note: In production, client certificate (mTLS) is also required.
 */
async function lmFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBase()}${path}`;

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
      'Liberty Mutual Surety API error',
    );
    throw new Error(`Liberty Mutual Surety API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class LibertyMutualSuretyAdapter extends BaseAdapter {
  readonly provider = 'liberty-mutual-surety' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key + client cert — no OAuth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'Liberty Mutual Surety uses API Key + client certificate authentication, not OAuth. Configure LIBERTY_MUTUAL_API_KEY and client certificates.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Liberty Mutual Surety uses API Key + client cert, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Liberty Mutual Surety uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Liberty Mutual Surety → CrewShift ────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await lmFetch('/bonds', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const bonds = (data.bonds as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const bond of bonds) {
      try {
        records.push({
          title: `Surety Bond — ${bond.bondNumber ?? 'N/A'}`,
          status: bond.status ?? null,
          scheduled_start: bond.effectiveDate ?? null,
          scheduled_end: bond.expirationDate ?? null,
          external_ids: { 'liberty-mutual-surety': String(bond.id ?? bond.bondNumber) },
          source: 'liberty-mutual-surety',
          metadata: {
            lm_bond_number: bond.bondNumber,
            lm_bond_type: bond.bondType,
            lm_principal_name: bond.principalName,
            lm_obligee_name: bond.obligeeName,
            lm_bond_amount: bond.bondAmount,
            lm_premium: bond.premium,
            lm_state: bond.state,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: bond, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: bonds.length, created, errors: errors.length },
      'Liberty Mutual surety bond sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new LibertyMutualSuretyAdapter();
registerAdapter(adapter);
export default adapter;
