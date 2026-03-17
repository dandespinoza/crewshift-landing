/**
 * Bench Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for Bench.
 * Handles API Key auth and bookkeeping transaction sync.
 *
 * Bench API Reference:
 * - API Base: https://api.bench.co/v2
 *
 * Key details:
 * - API Key authentication
 * - Transaction sync via GET /transactions
 * - NOTE: Embedded partner program required
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

const BENCH_API_BASE = 'https://api.bench.co/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.BENCH_API_KEY;
  if (!key) throw new Error('BENCH_API_KEY is not configured — Bench embedded partner program required');
  return key;
}

/**
 * Make an authenticated request to the Bench API.
 */
async function benchFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BENCH_API_BASE}${path}`;

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
      'Bench API error',
    );
    throw new Error(`Bench API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class BenchAdapter extends BaseAdapter {
  readonly provider = 'bench' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Bench uses API Key authentication, not OAuth. Configure BENCH_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Bench uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Bench uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Bench → CrewShift ─────────────────────────────────────────────

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await benchFetch('/transactions', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const transactions = (data.transactions as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const txn of transactions) {
      try {
        records.push({
          invoice_number: txn.reference ?? null,
          status: txn.status ?? 'completed',
          amount: txn.amount ?? 0,
          balance_due: 0,
          due_date: null,
          issued_date: txn.date ?? null,
          external_ids: { bench: String(txn.id) },
          source: 'bench',
          metadata: {
            bench_category: txn.category,
            bench_account: txn.account,
            bench_description: txn.description,
            bench_type: txn.type,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: txn, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: transactions.length, created, errors: errors.length },
      'Bench transaction sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new BenchAdapter();
registerAdapter(adapter);
export default adapter;
