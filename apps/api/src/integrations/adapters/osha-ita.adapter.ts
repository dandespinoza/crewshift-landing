/**
 * OSHA ITA (Injury Tracking Application) Integration Adapter
 *
 * Native (Tier 1) adapter for the OSHA Severe Injury Reports API.
 * Provides access to establishment-level injury and illness data.
 *
 * OSHA API Reference:
 * - API: https://www.osha.gov/severeinjury/api
 * - Data: https://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data
 *
 * Key details:
 * - Authentication via API token in query parameter or header
 * - GET /establishments for establishment data
 * - No webhooks
 * - No documented rate limits
 * - Env: OSHA_API_TOKEN
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

const API_BASE = 'https://www.osha.gov/severeinjury/api';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = process.env.OSHA_API_TOKEN ?? (env as Record<string, unknown>).OSHA_API_TOKEN as string | undefined;
  if (!token) throw new Error('OSHA_API_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the OSHA Severe Injury Reports API.
 * The API token is sent both as a query parameter and in the Authorization header
 * for maximum compatibility.
 */
async function oshaFetch(
  path: string,
  params: Record<string, string> = {},
  apiToken?: string,
): Promise<Response> {
  const token = apiToken || getApiToken();

  const searchParams = new URLSearchParams({
    ...params,
    api_token: token,
  });

  const url = `${API_BASE}${path}?${searchParams.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'OSHA API error',
    );
    throw new Error(`OSHA API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class OshaItaAdapter extends BaseAdapter {
  readonly provider = 'osha-ita' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API token auth) ────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('OSHA uses API token authentication, not OAuth. Configure OSHA_API_TOKEN instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('OSHA uses API token authentication — no callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('OSHA uses API token authentication — tokens do not expire or require refresh.');
  }

  // ── Sync: OSHA → CrewShift ────────────────────────────────────────────

  /**
   * Sync establishment data from OSHA Severe Injury Reports API.
   *
   * The accessToken parameter can be used to pass the API token directly.
   * If not provided, falls back to the OSHA_API_TOKEN environment variable.
   */
  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = {
          p: String(page),
          per_page: String(DEFAULT_PAGE_SIZE),
        };

        if (lastSyncAt) {
          // Filter by date if incremental sync is requested
          params.updated_since = lastSyncAt;
        }

        const response = await oshaFetch('/establishments', params, token);
        const data = await response.json();

        // The API may return an array or a wrapper object
        const establishments: Record<string, unknown>[] = Array.isArray(data)
          ? data
          : (data as Record<string, unknown>).results
            ? ((data as Record<string, unknown>).results as Record<string, unknown>[])
            : [];

        for (const establishment of establishments) {
          try {
            const mapped = this.mapEstablishment(establishment);
            records.push(mapped);
            created++;
          } catch (err) {
            errors.push({ item: establishment, error: (err as Error).message });
          }
        }

        if (establishments.length < DEFAULT_PAGE_SIZE) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (err) {
        logger.error(
          { provider: this.provider, page, error: (err as Error).message },
          'OSHA establishment sync page failed',
        );
        errors.push({ item: { page }, error: (err as Error).message });
        hasMore = false;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'OSHA establishment sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class defaults are sufficient since OSHA does not support webhooks.

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Map an OSHA establishment record to CrewShift's unified format.
   */
  private mapEstablishment(
    establishment: Record<string, unknown>,
  ): Record<string, unknown> {
    const estId =
      (establishment.id as string) ??
      (establishment.establishment_id as string) ??
      (establishment.case_id as string) ??
      'unknown';

    return {
      external_id: String(estId),
      name: (establishment.establishment_name as string) ??
            (establishment.company as string) ??
            null,
      industry: (establishment.industry as string) ??
                (establishment.naics_code as string) ??
                null,
      sic_code: (establishment.sic_code as string) ?? null,
      naics_code: (establishment.naics_code as string) ?? null,
      state: (establishment.state as string) ?? null,
      city: (establishment.city as string) ?? null,
      zip: (establishment.zip_code as string) ?? (establishment.zip as string) ?? null,
      address: (establishment.street_address as string) ??
               (establishment.address as string) ?? null,
      event_date: (establishment.event_date as string) ??
                  (establishment.inspection_date as string) ?? null,
      event_description: (establishment.event_description as string) ??
                         (establishment.nature_of_injury as string) ?? null,
      hospitalized: (establishment.hospitalized as boolean) ?? null,
      amputation: (establishment.amputation as boolean) ?? null,
      final_narrative: (establishment.final_narrative as string) ?? null,
      external_ids: { 'osha-ita': String(estId) },
      source: 'osha-ita',
      metadata: establishment,
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new OshaItaAdapter();
registerAdapter(adapter);
export default adapter;
