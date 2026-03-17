/**
 * DocuSign Integration Adapter
 *
 * Tier 2 adapter for DocuSign.
 * Handles OAuth2, envelope (job) sync, and DocuSign Connect webhooks.
 *
 * DocuSign API Reference:
 * - Auth: https://developers.docusign.com/platform/auth/
 * - Envelopes: https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/
 * - Connect (Webhooks): https://developers.docusign.com/docs/connect/
 *
 * Key details:
 * - OAuth2 authorization code flow
 * - Demo vs production base URIs; base_uri retrieved from /oauth/userinfo
 * - Envelopes synced via GET /envelopes with from_date filter
 * - Webhook verification: HMAC-SHA256 via x-docusign-signature-1 header
 * - Rate limit: 3,000 requests per hour
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

const DS_AUTH_URL_DEMO = 'https://account-d.docusign.com/oauth/auth';
const DS_AUTH_URL_PROD = 'https://account.docusign.com/oauth/auth';
const DS_TOKEN_URL_DEMO = 'https://account-d.docusign.com/oauth/token';
const DS_TOKEN_URL_PROD = 'https://account.docusign.com/oauth/token';
const DS_USERINFO_URL_DEMO = 'https://account-d.docusign.com/oauth/userinfo';
const DS_USERINFO_URL_PROD = 'https://account.docusign.com/oauth/userinfo';
const DS_API_BASE_DEMO = 'https://demo.docusign.net/restapi/v2.1';
const DS_SCOPES = 'signature impersonation';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isDemo(): boolean {
  return env.NODE_ENV !== 'production';
}

function getAuthUrl(): string {
  return isDemo() ? DS_AUTH_URL_DEMO : DS_AUTH_URL_PROD;
}

function getTokenUrl(): string {
  return isDemo() ? DS_TOKEN_URL_DEMO : DS_TOKEN_URL_PROD;
}

function getUserInfoUrl(): string {
  return isDemo() ? DS_USERINFO_URL_DEMO : DS_USERINFO_URL_PROD;
}

function getClientId(): string {
  const id = process.env.DOCUSIGN_CLIENT_ID ?? env.DOCUSIGN_CLIENT_ID;
  if (!id) throw new Error('DOCUSIGN_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.DOCUSIGN_CLIENT_SECRET ?? env.DOCUSIGN_CLIENT_SECRET;
  if (!secret) throw new Error('DOCUSIGN_CLIENT_SECRET is not configured');
  return secret;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64')}`;
}

/**
 * Make an authenticated request to the DocuSign API.
 */
async function dsFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, url, errorBody }, 'DocuSign API error');
    throw new Error(`DocuSign API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Get the user's base URI and account ID from DocuSign /oauth/userinfo.
 */
async function getUserInfo(accessToken: string): Promise<{ baseUri: string; accountId: string }> {
  const url = getUserInfoUrl();
  const response = await dsFetch(url, accessToken);
  const data = (await response.json()) as Record<string, unknown>;

  const accounts = (data.accounts as Array<Record<string, unknown>>) ?? [];
  // Use the default account
  const defaultAccount = accounts.find((a) => a.is_default === true) ?? accounts[0];

  if (!defaultAccount) {
    throw new Error('No DocuSign accounts found for user');
  }

  return {
    baseUri: (defaultAccount.base_uri as string) ?? DS_API_BASE_DEMO,
    accountId: defaultAccount.account_id as string,
  };
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class DocuSignAdapter extends BaseAdapter {
  readonly provider = 'docusign' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DS_SCOPES,
      state: orgId,
    });

    return `${getAuthUrl()}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const redirectUri = `${env.API_URL}/api/integrations/docusign/callback`;

    const response = await fetch(getTokenUrl(), {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'DocuSign token exchange failed');
      throw new Error(`DocuSign token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for DocuSign');
    }

    const response = await fetch(getTokenUrl(), {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'DocuSign token refresh failed');
      throw new Error(`DocuSign token refresh failed: ${response.status}`);
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

  // ── Sync: DocuSign → CrewShift ────────────────────────────────────────────

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const { baseUri, accountId } = await getUserInfo(accessToken);
    const apiBase = `${baseUri}/restapi/v2.1/accounts/${accountId}`;

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let startPosition = 0;
    let hasMore = true;

    // DocuSign requires from_date; default to 30 days ago
    const fromDate = lastSyncAt ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    while (hasMore) {
      const params = new URLSearchParams({
        from_date: fromDate,
        count: String(DEFAULT_PAGE_SIZE),
        start_position: String(startPosition),
        order: 'desc',
        order_by: 'last_modified',
      });

      const response = await dsFetch(
        `${apiBase}/envelopes?${params.toString()}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const envelopes = (data.envelopes as Record<string, unknown>[]) ?? [];

      for (const envelope of envelopes) {
        try {
          records.push(this.mapDocuSignEnvelope(envelope));
          created++;
        } catch (err) {
          errors.push({ item: envelope, error: (err as Error).message });
        }
      }

      const totalSetSize = parseInt((data.totalSetSize as string) ?? '0', 10);
      startPosition += DEFAULT_PAGE_SIZE;

      if (startPosition >= totalSetSize || envelopes.length === 0) {
        hasMore = false;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'DocuSign envelope sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    // DocuSign Connect uses HMAC-SHA256 with the secret key
    // Signature comes in x-docusign-signature-1 header
    const secret = getClientSecret();

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // DocuSign Connect notification: { event, apiVersion, uri, configurationId, data: { accountId, envelopeId, ... } }
    const event = (payload.event as string) ?? 'unknown';
    const data = payload.data as Record<string, unknown> | undefined;
    const envelopeSummary = data?.envelopeSummary as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: event,
      resource_type: 'envelope',
      resource_id: (envelopeSummary?.envelopeId as string) ?? (data?.envelopeId as string) ?? undefined,
      data: payload,
      timestamp: (envelopeSummary?.statusChangedDateTime as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private mapDocuSignEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
    return {
      title: (envelope.emailSubject as string) ?? 'Untitled Envelope',
      status: ((envelope.status as string) ?? 'unknown').toLowerCase(),
      description: (envelope.emailBlurb as string) ?? null,
      start: (envelope.sentDateTime as string) ?? (envelope.createdDateTime as string) ?? null,
      end: (envelope.completedDateTime as string) ?? (envelope.voidedDateTime as string) ?? null,
      external_ids: { docusign: String(envelope.envelopeId) },
      source: 'docusign',
      metadata: {
        ds_envelope_id: envelope.envelopeId,
        ds_status: envelope.status,
        ds_created: envelope.createdDateTime,
        ds_sent: envelope.sentDateTime,
        ds_delivered: envelope.deliveredDateTime,
        ds_completed: envelope.completedDateTime,
        ds_voided: envelope.voidedDateTime,
        ds_status_changed: envelope.statusChangedDateTime,
        ds_sender: envelope.sender,
        ds_recipients_uri: envelope.recipientsUri,
        ds_documents_uri: envelope.documentsUri,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new DocuSignAdapter();
registerAdapter(adapter);
export default adapter;
