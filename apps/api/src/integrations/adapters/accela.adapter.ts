/**
 * Accela Integration Adapter
 *
 * Tier 3 (native) adapter for Accela — government permitting and licensing platform.
 * Handles OAuth 2.0 (CivicID) auth, permit record and contact sync.
 *
 * Accela API Reference:
 * - Auth: https://auth.accela.com/oauth2/authorize (CivicID OAuth)
 * - API: https://apis.accela.com/v4
 *
 * Key details:
 * - Developer application approval required
 * - OAuth 2.0 via CivicID identity provider
 * - Requires agency identifier in API requests
 * - syncJobs pulls /records for permit records
 * - syncCustomers pulls /contacts
 * - No webhook support
 * - Env: ACCELA_CLIENT_ID, ACCELA_CLIENT_SECRET, ACCELA_AGENCY
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

const AUTH_URL = 'https://auth.accela.com/oauth2/authorize';
const TOKEN_URL = 'https://auth.accela.com/oauth2/token';
const API_BASE = 'https://apis.accela.com/v4';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.ACCELA_CLIENT_ID ?? (env as Record<string, unknown>).ACCELA_CLIENT_ID as string | undefined;
  if (!id) throw new Error('ACCELA_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.ACCELA_CLIENT_SECRET ?? (env as Record<string, unknown>).ACCELA_CLIENT_SECRET as string | undefined;
  if (!secret) throw new Error('ACCELA_CLIENT_SECRET is not configured');
  return secret;
}

function getAgency(): string {
  const agency = process.env.ACCELA_AGENCY ?? (env as Record<string, unknown>).ACCELA_AGENCY as string | undefined;
  if (!agency) throw new Error('ACCELA_AGENCY is not configured');
  return agency;
}

/**
 * Make an authenticated request to the Accela API.
 * Includes the x-accela-agency header required by Accela endpoints.
 */
async function accelaFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `${accessToken}`,
      'x-accela-appid': getClientId(),
      'x-accela-agency': getAgency(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Accela API error',
    );
    throw new Error(`Accela API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Accela list endpoints using offset-based pagination.
 */
async function accelaPaginateAll(
  path: string,
  accessToken: string,
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

    const response = await accelaFetch(
      `${path}?${searchParams.toString()}`,
      accessToken,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.result as Record<string, unknown>[]) ?? [];

    results.push(...items);

    const page = data.page as Record<string, unknown> | undefined;
    const hasNextPage = page?.hasmore as boolean | undefined;
    hasMore = hasNextPage ?? items.length === DEFAULT_PAGE_SIZE;
    offset += DEFAULT_PAGE_SIZE;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class AccelaAdapter extends BaseAdapter {
  readonly provider = 'accela' as const;
  readonly tier = 'native' as const;

  // ── OAuth (CivicID) ────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      agency_name: getAgency(),
      environment: env.NODE_ENV === 'production' ? 'PROD' : 'TEST',
      state: orgId,
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${env.API_URL}/api/integrations/accela/callback`,
        agency_name: getAgency(),
        environment: env.NODE_ENV === 'production' ? 'PROD' : 'TEST',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Accela token exchange failed');
      throw new Error(`Accela token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Accela');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
        agency_name: getAgency(),
        environment: env.NODE_ENV === 'production' ? 'PROD' : 'TEST',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Accela token refresh failed');
      throw new Error(`Accela token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Accela → CrewShift ───────────────────────────────────────────

  /**
   * Sync permit records from Accela as jobs.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records_raw = await accelaPaginateAll('/records', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const record of records_raw) {
      try {
        const mapped = this.mapRecord(record);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: record, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: records_raw.length, created, errors: errors.length },
      'Accela permit record sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  /**
   * Sync contacts from Accela as customers.
   */
  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const contacts = await accelaPaginateAll('/contacts', accessToken);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const contact of contacts) {
      try {
        const mapped = this.mapContact(contact);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: contacts.length, created, errors: errors.length },
      'Accela contact sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class no-op implementations are sufficient — Accela does not support webhooks.

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map an Accela Record (permit) to CrewShift's unified job format.
   */
  private mapRecord(record: Record<string, unknown>): Record<string, unknown> {
    const type = record.type as Record<string, unknown> | undefined;
    const status = record.status as Record<string, unknown> | undefined;
    const address = record.address as Record<string, unknown> | undefined;

    return {
      title: (record.customId as string) ?? (record.name as string) ?? null,
      description: (record.description as string) ?? (type?.text as string) ?? null,
      status: (status?.text as string) ?? (record.status as string) ?? 'unknown',
      type: 'permit',
      external_ids: { accela: String(record.id) },
      source: 'accela',
      metadata: {
        accela_custom_id: record.customId,
        accela_module: record.module,
        accela_type: type ? `${type.type ?? ''}/${type.subType ?? ''}/${type.category ?? ''}` : null,
        accela_status: status?.text ?? record.status,
        accela_opened_date: record.openedDate,
        accela_closed_date: record.closedDate,
        accela_address: address
          ? `${address.streetStart ?? ''} ${address.streetName ?? ''}, ${address.city ?? ''} ${address.state ?? ''} ${address.postalCode ?? ''}`.trim()
          : null,
        accela_agency: getAgency(),
      },
    };
  }

  /**
   * Map an Accela Contact to CrewShift's unified customer format.
   */
  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    const address = contact.address as Record<string, unknown> | undefined;

    return {
      name: (`${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim()
        || (contact.organizationName as string)
        || (contact.fullName as string))
        ?? null,
      company_name: (contact.organizationName as string) ?? (contact.businessName as string) ?? null,
      email: (contact.email as string) ?? null,
      phone: (contact.phone1 as string) ?? (contact.phone as string) ?? null,
      address: address
        ? {
            street: `${address.streetStart ?? ''} ${address.streetName ?? ''}`.trim(),
            city: (address.city as string) ?? '',
            state: (address.state as string) ?? '',
            zip: (address.postalCode as string) ?? '',
          }
        : null,
      external_ids: { accela: String(contact.id) },
      source: 'accela',
      metadata: {
        accela_type: contact.type,
        accela_status: contact.status,
        accela_relation: contact.relation,
        accela_agency: getAgency(),
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new AccelaAdapter();
registerAdapter(adapter);
export default adapter;
