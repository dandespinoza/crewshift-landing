/**
 * Samsara Integration Adapter
 *
 * Native (Tier 1) adapter for Samsara fleet management.
 * Handles OAuth 2.0, vehicle/driver sync, and webhook processing.
 *
 * Samsara API Reference:
 * - Auth: https://developers.samsara.com/docs/authentication
 * - Fleet: https://developers.samsara.com/reference/listVehicles
 * - Drivers: https://developers.samsara.com/reference/listDrivers
 * - Webhooks: https://developers.samsara.com/docs/webhooks
 *
 * Key details:
 * - OAuth 2.0 with bearer tokens; also supports direct API tokens
 * - Pagination via cursor-based hasNextPage + endCursor
 * - Webhook signatures are HMAC-SHA256
 * - Rate limit: 150 requests/second
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

// -- Constants ----------------------------------------------------------------

const SAMSARA_AUTH_URL = 'https://accounts.samsara.com/oauth2/authorize';
const SAMSARA_TOKEN_URL = 'https://accounts.samsara.com/oauth2/token';
const SAMSARA_API_BASE = 'https://api.samsara.com';

// -- Helpers ------------------------------------------------------------------

/**
 * Make an authenticated request to the Samsara API.
 */
async function samsaraFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${SAMSARA_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Samsara API error',
    );
    throw new Error(`Samsara API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map a Samsara vehicle to the CrewShift unified job/fleet format.
 */
function mapVehicleToJob(vehicle: Record<string, unknown>): Record<string, unknown> {
  const gps = (vehicle.gps as Record<string, unknown>) ?? {};

  return {
    title: (vehicle.name as string) ?? 'Unknown Vehicle',
    start: null,
    end: null,
    location: gps.reverseGeo
      ? ((gps.reverseGeo as Record<string, unknown>).formattedLocation as string)
      : null,
    description: `Vehicle: ${(vehicle.make as string) ?? ''} ${(vehicle.model as string) ?? ''} ${(vehicle.year as string) ?? ''}`.trim(),
    status: (vehicle.vehicleStatus as string) ?? 'active',
    external_ids: { samsara: (vehicle.id as string) ?? '' },
    source: 'samsara',
    resource_type: 'vehicle',
    metadata: {
      samsara_id: vehicle.id,
      samsara_name: vehicle.name,
      samsara_vin: vehicle.vin,
      samsara_serial: vehicle.serial,
      samsara_make: vehicle.make,
      samsara_model: vehicle.model,
      samsara_year: vehicle.year,
      samsara_license_plate: vehicle.licensePlate,
      samsara_odometer: vehicle.odometerMeters,
      samsara_fuel_percent: vehicle.fuelPercent,
      samsara_engine_state: vehicle.engineState,
      samsara_gps: gps.latitude && gps.longitude
        ? { latitude: gps.latitude, longitude: gps.longitude, speed: gps.speedMilesPerHour }
        : null,
      samsara_tags: vehicle.tags,
    },
  };
}

/**
 * Map a Samsara driver to a CrewShift record.
 */
function mapDriverToRecord(driver: Record<string, unknown>): Record<string, unknown> {
  const attributes = (driver.attributes as Record<string, unknown>[]) ?? [];

  return {
    title: (driver.name as string) ?? 'Unknown Driver',
    start: null,
    end: null,
    location: null,
    description: `Driver: ${(driver.name as string) ?? 'Unknown'}`,
    status: (driver.driverActivationStatus as string) === 'active' ? 'active' : 'inactive',
    external_ids: { samsara: (driver.id as string) ?? '' },
    source: 'samsara',
    resource_type: 'driver',
    metadata: {
      samsara_id: driver.id,
      samsara_name: driver.name,
      samsara_username: driver.username,
      samsara_phone: driver.phone,
      samsara_license_number: driver.licenseNumber,
      samsara_license_state: driver.licenseState,
      samsara_activation_status: driver.driverActivationStatus,
      samsara_eld_status: driver.eldStatus,
      samsara_tags: driver.tags,
      samsara_attributes: attributes,
      samsara_vehicle_id: driver.currentVehicleId,
    },
  };
}

// -- Adapter ------------------------------------------------------------------

class SamsaraAdapter extends BaseAdapter {
  readonly provider = 'samsara' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.SAMSARA_CLIENT_ID;
    if (!clientId) {
      throw new Error('SAMSARA_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${SAMSARA_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.SAMSARA_CLIENT_ID ?? '';
    const clientSecret = env.SAMSARA_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/samsara/callback`;

    const response = await fetch(SAMSARA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Samsara token exchange failed');
      throw new Error(`Samsara token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Samsara');
    }

    const clientId = env.SAMSARA_CLIENT_ID ?? '';
    const clientSecret = env.SAMSARA_CLIENT_SECRET ?? '';

    const response = await fetch(SAMSARA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Samsara token refresh failed');
      throw new Error(`Samsara token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // -- Sync: Samsara -> CrewShift ---------------------------------------------

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // Sync vehicles
    let hasNextPage = true;
    let cursor: string | undefined;

    while (hasNextPage) {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) {
        params.set('after', cursor);
      }

      const response = await samsaraFetch(
        `/fleet/vehicles?${params.toString()}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const vehicles = (data.data as Record<string, unknown>[]) ?? [];
      const pagination = (data.pagination as Record<string, unknown>) ?? {};

      for (const vehicle of vehicles) {
        try {
          const mapped = mapVehicleToJob(vehicle);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: vehicle, error: (err as Error).message });
        }
      }

      hasNextPage = (pagination.hasNextPage as boolean) ?? false;
      cursor = pagination.endCursor as string | undefined;
    }

    // Sync drivers
    hasNextPage = true;
    cursor = undefined;

    while (hasNextPage) {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) {
        params.set('after', cursor);
      }

      const response = await samsaraFetch(
        `/fleet/drivers?${params.toString()}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const drivers = (data.data as Record<string, unknown>[]) ?? [];
      const pagination = (data.pagination as Record<string, unknown>) ?? {};

      for (const driver of drivers) {
        try {
          const mapped = mapDriverToRecord(driver);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: driver, error: (err as Error).message });
        }
      }

      hasNextPage = (pagination.hasNextPage as boolean) ?? false;
      cursor = pagination.endCursor as string | undefined;
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Samsara fleet sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * Verify Samsara webhook signature.
   *
   * Samsara signs webhook payloads with HMAC-SHA256 using the webhook secret.
   * The signature is sent in the X-Samsara-Hmac-Sha256 header.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    const webhookSecret = env.SAMSARA_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.warn('No Samsara webhook secret configured');
      return false;
    }

    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Samsara webhook payload structure:
    // { eventType: "VehicleLocation", data: { ... }, time: "..." }
    const eventType = (payload.eventType as string) ?? 'unknown';
    const data = (payload.data as Record<string, unknown>) ?? {};
    const time = (payload.time as string) ?? new Date().toISOString();

    // Determine resource type from event type
    let resourceType = 'unknown';
    if (eventType.toLowerCase().includes('vehicle')) {
      resourceType = 'vehicle';
    } else if (eventType.toLowerCase().includes('driver')) {
      resourceType = 'driver';
    } else if (eventType.toLowerCase().includes('route')) {
      resourceType = 'route';
    }

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (data.id as string) ?? (data.vehicleId as string) ?? (data.driverId as string) ?? undefined,
      data: {
        eventType,
        data,
        time,
        ...payload,
      },
      timestamp: time,
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new SamsaraAdapter();
registerAdapter(adapter);
export default adapter;
