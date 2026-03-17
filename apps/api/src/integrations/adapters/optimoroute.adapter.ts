/**
 * OptimoRoute Integration Adapter
 *
 * Native (Tier 1) adapter for OptimoRoute delivery/service route optimization.
 * Handles API key auth and order sync.
 *
 * OptimoRoute API Reference:
 * - Auth: https://optimoroute.com/api/#authentication
 * - Orders: https://optimoroute.com/api/#get-orders
 * - Completion: https://optimoroute.com/api/#get-completion-details
 *
 * Key details:
 * - Authentication via API key in query parameter (key=...)
 * - Orders are fetched via POST /get_orders with date filtering
 * - No webhook support; polling-based sync only
 * - Supports bulk order operations
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

const OPTIMOROUTE_API_BASE = 'https://api.optimoroute.com/v1';

// -- Helpers ------------------------------------------------------------------

/**
 * Get the OptimoRoute API key from env.
 */
function getApiKey(): string {
  const apiKey = env.OPTIMOROUTE_API_KEY;
  if (!apiKey) {
    throw new Error('OPTIMOROUTE_API_KEY is not configured');
  }
  return apiKey;
}

/**
 * Make an authenticated request to the OptimoRoute API.
 * Appends the key as a query parameter.
 */
async function optimoFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = new URL(`${OPTIMOROUTE_API_BASE}${path}`);
  url.searchParams.set('key', getApiKey());

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
      'OptimoRoute API error',
    );
    throw new Error(`OptimoRoute API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map an OptimoRoute order to the CrewShift unified job format.
 */
function mapOrderToJob(order: Record<string, unknown>): Record<string, unknown> {
  const location = (order.location as Record<string, unknown>) ?? {};
  const scheduling = (order.scheduling as Record<string, unknown>) ?? {};
  const duration = (order.duration as number) ?? 0;

  // Calculate estimated end time if start time and duration are available
  const scheduledAt = (scheduling.scheduledAt as string) ?? null;
  let endTime: string | null = null;
  if (scheduledAt && duration > 0) {
    const start = new Date(scheduledAt);
    start.setMinutes(start.getMinutes() + duration);
    endTime = start.toISOString();
  }

  return {
    title: (order.orderNo as string) ?? 'Untitled Order',
    start: scheduledAt,
    end: endTime,
    location: (location.address as string) ?? null,
    description: (order.notes as string) ?? null,
    status: mapOptimoStatus(order),
    customer: {
      name: (location.locationName as string) ?? null,
    },
    external_ids: { optimoroute: (order.orderNo as string) ?? '' },
    source: 'optimoroute',
    metadata: {
      optimo_order_no: order.orderNo,
      optimo_date: order.date,
      optimo_duration: duration,
      optimo_priority: order.priority,
      optimo_type: order.type,
      optimo_skills: order.skills,
      optimo_driver: scheduling.driverSerial ?? scheduling.driverName,
      optimo_vehicle: scheduling.vehicleSerial,
      optimo_location: {
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.locationName,
      },
      optimo_load: order.load,
      optimo_service_time: order.serviceTime,
    },
  };
}

/**
 * Map OptimoRoute order status to a normalized status string.
 */
function mapOptimoStatus(order: Record<string, unknown>): string {
  const scheduling = (order.scheduling as Record<string, unknown>) ?? {};

  if (scheduling.scheduledAt) {
    if (order.completedAt) return 'completed';
    return 'scheduled';
  }

  return 'pending';
}

// -- Adapter ------------------------------------------------------------------

class OptimoRouteAdapter extends BaseAdapter {
  readonly provider = 'optimoroute' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'OptimoRoute uses API key authentication. ' +
      'Configure the OPTIMOROUTE_API_KEY environment variable.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error(
      'OptimoRoute uses API key authentication. No OAuth callback flow.',
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

  // -- Sync: OptimoRoute -> CrewShift -----------------------------------------

  async syncJobs(
    _accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    // Determine date range for sync
    const endDate = new Date().toISOString().split('T')[0]!;
    let startDate: string;

    if (lastSyncAt) {
      startDate = lastSyncAt.split('T')[0] ?? lastSyncAt;
    } else {
      // Default: sync orders from the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      startDate = thirtyDaysAgo.toISOString().split('T')[0]!;
    }

    let afterTag: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const requestBody: Record<string, unknown> = {
        dateRange: {
          from: startDate,
          to: endDate,
        },
      };

      if (afterTag) {
        requestBody.afterTag = afterTag;
      }

      const response = await optimoFetch('/get_orders', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      const data = (await response.json()) as Record<string, unknown>;
      const orders = (data.orders as Record<string, unknown>[]) ?? [];

      for (const order of orders) {
        try {
          const mapped = mapOrderToJob(order);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: order, error: (err as Error).message });
        }
      }

      // OptimoRoute uses afterTag for pagination
      afterTag = data.afterTag as string | undefined;
      if (!afterTag || orders.length === 0) {
        hasMore = false;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'OptimoRoute order sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * OptimoRoute does not support webhooks.
   * Always returns false.
   */
  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    logger.warn('OptimoRoute does not support webhooks');
    return false;
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new OptimoRouteAdapter();
registerAdapter(adapter);
export default adapter;
