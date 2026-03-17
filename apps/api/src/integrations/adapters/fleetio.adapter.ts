/**
 * Fleetio Integration Adapter
 *
 * Native (Tier 1) adapter for Fleetio fleet management.
 * Handles API key + account token auth, vehicle/service entry sync, and webhooks.
 *
 * Fleetio API Reference:
 * - API: https://developer.fleetio.com/
 * - Webhooks: https://developer.fleetio.com/docs/webhooks
 *
 * Key details:
 * - Auth: API key in Authorization header + Account-Token header
 * - Syncs vehicles and service/maintenance entries
 * - Webhook verification: HMAC-SHA256 via X-Fleetio-Signature header
 * - Pricing: ~$4/vehicle/month
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
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

const API_BASE = 'https://secure.fleetio.com/api/v2';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.FLEETIO_API_KEY ?? env.FLEETIO_API_KEY;
  if (!key) throw new Error('FLEETIO_API_KEY is not configured');
  return key;
}

function getAccountToken(): string {
  const token = process.env.FLEETIO_ACCOUNT_TOKEN ?? env.FLEETIO_ACCOUNT_TOKEN;
  if (!token) throw new Error('FLEETIO_ACCOUNT_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the Fleetio API.
 * Requires both Authorization (Token) and Account-Token headers.
 */
async function fleetioFetch(
  path: string,
  apiKey: string,
  accountToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Account-Token': accountToken,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Fleetio API error',
    );
    throw new Error(`Fleetio API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Fleetio list endpoint.
 * Fleetio uses cursor-based or page-based pagination depending on the endpoint.
 */
async function fleetioFetchAllPages(
  path: string,
  apiKey: string,
  accountToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&per_page=${DEFAULT_PAGE_SIZE}`;

    const response = await fleetioFetch(pagedPath, apiKey, accountToken);
    const data = (await response.json()) as Record<string, unknown> | Array<Record<string, unknown>>;

    // Fleetio may return array directly or wrapped in an object
    const items = Array.isArray(data)
      ? data
      : (data.records as Array<Record<string, unknown>>) ?? (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    if (items.length < DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class FleetioAdapter extends BaseAdapter {
  readonly provider = 'fleetio' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API key + account token auth) ────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Fleetio uses API key + account token authentication, not OAuth. Configure FLEETIO_API_KEY and FLEETIO_ACCOUNT_TOKEN instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Fleetio uses API key + account token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Fleetio uses API key + account token authentication. Tokens do not expire or require refresh.');
  }

  // ── Sync: Fleetio → CrewShift ─────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Parse composite token "apiKey|accountToken" or use env defaults
    const [apiKey, accountToken] = this.parseAccessToken(accessToken);

    // Sync vehicles
    const vehicles = await fleetioFetchAllPages('/vehicles', apiKey, accountToken);

    // Sync service entries (maintenance records)
    const serviceEntries = await fleetioFetchAllPages('/service_entries', apiKey, accountToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    // Map vehicles
    for (const vehicle of vehicles) {
      try {
        records.push({
          title: (vehicle.name as string) ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          status: (vehicle.vehicle_status_name as string) ?? (vehicle.status as string) ?? 'active',
          type: 'vehicle',
          external_ids: { fleetio: String(vehicle.id) },
          source: 'fleetio',
          metadata: {
            fleetio_type: 'vehicle',
            fleetio_vin: vehicle.vin,
            fleetio_license_plate: vehicle.license_plate,
            fleetio_year: vehicle.year,
            fleetio_make: vehicle.make,
            fleetio_model: vehicle.model,
            fleetio_trim: vehicle.trim,
            fleetio_color: vehicle.color,
            fleetio_meter_value: vehicle.current_meter_value,
            fleetio_meter_unit: vehicle.meter_unit,
            fleetio_group_name: vehicle.group_name,
            fleetio_ownership: vehicle.ownership,
            fleetio_fuel_type: vehicle.fuel_type_name,
            fleetio_updated_at: vehicle.updated_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: vehicle, error: (err as Error).message });
      }
    }

    // Map service entries
    for (const entry of serviceEntries) {
      try {
        const lineItems = (entry.service_entry_line_items as Array<Record<string, unknown>>) ?? [];
        records.push({
          title: (entry.description as string) ?? `Service Entry ${entry.id}`,
          status: (entry.completed_at as string) ? 'completed' : 'scheduled',
          type: 'service_entry',
          external_ids: { fleetio: `service_${entry.id}` },
          source: 'fleetio',
          metadata: {
            fleetio_type: 'service_entry',
            fleetio_vehicle_id: entry.vehicle_id,
            fleetio_vendor_name: entry.vendor_name,
            fleetio_total_amount: entry.total_amount,
            fleetio_started_at: entry.started_at,
            fleetio_completed_at: entry.completed_at,
            fleetio_meter_value: entry.meter_value,
            fleetio_service_tasks: lineItems.map((li) => ({
              description: li.description ?? li.service_task_name,
              parts_cost: li.parts_cost,
              labor_cost: li.labor_cost,
              subtotal: li.subtotal,
            })),
            fleetio_updated_at: entry.updated_at,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: entry, error: (err as Error).message });
      }
    }

    logger.info(
      {
        provider: this.provider,
        vehicles: vehicles.length,
        serviceEntries: serviceEntries.length,
        created,
        errors: errors.length,
      },
      'Fleetio vehicle/service sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = getApiKey();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    // Derive resource type from event (e.g., "vehicle.updated" -> "vehicle")
    const parts = eventType.split('.');
    const resourceType = parts[0] ?? 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.id ? String(data.id) : undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "apiKey|accountToken" used by sync service.
   * Falls back to env variables if not composite.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe !== -1) {
      return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
    }
    // Fall back to env variables
    return [getApiKey(), getAccountToken()];
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new FleetioAdapter();
registerAdapter(adapter);
export default adapter;
