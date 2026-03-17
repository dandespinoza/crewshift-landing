/**
 * Proposify Integration Adapter
 *
 * Native (Tier 1) adapter for Proposify proposal management.
 * Handles OAuth2 and proposal sync.
 *
 * Proposify API Reference:
 * - Auth: https://app.proposify.com/oauth/authorize
 * - API: https://api.proposify.com/v1
 *
 * Key details:
 * - OAuth 2.0 authorization code flow
 * - Proposal-focused integration (syncs proposals as jobs)
 * - No webhook support
 * - Business plan + CS enablement required
 */

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

const AUTH_URL = 'https://app.proposify.com/oauth/authorize';
const TOKEN_URL = 'https://app.proposify.com/oauth/token';
const API_BASE = 'https://api.proposify.com/v1';
const DEFAULT_PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.PROPOSIFY_CLIENT_ID ?? env.PROPOSIFY_CLIENT_ID;
  if (!id) throw new Error('PROPOSIFY_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.PROPOSIFY_CLIENT_SECRET ?? env.PROPOSIFY_CLIENT_SECRET;
  if (!secret) throw new Error('PROPOSIFY_CLIENT_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Proposify API.
 */
async function proposifyFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

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
      'Proposify API error',
    );
    throw new Error(`Proposify API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Proposify list endpoint.
 */
async function proposifyFetchAllPages(
  path: string,
  accessToken: string,
  resultKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}page=${page}&per_page=${DEFAULT_PAGE_SIZE}`;

    const response = await proposifyFetch(pagedPath, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[resultKey] as Array<Record<string, unknown>>) ?? (data.data as Array<Record<string, unknown>>) ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    results.push(...items);

    const meta = data.meta as Record<string, unknown> | undefined;
    const totalPages = meta?.total_pages as number | undefined;
    const lastPage = meta?.last_page as number | undefined;
    const maxPage = totalPages ?? lastPage;

    if (maxPage && page < maxPage) {
      page++;
    } else if (!maxPage && items.length === DEFAULT_PAGE_SIZE) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ProposifyAdapter extends BaseAdapter {
  readonly provider = 'proposify' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = `${env.API_URL}/api/integrations/proposify/callback`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Proposify token exchange failed');
      throw new Error(`Proposify token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Proposify');
    }

    const clientId = getClientId();
    const clientSecret = getClientSecret();

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Proposify token refresh failed');
      throw new Error(`Proposify token refresh failed: ${response.status}`);
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

  // ── Sync: Proposify → CrewShift ───────────────────────────────────────

  // Note: Proposify is proposal-focused. syncCustomers and syncInvoices use base class defaults (no-op).

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const proposals = await proposifyFetchAllPages('/proposals', accessToken, 'proposals');

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const proposal of proposals) {
      try {
        const client = proposal.client as Record<string, unknown> | undefined;
        const fees = (proposal.fees as Array<Record<string, unknown>>) ?? [];
        const totalAmount = fees.reduce((sum, fee) => {
          return sum + ((fee.amount as number) ?? (fee.total as number) ?? 0);
        }, 0);

        records.push({
          title: (proposal.name as string) ?? `Proposal ${proposal.id}`,
          status: this.mapProposalStatus(proposal.status as string),
          type: 'proposal',
          customer_external_id: client?.id ? String(client.id) : null,
          external_ids: { proposify: String(proposal.id) },
          source: 'proposify',
          metadata: {
            proposify_status: proposal.status,
            proposify_stream_id: proposal.stream_id,
            proposify_client_name: client?.name,
            proposify_client_email: client?.email,
            proposify_total_amount: totalAmount,
            proposify_currency: proposal.currency,
            proposify_created_at: proposal.created_at,
            proposify_updated_at: proposal.updated_at,
            proposify_sent_at: proposal.sent_at,
            proposify_won_at: proposal.won_at,
            proposify_lost_at: proposal.lost_at,
            proposify_fees: fees.map((fee) => ({
              name: fee.name,
              amount: fee.amount ?? fee.total,
              quantity: fee.quantity,
            })),
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: proposal, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: proposals.length, created, errors: errors.length },
      'Proposify proposal sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ─────────────────────────────────────────────

  // Proposify does not support webhooks. The base class defaults apply:
  // verifyWebhook returns false, processWebhook throws.

  // ── Private Helpers ──────────────────────────────────────────────────────

  private mapProposalStatus(status: string | undefined): string {
    switch (status?.toLowerCase()) {
      case 'draft':
        return 'draft';
      case 'sent':
      case 'active':
      case 'viewed':
        return 'sent';
      case 'won':
      case 'accepted':
        return 'accepted';
      case 'lost':
      case 'declined':
        return 'declined';
      case 'expired':
        return 'expired';
      default:
        return 'draft';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ProposifyAdapter();
registerAdapter(adapter);
export default adapter;
