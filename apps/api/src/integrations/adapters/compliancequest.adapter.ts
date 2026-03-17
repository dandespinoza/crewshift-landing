/**
 * ComplianceQuest Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for ComplianceQuest (Salesforce-based).
 * Uses Salesforce Connected App pattern for OAuth2 and SOQL queries
 * against ComplianceQuest custom objects.
 *
 * ComplianceQuest API Reference:
 * - Auth URL: https://login.salesforce.com/services/oauth2/authorize
 * - Token URL: https://login.salesforce.com/services/oauth2/token
 * - API Base: https://{instance}.salesforce.com/services/data/v59.0
 *
 * Key details:
 * - OAuth2 via Salesforce Connected App
 * - SOQL queries against ComplianceQuest custom objects
 * - NOTE: Requires active Salesforce subscription with ComplianceQuest managed package
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

const SF_AUTH_URL = 'https://login.salesforce.com/services/oauth2/authorize';
const SF_TOKEN_URL = 'https://login.salesforce.com/services/oauth2/token';
const SF_API_VERSION = 'v59.0';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.COMPLIANCEQUEST_CLIENT_ID;
  if (!id) throw new Error('COMPLIANCEQUEST_CLIENT_ID is not configured — Salesforce Connected App required');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.COMPLIANCEQUEST_CLIENT_SECRET;
  if (!secret) throw new Error('COMPLIANCEQUEST_CLIENT_SECRET is not configured — Salesforce Connected App required');
  return secret;
}

/**
 * Parse Salesforce access token format: "accessToken|instanceUrl"
 */
function parseAccessToken(accessToken: string): [string, string] {
  const pipe = accessToken.indexOf('|');
  if (pipe === -1) {
    throw new Error('ComplianceQuest adapter requires accessToken in format "token|instanceUrl"');
  }
  return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
}

/**
 * Make an authenticated request to Salesforce (ComplianceQuest).
 */
async function sfFetch(
  instanceUrl: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}${path}`;

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
    logger.error(
      { status: response.status, path, errorBody },
      'ComplianceQuest (Salesforce) API error',
    );
    throw new Error(`ComplianceQuest API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Run a SOQL query against Salesforce.
 */
async function sfQuery(
  instanceUrl: string,
  soql: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const response = await sfFetch(
    instanceUrl,
    `/query?q=${encodeURIComponent(soql)}`,
    accessToken,
  );

  const data = (await response.json()) as Record<string, unknown>;
  return (data.records as Record<string, unknown>[]) ?? [];
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ComplianceQuestAdapter extends BaseAdapter {
  readonly provider = 'compliancequest' as const;
  readonly tier = 'native' as const;

  // ── OAuth (Salesforce Connected App) ────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${SF_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const response = await fetch(SF_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: `${process.env.API_URL}/api/integrations/compliancequest/callback`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'ComplianceQuest token exchange failed');
      throw new Error(`ComplianceQuest token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;
    const instanceUrl = tokens.instance_url as string;

    return {
      // Store instanceUrl alongside the token for API calls
      access_token: `${tokens.access_token as string}|${instanceUrl}`,
      refresh_token: tokens.refresh_token as string | undefined,
      expires_at: tokens.issued_at
        ? new Date(Number(tokens.issued_at) + 7200 * 1000).toISOString() // 2-hour default
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for ComplianceQuest');
    }

    const response = await fetch(SF_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'ComplianceQuest token refresh failed');
      throw new Error(`ComplianceQuest token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;
    const instanceUrl = tokens.instance_url as string;

    return {
      access_token: `${tokens.access_token as string}|${instanceUrl}`,
      refresh_token: currentTokens.refresh_token, // Salesforce reuses refresh tokens
      expires_at: tokens.issued_at
        ? new Date(Number(tokens.issued_at) + 7200 * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: ComplianceQuest → CrewShift ───────────────────────────────────

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, instanceUrl] = parseAccessToken(accessToken);

    // Query ComplianceQuest custom objects (CQ namespace)
    let soql = 'SELECT Id, Name, cqext__Status__c, cqext__Description__c, cqext__Priority__c, cqext__Due_Date__c, CreatedDate, LastModifiedDate FROM cqext__CQ_Audit__c';
    if (lastSyncAt) {
      soql += ` WHERE LastModifiedDate > ${lastSyncAt}`;
    }
    soql += ' ORDER BY LastModifiedDate DESC LIMIT 200';

    const records_raw = await sfQuery(instanceUrl, soql, token);

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const rec of records_raw) {
      try {
        records.push({
          title: rec.Name ?? null,
          status: rec.cqext__Status__c ?? null,
          scheduled_start: rec.CreatedDate ?? null,
          scheduled_end: rec.cqext__Due_Date__c ?? null,
          external_ids: { compliancequest: String(rec.Id) },
          source: 'compliancequest',
          metadata: {
            cq_description: rec.cqext__Description__c,
            cq_priority: rec.cqext__Priority__c,
            cq_last_modified: rec.LastModifiedDate,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: rec, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: records_raw.length, created, errors: errors.length },
      'ComplianceQuest audit sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ComplianceQuestAdapter();
registerAdapter(adapter);
export default adapter;
