/**
 * EPA Envirofacts Integration Adapter
 *
 * Native (Tier 1) adapter for the EPA Envirofacts REST API.
 * Provides access to environmental compliance data including water systems,
 * air facilities, TRI (Toxics Release Inventory) facilities, and more.
 *
 * EPA Envirofacts API Reference:
 * - Overview: https://www.epa.gov/enviro/envirofacts-data-service-api
 * - Endpoints: https://enviro.epa.gov/enviro/efservice
 *
 * Key details:
 * - Completely free, no API key or authentication required
 * - Data is returned in JSON format when /JSON suffix is used
 * - Pagination via rows/{start}:{end} path segment
 * - No rate limits documented
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

const API_BASE = 'https://enviro.epa.gov/enviro/efservice';
const DEFAULT_PAGE_SIZE = 1000;

/**
 * Available EPA Envirofacts tables for environmental compliance.
 */
const EPA_TABLES = [
  'WATER_SYSTEM',
  'AIR_FACILITY',
  'TRI_FACILITY',
  'RCRAINFO',
  'SDWIS',
  'PCS_PERMIT_FACILITY',
  'ICIS_FACILITY',
  'BR_REPORTING',
] as const;

type EpaTable = typeof EPA_TABLES[number];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch rows from an EPA Envirofacts table.
 * No authentication is required.
 */
async function epaFetch(
  table: string,
  startRow: number,
  endRow: number,
  columnFilters?: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  // Build the URL: /{table}/{column}/{value}/.../rows/{start}:{end}/JSON
  let path = `${API_BASE}/${table}`;

  if (columnFilters) {
    for (const [column, value] of Object.entries(columnFilters)) {
      path += `/${column}/${encodeURIComponent(value)}`;
    }
  }

  path += `/rows/${startRow}:${endRow}/JSON`;

  const response = await fetch(path, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, table, startRow, endRow, errorBody },
      'EPA Envirofacts API error',
    );
    throw new Error(`EPA Envirofacts API error: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();

  // The API returns an array of records directly
  if (Array.isArray(data)) {
    return data as Record<string, unknown>[];
  }

  return [];
}

/**
 * Fetch all rows from an EPA table by paginating through results.
 */
async function epaFetchAll(
  table: string,
  columnFilters?: Record<string, string>,
  maxRows?: number,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let startRow = 0;
  let hasMore = true;
  const limit = maxRows ?? 10000;

  while (hasMore && results.length < limit) {
    const endRow = startRow + DEFAULT_PAGE_SIZE - 1;
    const batch = await epaFetch(table, startRow, endRow, columnFilters);

    results.push(...batch);

    if (batch.length < DEFAULT_PAGE_SIZE || results.length >= limit) {
      hasMore = false;
    } else {
      startRow += DEFAULT_PAGE_SIZE;
    }
  }

  return results.slice(0, limit);
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class EpaEnvirofactsAdapter extends BaseAdapter {
  readonly provider = 'epa-envirofacts' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — free public API) ───────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('EPA Envirofacts requires no authentication — it is a free public API.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('EPA Envirofacts requires no authentication — no callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('EPA Envirofacts requires no authentication — no token refresh required.');
  }

  // ── Sync: EPA → CrewShift ─────────────────────────────────────────────

  /**
   * Sync environmental facility/compliance data from EPA Envirofacts.
   *
   * The accessToken parameter is unused since no auth is needed. Instead,
   * it can be used to pass a pipe-delimited configuration string:
   * "table|maxRows" (e.g., "WATER_SYSTEM|5000") or just "table".
   *
   * If no accessToken is provided, defaults to TRI_FACILITY with 5000 max rows.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Parse optional configuration from the accessToken field
    const parts = accessToken ? accessToken.split('|') : [];
    const table = (parts[0] as string) || 'TRI_FACILITY';
    const maxRows = parts[1] ? parseInt(parts[1], 10) : 5000;

    // Validate table name
    if (!EPA_TABLES.includes(table as EpaTable) && !table.match(/^[A-Z_]+$/)) {
      throw new Error(`Invalid EPA table name: ${table}`);
    }

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    try {
      const facilities = await epaFetchAll(table, undefined, maxRows);

      for (const facility of facilities) {
        try {
          const mapped = this.mapEpaFacility(table, facility);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: facility, error: (err as Error).message });
        }
      }

      logger.info(
        { provider: this.provider, table, total: facilities.length, created, errors: errors.length },
        'EPA Envirofacts sync complete',
      );
    } catch (err) {
      logger.error(
        { provider: this.provider, table, error: (err as Error).message },
        'EPA Envirofacts sync failed',
      );
      errors.push({ item: { table }, error: (err as Error).message });
    }

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class defaults (verifyWebhook returns false, processWebhook throws)
  // are sufficient since EPA Envirofacts does not support webhooks.

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Map an EPA facility record to CrewShift's unified format.
   */
  private mapEpaFacility(
    table: string,
    facility: Record<string, unknown>,
  ): Record<string, unknown> {
    // Different tables have different column names; normalize the most common ones
    const facilityId =
      (facility.REGISTRY_ID as string) ??
      (facility.PWSID as string) ??
      (facility.FACILITY_NAME as string) ??
      (facility.TRI_FACILITY_ID as string) ??
      (facility.HANDLER_ID as string) ??
      'unknown';

    const facilityName =
      (facility.FACILITY_NAME as string) ??
      (facility.PWS_NAME as string) ??
      (facility.FAC_NAME as string) ??
      (facility.HANDLER_NAME as string) ??
      null;

    return {
      external_id: facilityId,
      name: facilityName,
      table,
      state: (facility.STATE_CODE as string) ?? (facility.STATE as string) ?? null,
      city: (facility.CITY_NAME as string) ?? (facility.CITY as string) ?? null,
      zip: (facility.ZIP_CODE as string) ?? (facility.ZIP as string) ?? null,
      address: (facility.STREET_ADDRESS as string) ?? (facility.ADDRESS as string) ?? null,
      county: (facility.COUNTY_NAME as string) ?? null,
      latitude: (facility.LATITUDE83 as number) ?? (facility.FAC_LAT as number) ?? null,
      longitude: (facility.LONGITUDE83 as number) ?? (facility.FAC_LONG as number) ?? null,
      external_ids: { 'epa-envirofacts': facilityId },
      source: 'epa-envirofacts',
      metadata: facility,
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new EpaEnvirofactsAdapter();
registerAdapter(adapter);
export default adapter;
