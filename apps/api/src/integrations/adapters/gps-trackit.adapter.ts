/**
 * GPS Trackit Integration Adapter
 *
 * Native (Tier 1) adapter for GPS Trackit fleet tracking.
 * Handles API key auth, vehicle sync, and trip data retrieval.
 *
 * GPS Trackit API Reference:
 * - Vehicles: https://api.gpstrackit.com/api/v2/vehicles
 * - Trips: https://api.gpstrackit.com/api/v2/trips
 *
 * Key details:
 * - Authentication via API key in Authorization header
 * - Vehicles endpoint provides current fleet data
 * - Trips endpoint provides historical route/trip data
 * - No webhook support; polling-based sync only
 * - Rate limit: 50 queries/minute
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

// -- Constants ----------------------------------------------------------------

const GPS_TRACKIT_API_BASE = 'https://api.gpstrackit.com/api/v2';
const GPS_TRACKIT_PAGE_SIZE = 50;

// -- Helpers ------------------------------------------------------------------

/**
 * Get the GPS Trackit API key from env.
 */
function getApiKey(): string {
  const apiKey = env.GPS_TRACKIT_API_KEY;
  if (!apiKey) {
    throw new Error('GPS_TRACKIT_API_KEY is not configured');
  }
  return apiKey;
}

/**
 * Make an authenticated request to the GPS Trackit API.
 * Uses API key in the Authorization header.
 */
async function gpsTrackitFetch(
  path: string,
  options: RequestInit = {},
  queryParams?: Record<string, string>,
): Promise<Response> {
  const url = new URL(`${GPS_TRACKIT_API_BASE}${path}`);

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'GPS Trackit API error',
    );
    throw new Error(`GPS Trackit API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map a GPS Trackit vehicle to the CrewShift unified job/fleet format.
 */
function mapVehicleToRecord(vehicle: Record<string, unknown>): Record<string, unknown> {
  const position = (vehicle.position as Record<string, unknown>) ?? {};

  return {
    title: (vehicle.name as string) ?? (vehicle.label as string) ?? 'Unknown Vehicle',
    start: null,
    end: null,
    location: position.address
      ? (position.address as string)
      : position.latitude && position.longitude
        ? `${position.latitude}, ${position.longitude}`
        : null,
    description: `Vehicle: ${(vehicle.make as string) ?? ''} ${(vehicle.model as string) ?? ''} ${(vehicle.year as string) ?? ''}`.trim(),
    status: (vehicle.status as string) ?? 'unknown',
    external_ids: { 'gps-trackit': String(vehicle.id ?? vehicle.deviceId ?? '') },
    source: 'gps-trackit',
    resource_type: 'vehicle',
    metadata: {
      gps_trackit_id: vehicle.id,
      gps_trackit_device_id: vehicle.deviceId,
      gps_trackit_name: vehicle.name,
      gps_trackit_label: vehicle.label,
      gps_trackit_make: vehicle.make,
      gps_trackit_model: vehicle.model,
      gps_trackit_year: vehicle.year,
      gps_trackit_vin: vehicle.vin,
      gps_trackit_license_plate: vehicle.licensePlate,
      gps_trackit_odometer: vehicle.odometer,
      gps_trackit_engine_hours: vehicle.engineHours,
      gps_trackit_status: vehicle.status,
      gps_trackit_position: position.latitude && position.longitude
        ? {
            latitude: position.latitude,
            longitude: position.longitude,
            speed: position.speed,
            heading: position.heading,
            address: position.address,
            timestamp: position.timestamp,
          }
        : null,
      gps_trackit_group: vehicle.group,
      gps_trackit_driver: vehicle.driver,
    },
  };
}

/**
 * Map a GPS Trackit trip to the CrewShift unified job/fleet format.
 */
function mapTripToRecord(trip: Record<string, unknown>): Record<string, unknown> {
  return {
    title: `Trip: ${(trip.vehicleName as string) ?? 'Unknown Vehicle'}`,
    start: (trip.startTime as string) ?? null,
    end: (trip.endTime as string) ?? null,
    location: (trip.startAddress as string) ?? null,
    description: `Trip from ${(trip.startAddress as string) ?? 'unknown'} to ${(trip.endAddress as string) ?? 'unknown'}`,
    status: trip.endTime ? 'completed' : 'in_progress',
    external_ids: { 'gps-trackit': String(trip.id ?? trip.tripId ?? '') },
    source: 'gps-trackit',
    resource_type: 'trip',
    metadata: {
      gps_trackit_trip_id: trip.id ?? trip.tripId,
      gps_trackit_vehicle_id: trip.vehicleId,
      gps_trackit_vehicle_name: trip.vehicleName,
      gps_trackit_driver_name: trip.driverName,
      gps_trackit_start_address: trip.startAddress,
      gps_trackit_end_address: trip.endAddress,
      gps_trackit_start_coords: trip.startLatitude && trip.startLongitude
        ? { latitude: trip.startLatitude, longitude: trip.startLongitude }
        : null,
      gps_trackit_end_coords: trip.endLatitude && trip.endLongitude
        ? { latitude: trip.endLatitude, longitude: trip.endLongitude }
        : null,
      gps_trackit_distance: trip.distance,
      gps_trackit_max_speed: trip.maxSpeed,
      gps_trackit_avg_speed: trip.avgSpeed,
      gps_trackit_idle_time: trip.idleTime,
      gps_trackit_drive_time: trip.driveTime,
      gps_trackit_fuel_used: trip.fuelUsed,
    },
  };
}

// -- Adapter ------------------------------------------------------------------

class GpsTrackitAdapter extends BaseAdapter {
  readonly provider = 'gps-trackit' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'GPS Trackit uses API key authentication. ' +
      'Configure the GPS_TRACKIT_API_KEY environment variable.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error(
      'GPS Trackit uses API key authentication. No OAuth callback flow.',
    );
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // API key auth does not expire
    const apiKey = getApiKey();
    return {
      access_token: apiKey,
      refresh_token: undefined,
      expires_at: undefined,
      scope: undefined,
    };
  }

  // -- Sync: GPS Trackit -> CrewShift -----------------------------------------

  async syncJobs(
    _accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // -- Sync vehicles --------------------------------------------------------

    let page = 1;
    let hasMoreVehicles = true;

    while (hasMoreVehicles) {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(GPS_TRACKIT_PAGE_SIZE),
      };

      const response = await gpsTrackitFetch('/vehicles', {}, params);
      const data = (await response.json()) as Record<string, unknown>;
      const vehicles = (data.data as Record<string, unknown>[])
        ?? (data.vehicles as Record<string, unknown>[])
        ?? (Array.isArray(data) ? data as Record<string, unknown>[] : []);

      if (vehicles.length === 0) {
        hasMoreVehicles = false;
        break;
      }

      for (const vehicle of vehicles) {
        try {
          const mapped = mapVehicleToRecord(vehicle);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: vehicle, error: (err as Error).message });
        }
      }

      if (vehicles.length < GPS_TRACKIT_PAGE_SIZE) {
        hasMoreVehicles = false;
      } else {
        page++;
      }
    }

    // -- Sync trips -----------------------------------------------------------

    const tripParams: Record<string, string> = {
      limit: String(GPS_TRACKIT_PAGE_SIZE),
    };

    if (lastSyncAt) {
      tripParams['startDate'] = lastSyncAt.split('T')[0] ?? lastSyncAt;
    } else {
      // Default: sync trips from the last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      tripParams['startDate'] = sevenDaysAgo.toISOString().split('T')[0]!;
    }

    tripParams['endDate'] = new Date().toISOString().split('T')[0]!;

    page = 1;
    let hasMoreTrips = true;

    while (hasMoreTrips) {
      tripParams['page'] = String(page);

      const response = await gpsTrackitFetch('/trips', {}, tripParams);
      const data = (await response.json()) as Record<string, unknown>;
      const trips = (data.data as Record<string, unknown>[])
        ?? (data.trips as Record<string, unknown>[])
        ?? (Array.isArray(data) ? data as Record<string, unknown>[] : []);

      if (trips.length === 0) {
        hasMoreTrips = false;
        break;
      }

      for (const trip of trips) {
        try {
          const mapped = mapTripToRecord(trip);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: trip, error: (err as Error).message });
        }
      }

      if (trips.length < GPS_TRACKIT_PAGE_SIZE) {
        hasMoreTrips = false;
      } else {
        page++;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'GPS Trackit fleet sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * GPS Trackit does not support webhooks.
   * Always returns false.
   */
  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    logger.warn('GPS Trackit does not support webhooks');
    return false;
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new GpsTrackitAdapter();
registerAdapter(adapter);
export default adapter;
