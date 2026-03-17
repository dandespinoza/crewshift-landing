/**
 * NEXT Insurance Integration Adapter
 *
 * Tier 5 (partner/enterprise) adapter for NEXT Insurance.
 * Handles API Key auth and insurance certificate sync.
 *
 * NEXT Insurance API Reference:
 * - API Base: https://api.nextinsurance.com/v1
 * - NEXT Connect: https://www.nextinsurance.com/connect/
 *
 * Key details:
 * - API Key authentication
 * - Certificate sync via GET /certificates
 * - NOTE: NEXT Connect partner program required
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

const NEXT_INSURANCE_API_BASE = 'https://api.nextinsurance.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.NEXT_INSURANCE_API_KEY;
  if (!key) throw new Error('NEXT_INSURANCE_API_KEY is not configured — NEXT Connect partner program required');
  return key;
}

/**
 * Make an authenticated request to the NEXT Insurance API.
 */
async function nextInsuranceFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${NEXT_INSURANCE_API_BASE}${path}`;

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
      'NEXT Insurance API error',
    );
    throw new Error(`NEXT Insurance API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class NextInsuranceAdapter extends BaseAdapter {
  readonly provider = 'next-insurance' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('NEXT Insurance uses API Key authentication, not OAuth. Configure NEXT_INSURANCE_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('NEXT Insurance uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('NEXT Insurance uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: NEXT Insurance → CrewShift ────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await nextInsuranceFetch('/certificates', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const certificates = (data.certificates as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const cert of certificates) {
      try {
        records.push({
          title: `Insurance Certificate — ${cert.policyNumber ?? 'N/A'}`,
          status: cert.status ?? null,
          scheduled_start: cert.effectiveDate ?? null,
          scheduled_end: cert.expirationDate ?? null,
          external_ids: { 'next-insurance': String(cert.id) },
          source: 'next-insurance',
          metadata: {
            next_policy_number: cert.policyNumber,
            next_policy_type: cert.policyType,
            next_certificate_holder: cert.certificateHolder,
            next_insured_name: cert.insuredName,
            next_coverage_amount: cert.coverageAmount,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cert, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: certificates.length, created, errors: errors.length },
      'NEXT Insurance certificate sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new NextInsuranceAdapter();
registerAdapter(adapter);
export default adapter;
