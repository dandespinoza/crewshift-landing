/**
 * Verizon Connect Integration Adapter
 *
 * Tier 3 (native) adapter for Verizon Connect (Fleetmatics) — fleet management platform.
 * Handles Basic Auth, vehicle/trip sync, and token-based webhook verification.
 *
 * Verizon Connect / Fleetmatics API Reference:
 * - API Base: https://fim.api.us.fleetmatics.com/sta/v2
 * - Auth: HTTP Basic Authentication (username:password)
 *
 * Key details:
 * - Developer application approval required
 * - No OAuth flow — Basic Auth (username + password)
 * - syncJobs pulls /vehicles for fleet data and /trips for trip data
 * - Webhook verification via token comparison
 * - Env: VERIZON_CONNECT_USERNAME, VERIZON_CONNECT_PASSWORD
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

const API_BASE = 'https://fim.api.us.fleetmatics.com/sta/v2';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUsername(): string {
  const user = process.env.VERIZON_CONNECT_USERNAME ?? (env as Record<string, unknown>).VERIZON_CONNECT_USERNAME as string | undefined;
  if (!user) throw new Error('VERIZON_CONNECT_USERNAME is not configured');
  return user;
}

function getPassword(): string {
  const pass = process.env.VERIZON_CONNECT_PASSWORD ?? (env as Record<string, unknown>).VERIZON_CONNECT_PASSWORD as string | undefined;
  if (!pass) throw new Error('VERIZON_CONNECT_PASSWORD is not configured');
  return pass;
}

function getBasicAuthHeader(username?: string, password?: string): string {
  const user = username ?? getUsername();
  const pass = password ?? getPassword();
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Verizon Connect / Fleetmatics API.
 */
async function verizonFetch(
  path: string,
  authHeader: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Verizon Connect API error',
    );
    throw new Error(`Verizon Connect API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Verizon Connect list endpoints.
 */
async function verizonPaginateAll(
  path: string,
  authHeader: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const searchParams = new URLSearchParams({
      limit: String(DEFAULT_PAGE_SIZE),
      offset: String(offset),
      ...params,
    });

    const response = await verizonFetch(
      `${path}?${searchParams.toString()}`,
      authHeader,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[])
      ?? (data.vehicles as Record<string, unknown>[])
      ?? (data.trips as Record<string, unknown>[])
      ?? [];

    results.push(...items);

    hasMore = items.length === DEFAULT_PAGE_SIZE;
    offset += DEFAULT_PAGE_SIZE;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class VerizonConnectAdapter extends BaseAdapter {
  readonly provider = 'verizon-connect' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — Basic Auth) ────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Verizon Connect uses Basic Auth, not OAuth. Configure VERIZON_CONNECT_USERNAME and VERIZON_CONNECT_PASSWORD instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Verizon Connect uses Basic Auth, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Verizon Connect uses Basic Auth. Credentials do not expire through OAuth refresh.');
  }

  // ── Sync: Verizon Connect → CrewShift ──────────────────────────────────

  /**
   * Sync fleet/vehicle and trip data from Verizon Connect.
   * Pulls both /vehicles and /trips endpoints and merges the data.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // accessToken may contain "username|password" or be the encoded auth header
    const authHeader = this.resolveAuthHeader(accessToken);

    const vehicles = await verizonPaginateAll('/vehicles', authHeader);
    const trips = await verizonPaginateAll('/trips', authHeader);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    // Map vehicles
    for (const vehicle of vehicles) {
      try {
        const mapped = this.mapVehicle(vehicle);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: vehicle, error: (err as Error).message });
      }
    }

    // Map trips
    for (const trip of trips) {
      try {
        const mapped = this.mapTrip(trip);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: trip, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, vehicles: vehicles.length, trips: trips.length, created, errors: errors.length },
      'Verizon Connect fleet sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  /**
   * Verify webhook by comparing the provided token against the stored password.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    const password = process.env.VERIZON_CONNECT_PASSWORD ?? (env as Record<string, unknown>).VERIZON_CONNECT_PASSWORD as string | undefined;
    if (!password) {
      logger.warn('No Verizon Connect password configured for webhook verification');
      return false;
    }

    return signature === password;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event as string) ?? (payload.type as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: (payload.resource_type as string) ?? 'vehicle',
      resource_id: (data?.id as string) ?? (payload.id as string) ?? undefined,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Resolve the auth header from an access token string.
   * Supports "username|password" format or pre-built auth headers.
   */
  private resolveAuthHeader(accessToken: string): string {
    if (!accessToken) {
      return getBasicAuthHeader();
    }

    // If the token contains a pipe, treat it as "username|password"
    const pipe = accessToken.indexOf('|');
    if (pipe !== -1) {
      const username = accessToken.slice(0, pipe);
      const password = accessToken.slice(pipe + 1);
      return getBasicAuthHeader(username, password);
    }

    // Otherwise treat it as a pre-built auth header or raw token
    if (accessToken.startsWith('Basic ')) {
      return accessToken;
    }

    return getBasicAuthHeader();
  }

  /**
   * Map a Verizon Connect Vehicle to CrewShift's unified job format.
   */
  private mapVehicle(vehicle: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (vehicle.name as string) ?? (vehicle.label as string) ?? `Vehicle ${vehicle.id}`,
      description: `Fleet vehicle: ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.year ?? ''}`.trim(),
      status: (vehicle.status as string) ?? 'active',
      type: 'vehicle',
      external_ids: { 'verizon-connect': String(vehicle.id ?? vehicle.vehicleId) },
      source: 'verizon-connect',
      metadata: {
        vc_vin: vehicle.vin,
        vc_license_plate: vehicle.licensePlate ?? vehicle.registration,
        vc_make: vehicle.make,
        vc_model: vehicle.model,
        vc_year: vehicle.year,
        vc_odometer: vehicle.odometer,
        vc_last_location: vehicle.lastLocation ?? vehicle.position,
        vc_driver_id: vehicle.driverId,
      },
    };
  }

  /**
   * Map a Verizon Connect Trip to CrewShift's unified job format.
   */
  private mapTrip(trip: Record<string, unknown>): Record<string, unknown> {
    return {
      title: `Trip ${trip.id ?? trip.tripId ?? 'unknown'}`,
      description: `${trip.startAddress ?? 'Unknown origin'} → ${trip.endAddress ?? 'Unknown destination'}`,
      status: (trip.status as string) ?? 'completed',
      type: 'trip',
      scheduled_start: (trip.startTime as string) ?? (trip.start as string) ?? null,
      scheduled_end: (trip.endTime as string) ?? (trip.end as string) ?? null,
      external_ids: { 'verizon-connect': String(trip.id ?? trip.tripId) },
      source: 'verizon-connect',
      metadata: {
        vc_vehicle_id: trip.vehicleId,
        vc_driver_id: trip.driverId,
        vc_distance: trip.distance,
        vc_duration: trip.duration,
        vc_start_address: trip.startAddress,
        vc_end_address: trip.endAddress,
        vc_max_speed: trip.maxSpeed,
        vc_avg_speed: trip.avgSpeed,
        vc_idle_time: trip.idleTime,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new VerizonConnectAdapter();
registerAdapter(adapter);
export default adapter;
