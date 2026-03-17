/**
 * Merchants Bonding Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for Merchants Bonding Company.
 * Handles API Key auth and bonding data sync.
 *
 * Merchants Bonding API Reference:
 * - API Base: https://api.merchantsbonding.com/v1
 *
 * Key details:
 * - API Key authentication
 * - Bond data sync via GET /bonds
 * - No webhooks
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

const MB_API_BASE = 'https://api.merchantsbonding.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.MERCHANTS_BONDING_API_KEY;
  if (!key) throw new Error('MERCHANTS_BONDING_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the Merchants Bonding API.
 */
async function mbFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${MB_API_BASE}${path}`;

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
      'Merchants Bonding API error',
    );
    throw new Error(`Merchants Bonding API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class MerchantsBondingAdapter extends BaseAdapter {
  readonly provider = 'merchants-bonding' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Merchants Bonding uses API Key authentication, not OAuth. Configure MERCHANTS_BONDING_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Merchants Bonding uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Merchants Bonding uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Merchants Bonding → CrewShift ────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await mbFetch('/bonds', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const bonds = (data.bonds as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const bond of bonds) {
      try {
        records.push({
          title: `Bond — ${bond.bondNumber ?? 'N/A'}`,
          status: bond.status ?? null,
          scheduled_start: bond.effectiveDate ?? null,
          scheduled_end: bond.expirationDate ?? null,
          external_ids: { 'merchants-bonding': String(bond.id ?? bond.bondNumber) },
          source: 'merchants-bonding',
          metadata: {
            mb_bond_number: bond.bondNumber,
            mb_bond_type: bond.bondType,
            mb_principal: bond.principal,
            mb_obligee: bond.obligee,
            mb_penalty_amount: bond.penaltyAmount,
            mb_premium: bond.premium,
            mb_state: bond.state,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: bond, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: bonds.length, created, errors: errors.length },
      'Merchants Bonding bond sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new MerchantsBondingAdapter();
registerAdapter(adapter);
export default adapter;
