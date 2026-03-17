/**
 * Acuity Scheduling Integration Adapter
 *
 * Native (Tier 1) adapter for Acuity Scheduling (now Squarespace Scheduling).
 * Handles Basic Auth or OAuth, appointment sync, and webhooks.
 *
 * Acuity Scheduling API Reference:
 * - Auth: https://developers.acuityscheduling.com/reference/quick-start
 * - Appointments: https://developers.acuityscheduling.com/reference/list-appointments
 * - Webhooks: https://developers.acuityscheduling.com/reference/webhooks
 *
 * Key details:
 * - Primary auth is Basic Auth (user_id:api_key), OAuth also supported
 * - Pagination via max (page size) and offset
 * - No built-in webhook signature verification; use URL secret
 * - Default page size is 50 appointments per request
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

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';
const ACUITY_PAGE_SIZE = 50;

// -- Helpers ------------------------------------------------------------------

/**
 * Build Basic auth header from Acuity credentials.
 */
function getBasicAuthHeader(): string {
  const userId = env.ACUITY_USER_ID ?? '';
  const apiKey = env.ACUITY_API_KEY ?? '';
  return `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the Acuity Scheduling API.
 * Supports both Basic Auth (token = null) and OAuth Bearer token.
 */
async function acuityFetch(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${ACUITY_API_BASE}${path}`;

  const authHeader = accessToken
    ? `Bearer ${accessToken}`
    : getBasicAuthHeader();

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
      'Acuity Scheduling API error',
    );
    throw new Error(`Acuity Scheduling API error: ${response.status} - ${errorBody}`);
  }

  return response;
}

/**
 * Map an Acuity appointment to the CrewShift unified job format.
 */
function mapAppointmentToJob(appointment: Record<string, unknown>): Record<string, unknown> {
  const endTime = appointment.endTime as string | undefined;
  const datetime = appointment.datetime as string | undefined;

  return {
    title: (appointment.type as string) ?? 'Appointment',
    start: datetime ?? null,
    end: endTime ?? null,
    location: (appointment.location as string) ?? null,
    description: (appointment.notes as string) ?? null,
    status: (appointment.canceled as boolean) ? 'cancelled' : 'confirmed',
    customer: {
      first_name: (appointment.firstName as string) ?? null,
      last_name: (appointment.lastName as string) ?? null,
      email: (appointment.email as string) ?? null,
      phone: (appointment.phone as string) ?? null,
    },
    external_ids: { 'acuity-scheduling': String(appointment.id ?? '') },
    source: 'acuity-scheduling',
    metadata: {
      acuity_id: appointment.id,
      acuity_type_id: appointment.appointmentTypeID,
      acuity_type: appointment.type,
      acuity_calendar_id: appointment.calendarID,
      acuity_calendar: appointment.calendar,
      acuity_duration: appointment.duration,
      acuity_price: appointment.price,
      acuity_paid: appointment.paid,
      acuity_amount_paid: appointment.amountPaid,
      acuity_confirmation_page: appointment.confirmationPage,
      acuity_created: appointment.datetimeCreated,
    },
  };
}

// -- Adapter ------------------------------------------------------------------

class AcuitySchedulingAdapter extends BaseAdapter {
  readonly provider = 'acuity-scheduling' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'Acuity Scheduling primarily uses Basic Auth (user_id + api_key). ' +
      'Configure ACUITY_USER_ID and ACUITY_API_KEY environment variables. ' +
      'OAuth is also supported via Squarespace for embedded apps.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error(
      'Acuity Scheduling uses Basic Auth. No OAuth callback flow required. ' +
      'Use ACUITY_USER_ID and ACUITY_API_KEY for authentication.',
    );
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // Basic Auth does not expire, return a synthetic token set
    const userId = env.ACUITY_USER_ID ?? '';
    const apiKey = env.ACUITY_API_KEY ?? '';

    if (!userId || !apiKey) {
      throw new Error('ACUITY_USER_ID and ACUITY_API_KEY must be configured');
    }

    return {
      access_token: `${userId}:${apiKey}`,
      refresh_token: undefined,
      expires_at: undefined,
      scope: undefined,
    };
  }

  // -- Sync: Acuity -> CrewShift ----------------------------------------------

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let offset = 0;
    let hasMore = true;

    // Determine if using Basic Auth or Bearer token
    const isBasicAuth = accessToken.includes(':');
    const token = isBasicAuth ? null : accessToken;

    while (hasMore) {
      const params = new URLSearchParams({
        max: String(ACUITY_PAGE_SIZE),
        offset: String(offset),
      });

      if (lastSyncAt) {
        // Acuity accepts minDate in YYYY-MM-DD format
        const minDate = lastSyncAt.split('T')[0] ?? lastSyncAt;
        params.set('minDate', minDate);
      }

      const response = await acuityFetch(
        `/appointments?${params.toString()}`,
        token,
      );
      const appointments = (await response.json()) as Record<string, unknown>[];

      if (!Array.isArray(appointments) || appointments.length === 0) {
        hasMore = false;
        break;
      }

      for (const appointment of appointments) {
        try {
          const mapped = mapAppointmentToJob(appointment);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: appointment, error: (err as Error).message });
        }
      }

      if (appointments.length < ACUITY_PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += ACUITY_PAGE_SIZE;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Acuity Scheduling appointment sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Webhooks ---------------------------------------------------------------

  /**
   * Verify Acuity webhook request.
   *
   * Acuity does not provide built-in webhook signature verification.
   * Security relies on a secret token embedded in the webhook URL.
   * The signature parameter should contain the URL secret for comparison.
   */
  verifyWebhook(_payload: Buffer, signature: string): boolean {
    // Acuity does not sign webhooks. Verification relies on the webhook URL
    // containing a secret path segment. The signature parameter is expected
    // to be the secret from the URL path.
    const expectedSecret = env.ACUITY_API_KEY;
    if (!expectedSecret) {
      logger.warn('No Acuity API key configured for webhook verification');
      return false;
    }

    // Compare provided URL secret with stored API key
    if (signature.length !== expectedSecret.length) return false;

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSecret);
    if (sigBuf.length !== expectedBuf.length) return false;

    let mismatch = 0;
    for (let i = 0; i < sigBuf.length; i++) {
      mismatch |= sigBuf[i]! ^ expectedBuf[i]!;
    }
    return mismatch === 0;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Acuity webhook payload:
    // { id: <appointment_id>, action: "scheduled"|"rescheduled"|"canceled"|"changed", ... }
    const action = (payload.action as string) ?? 'unknown';
    const appointmentId = payload.id ? String(payload.id) : undefined;

    return {
      provider: this.provider,
      event_type: action,
      resource_type: 'appointment',
      resource_id: appointmentId,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new AcuitySchedulingAdapter();
registerAdapter(adapter);
export default adapter;
