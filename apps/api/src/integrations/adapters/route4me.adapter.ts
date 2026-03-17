/**
 * Route4Me Integration Adapter
 *
 * Native (Tier 1) adapter for Route4Me route optimization.
 * Handles API key auth, route/stop sync, and fleet management.
 *
 * Route4Me API Reference:
 * - Auth: https://route4me.io/docs/#authentication
 * - Routes: https://route4me.io/docs/#routes
 * - Addresses: https://route4me.io/docs/#addresses
 *
 * Key details:
 * - Authentication via api_key query parameter on every request
 * - Routes contain addresses (stops) with sequencing and time windows
 * - No built-in webhook signature verification
 * - Rate limits vary by plan
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

const ROUTE4ME_API_BASE = 'https://api.route4me.com';

// -- Helpers ------------------------------------------------------------------

/**
 * Get the Route4Me API key from env.
 */
function getApiKey(): string {
  const apiKey = env.ROUTE4ME_API_KEY;
  if (!apiKey) {
    throw new Error('ROUTE4ME_API_KEY is not configured');
  }
  return apiKey;
}

/**
 * Make an authenticated request to the Route4Me API.
 * Appends the api_key as a query parameter.
 */
async function route4meFetch(
  path: string,
  options: RequestInit = {},
  additionalParams?: Record<string, string>,
): Promise<Response> {
  const url = new URL(`${ROUTE4ME_API_BASE}${path}`);
  url.searchParams.set('api_key', getApiKey());

  if (additionalParams) {
    for (const [key, value] of Object.entries(additionalParams)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Route4Me API error',
    );
    throw new Error(`Route4Me API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map a Route4Me route to the CrewShift unified job format.
 */
function mapRouteToJob(route: Record<string, unknown>): Record<string, unknown> {
  const parameters = (route.parameters as Record<string, unknown>) ?? {};
  const addresses = (route.addresses as Record<string, unknown>[]) ?? [];

  // Extract the stops (skip the depot, which is typically the first address)
  const stops = addresses.slice(1).map((addr) => ({
    address: addr.address as string,
    latitude: addr.lat,
    longitude: addr.lng,
    sequence: addr.sequence_no,
    time_window_start: addr.time_window_start,
    time_window_end: addr.time_window_end,
    notes: addr.notes ?? null,
  }));

  const depot = addresses[0];

  return {
    title: (parameters.route_name as string) ?? `Route ${route.route_id}`,
    start: route.route_start_time
      ? new Date((route.route_start_time as number) * 1000).toISOString()
      : null,
    end: route.route_end_time
      ? new Date((route.route_end_time as number) * 1000).toISOString()
      : null,
    location: depot ? (depot.address as string) : null,
    description: `Route with ${stops.length} stops`,
    status: (route.state as number) === 4 ? 'completed' : 'active',
    stops,
    external_ids: { route4me: (route.route_id as string) ?? '' },
    source: 'route4me',
    metadata: {
      route4me_route_id: route.route_id,
      route4me_optimization_id: route.optimization_problem_id,
      route4me_distance: route.trip_distance,
      route4me_duration: route.route_duration_sec,
      route4me_vehicle_id: parameters.vehicle_id,
      route4me_driver_id: parameters.driver_id ?? parameters.member_id,
      route4me_stops_count: stops.length,
      route4me_state: route.state,
      route4me_created: route.created_timestamp
        ? new Date((route.created_timestamp as number) * 1000).toISOString()
        : null,
    },
  };
}

// -- Adapter ------------------------------------------------------------------

class Route4MeAdapter extends BaseAdapter {
  readonly provider = 'route4me' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'Route4Me uses API key authentication. ' +
      'Configure the ROUTE4ME_API_KEY environment variable.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error(
      'Route4Me uses API key authentication. No OAuth callback flow.',
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

  // -- Sync: Route4Me -> CrewShift --------------------------------------------

  async syncJobs(
    _accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // Fetch routes with optional date filtering
    const params: Record<string, string> = {
      limit: '30',
      offset: '0',
    };

    if (lastSyncAt) {
      // Route4Me accepts Unix timestamps for date filtering
      const startDate = Math.floor(new Date(lastSyncAt).getTime() / 1000);
      params['start_date'] = String(startDate);
    }

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      params['offset'] = String(offset);

      const response = await route4meFetch('/api.v4/route.php', {}, params);
      const data = (await response.json()) as Record<string, unknown>[] | Record<string, unknown>;

      // Route4Me returns an array of routes or an object with routes
      const routes: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : (data as Record<string, unknown>).routes
          ? ((data as Record<string, unknown>).routes as Record<string, unknown>[])
          : [];

      if (routes.length === 0) {
        hasMore = false;
        break;
      }

      for (const route of routes) {
        try {
          // Fetch full route details including addresses/stops
          const detailResponse = await route4meFetch(
            '/api.v4/route.php',
            {},
            { route_id: route.route_id as string },
          );
          const fullRoute = (await detailResponse.json()) as Record<string, unknown>;

          const mapped = mapRouteToJob(fullRoute);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: route, error: (err as Error).message });
        }
      }

      if (routes.length < 30) {
        hasMore = false;
      } else {
        offset += 30;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Route4Me route sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * Route4Me does not have a standard webhook signature verification mechanism.
   * Always returns false; rely on IP allowlisting or URL secrets instead.
   */
  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    logger.warn('Route4Me does not support webhook signature verification');
    return false;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    return {
      provider: this.provider,
      event_type: (payload.event_type as string) ?? 'unknown',
      resource_type: 'route',
      resource_id: (payload.route_id as string) ?? undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new Route4MeAdapter();
registerAdapter(adapter);
export default adapter;
