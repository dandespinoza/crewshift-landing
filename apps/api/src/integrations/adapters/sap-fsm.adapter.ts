/**
 * SAP Field Service Management (FSM) Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for SAP FSM (formerly Coresystems).
 * Handles OAuth2 client_credentials, customer (BusinessPartner) sync,
 * and service activity (work order) sync via OData v4.
 *
 * SAP FSM API Reference:
 * - Auth: https://{cluster}.coresystems.net/api/oauth2/v1/token
 * - Data API: https://{cluster}.coresuite.com/api/data/v4
 * - SDK: https://github.com/SAP/fsm-sdk
 *
 * Key details:
 * - OAuth2 client_credentials grant
 * - OData v4 API with $top/$skip pagination
 * - Cluster-specific endpoints
 * - Requires account_id and company_id headers
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

const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.SAP_FSM_CLIENT_ID;
  if (!id) throw new Error('SAP_FSM_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.SAP_FSM_CLIENT_SECRET;
  if (!secret) throw new Error('SAP_FSM_CLIENT_SECRET is not configured');
  return secret;
}

function getCluster(): string {
  const cluster = process.env.SAP_FSM_CLUSTER;
  if (!cluster) throw new Error('SAP_FSM_CLUSTER is not configured (e.g., "eu", "us", "de", "cn")');
  return cluster;
}

function getAccountId(): string {
  const id = process.env.SAP_FSM_ACCOUNT_ID;
  if (!id) throw new Error('SAP_FSM_ACCOUNT_ID is not configured');
  return id;
}

function getCompanyId(): string {
  const id = process.env.SAP_FSM_COMPANY_ID;
  if (!id) throw new Error('SAP_FSM_COMPANY_ID is not configured');
  return id;
}

function getTokenUrl(): string {
  return `https://${getCluster()}.coresystems.net/api/oauth2/v1/token`;
}

function getApiBase(): string {
  return `https://${getCluster()}.coresuite.com/api/data/v4`;
}

/**
 * Make an authenticated request to the SAP FSM Data API.
 */
async function fsmFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBase()}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Client-ID': getClientId(),
      'X-Client-Version': '1.0',
      'X-Account-ID': getAccountId(),
      'X-Company-ID': getCompanyId(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'SAP FSM API error',
    );
    throw new Error(`SAP FSM API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through an SAP FSM OData endpoint using $top/$skip.
 */
async function fsmPaginateAll(
  entity: string,
  accessToken: string,
  filter?: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    let path = `/${entity}?$top=${DEFAULT_PAGE_SIZE}&$skip=${skip}`;
    if (filter) {
      path += `&$filter=${encodeURIComponent(filter)}`;
    }

    const response = await fsmFetch(path, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.value as Record<string, unknown>[]) ?? [];

    results.push(...items);

    if (items.length < DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += DEFAULT_PAGE_SIZE;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SapFsmAdapter extends BaseAdapter {
  readonly provider = 'sap-fsm' as const;
  readonly tier = 'native' as const;

  // ── OAuth (client_credentials) ──────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'SAP FSM uses client_credentials grant, not authorization_code. Call handleCallback() to obtain a token.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(getTokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: getClientId(),
        client_secret: getClientSecret(),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'SAP FSM token exchange failed');
      throw new Error(`SAP FSM token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: undefined,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // client_credentials grant: just request a new token
    return this.handleCallback('', '');
  }

  // ── Sync: SAP FSM → CrewShift ──────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const filter = lastSyncAt
      ? `lastChanged gt ${lastSyncAt}`
      : undefined;

    const partners = await fsmPaginateAll('BusinessPartner', accessToken, filter);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const bp of partners) {
      try {
        records.push({
          name: bp.name ?? (`${bp.firstName ?? ''} ${bp.lastName ?? ''}`.trim() || null),
          company_name: bp.companyName ?? null,
          email: bp.emailAddress ?? null,
          phone: bp.phone ?? null,
          address: bp.address
            ? {
                street: (bp.address as Record<string, unknown>).streetName ?? '',
                city: (bp.address as Record<string, unknown>).city ?? '',
                state: (bp.address as Record<string, unknown>).region ?? '',
                zip: (bp.address as Record<string, unknown>).postalCode ?? '',
              }
            : null,
          external_ids: { 'sap-fsm': String(bp.id) },
          source: 'sap-fsm',
          metadata: {
            fsm_code: bp.code,
            fsm_type: bp.type,
            fsm_status: bp.status,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: bp, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: partners.length, created, errors: errors.length },
      'SAP FSM BusinessPartner sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const filter = lastSyncAt
      ? `lastChanged gt ${lastSyncAt}`
      : undefined;

    const activities = await fsmPaginateAll('Activity', accessToken, filter);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const act of activities) {
      try {
        records.push({
          title: act.subject ?? act.code ?? null,
          status: act.status ?? null,
          scheduled_start: act.startDateTime ?? null,
          scheduled_end: act.endDateTime ?? null,
          customer_external_id: act.businessPartnerId ? String(act.businessPartnerId) : null,
          external_ids: { 'sap-fsm': String(act.id) },
          source: 'sap-fsm',
          metadata: {
            fsm_code: act.code,
            fsm_type: act.type,
            fsm_priority: act.priority,
            fsm_equipment_id: act.equipmentId,
            fsm_service_assignment: act.serviceAssignmentId,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: act, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: activities.length, created, errors: errors.length },
      'SAP FSM Activity sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SapFsmAdapter();
registerAdapter(adapter);
export default adapter;
