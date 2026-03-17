/**
 * Hatch Integration Adapter
 *
 * Tier 3 (native) adapter for Hatch — automated customer communication platform.
 * Handles API Key auth (POST-based), contact and campaign sync.
 *
 * Hatch API Reference:
 * - API Base: https://api.usehatchapp.com/api/v1
 * - Auth: API Key via X-Api-Key header or POST body
 *
 * Key details:
 * - Developer application approval required
 * - No OAuth flow — API Key authentication only
 * - API key sent in X-Api-Key header
 * - syncCustomers pulls /contacts
 * - syncJobs pulls /campaigns
 * - No webhook support
 * - Env: HATCH_API_KEY
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

const API_BASE = 'https://api.usehatchapp.com/api/v1';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.HATCH_API_KEY ?? (env as Record<string, unknown>).HATCH_API_KEY as string | undefined;
  if (!key) throw new Error('HATCH_API_KEY is not configured');
  return key;
}

/**
 * Make an authenticated request to the Hatch API.
 * Auth is via X-Api-Key header.
 */
async function hatchFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Api-Key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Hatch API error',
    );
    throw new Error(`Hatch API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through Hatch list endpoints using offset-based pagination.
 */
async function hatchPaginateAll(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const searchParams = new URLSearchParams({
      per_page: String(DEFAULT_PAGE_SIZE),
      page: String(page),
      ...params,
    });

    const response = await hatchFetch(
      `${path}?${searchParams.toString()}`,
      apiKey,
    );
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.data as Record<string, unknown>[]) ?? (data.contacts as Record<string, unknown>[]) ?? [];

    results.push(...items);

    hasMore = items.length === DEFAULT_PAGE_SIZE;
    page++;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class HatchAdapter extends BaseAdapter {
  readonly provider = 'hatch' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API Key auth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Hatch uses API Key authentication, not OAuth. Configure HATCH_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Hatch uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Hatch uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Hatch → CrewShift ────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const contacts = await hatchPaginateAll('/contacts', apiKey);

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
      'Hatch contact sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();
    const campaigns = await hatchPaginateAll('/campaigns', apiKey);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const campaign of campaigns) {
      try {
        const mapped = this.mapCampaign(campaign);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: campaign, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: campaigns.length, created, errors: errors.length },
      'Hatch campaign sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class no-op implementations are sufficient — Hatch does not support webhooks.

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Hatch Contact to CrewShift's unified customer format.
   */
  private mapContact(contact: Record<string, unknown>): Record<string, unknown> {
    return {
      name: (`${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || (contact.name as string)) ?? null,
      company_name: (contact.company as string) ?? null,
      email: (contact.email as string) ?? null,
      phone: (contact.phone as string) ?? (contact.phone_number as string) ?? null,
      address: contact.address
        ? {
            street: (contact.address as Record<string, unknown>).street ?? '',
            city: (contact.address as Record<string, unknown>).city ?? '',
            state: (contact.address as Record<string, unknown>).state ?? '',
            zip: (contact.address as Record<string, unknown>).zip ?? '',
          }
        : null,
      external_ids: { hatch: String(contact.id) },
      source: 'hatch',
      metadata: {
        hatch_status: contact.status,
        hatch_tags: contact.tags ?? [],
        hatch_created_at: contact.created_at,
        hatch_updated_at: contact.updated_at,
      },
    };
  }

  /**
   * Map a Hatch Campaign to CrewShift's unified job format.
   */
  private mapCampaign(campaign: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (campaign.name as string) ?? (campaign.title as string) ?? null,
      description: (campaign.description as string) ?? null,
      status: (campaign.status as string) ?? 'unknown',
      external_ids: { hatch: String(campaign.id) },
      source: 'hatch',
      metadata: {
        hatch_campaign_type: campaign.type ?? campaign.campaign_type,
        hatch_channel: campaign.channel,
        hatch_active: campaign.active,
        hatch_created_at: campaign.created_at,
        hatch_updated_at: campaign.updated_at,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new HatchAdapter();
registerAdapter(adapter);
export default adapter;
