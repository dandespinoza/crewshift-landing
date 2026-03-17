/**
 * SurveyMonkey Integration Adapter
 *
 * Native (Tier 1) adapter for SurveyMonkey.
 * Handles OAuth 2.0 authentication, survey listing, response syncing, and webhooks.
 *
 * SurveyMonkey API Reference:
 * - OAuth: https://developer.surveymonkey.com/api/v3/#authentication
 * - Surveys: https://developer.surveymonkey.com/api/v3/#surveys
 * - Responses: https://developer.surveymonkey.com/api/v3/#survey-responses
 * - Webhooks: https://developer.surveymonkey.com/api/v3/#webhooks
 *
 * Key details:
 * - OAuth 2.0 with authorization_code grant (tokens do not expire by default)
 * - Also supports Personal Access Tokens (PAT)
 * - Rate limit: 120 requests/minute
 * - Pagination via page/per_page query params
 * - No built-in webhook signature verification
 * - Env: SURVEYMONKEY_CLIENT_ID, SURVEYMONKEY_CLIENT_SECRET
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

const AUTH_URL = 'https://api.surveymonkey.com/oauth/authorize';
const TOKEN_URL = 'https://api.surveymonkey.com/oauth/token';
const API_BASE = 'https://api.surveymonkey.com/v3';
const DEFAULT_PER_PAGE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const clientId = process.env.SURVEYMONKEY_CLIENT_ID ?? (env as Record<string, unknown>).SURVEYMONKEY_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('SURVEYMONKEY_CLIENT_ID is not configured');
  return clientId;
}

function getClientSecret(): string {
  const clientSecret = process.env.SURVEYMONKEY_CLIENT_SECRET ?? (env as Record<string, unknown>).SURVEYMONKEY_CLIENT_SECRET as string | undefined;
  if (!clientSecret) throw new Error('SURVEYMONKEY_CLIENT_SECRET is not configured');
  return clientSecret;
}

/**
 * Make an authenticated request to the SurveyMonkey API.
 */
async function surveyMonkeyFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

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
      'SurveyMonkey API error',
    );
    throw new Error(`SurveyMonkey API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a SurveyMonkey list endpoint.
 */
async function surveyMonkeyPaginateAll(
  path: string,
  accessToken: string,
  dataKey: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${path}${separator}page=${page}&per_page=${DEFAULT_PER_PAGE}`;

    const response = await surveyMonkeyFetch(url, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data[dataKey] as Record<string, unknown>[]) ?? [];

    results.push(...items);

    // SurveyMonkey returns total and per_page for pagination
    const total = data.total as number | undefined;
    if (total && results.length < total) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SurveyMonkeyAdapter extends BaseAdapter {
  readonly provider = 'surveymonkey' as const;
  readonly tier = 'native' as const;

  // ── OAuth ─────────────────────────────────────────────────────────────

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
    const redirectUri = `${env.API_URL}/api/integrations/surveymonkey/callback`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, errorBody },
        'SurveyMonkey token exchange failed',
      );
      throw new Error(`SurveyMonkey token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      // SurveyMonkey tokens do not expire by default
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error("SurveyMonkey tokens don't expire — no refresh is needed.");
  }

  // ── Sync: SurveyMonkey → CrewShift ────────────────────────────────────

  /**
   * Sync surveys and their responses from SurveyMonkey.
   *
   * Retrieves all surveys, then fetches responses for each survey.
   * Maps each survey+responses combination into a unified job record.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    try {
      // Step 1: Get all surveys
      const surveys = await surveyMonkeyPaginateAll('/surveys', accessToken, 'data');

      for (const survey of surveys) {
        try {
          const surveyId = survey.id as string;

          // Step 2: Get responses for each survey (bulk endpoint)
          let responses: Record<string, unknown>[] = [];
          try {
            responses = await surveyMonkeyPaginateAll(
              `/surveys/${surveyId}/responses/bulk`,
              accessToken,
              'data',
            );
          } catch (err) {
            // Some surveys may have no responses; that is acceptable
            logger.debug(
              { surveyId, error: (err as Error).message },
              'No responses for survey or responses fetch failed',
            );
          }

          const mapped = this.mapSurvey(survey, responses);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: survey, error: (err as Error).message });
        }
      }

      logger.info(
        { provider: this.provider, total: surveys.length, created, errors: errors.length },
        'SurveyMonkey sync complete',
      );
    } catch (err) {
      logger.error(
        { provider: this.provider, error: (err as Error).message },
        'SurveyMonkey survey list failed',
      );
      errors.push({ item: {}, error: (err as Error).message });
    }

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ──────────────────────────────────────────────────────────

  /**
   * SurveyMonkey does not provide built-in webhook signature verification.
   * Always returns true to allow processing; use allowlisting of source IPs
   * or other network-level controls to secure the webhook endpoint.
   */
  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    logger.warn('SurveyMonkey does not support webhook signature verification');
    return true;
  }

  /**
   * Parse a SurveyMonkey webhook payload into a normalized WebhookEvent.
   *
   * SurveyMonkey webhook payload structure:
   * {
   *   event_type: "response_completed" | "response_updated" | ...,
   *   object_type: "survey" | "response" | ...,
   *   object_id: "survey_id",
   *   resources: { survey_id, response_id, ... }
   * }
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event_type as string) ?? 'unknown';
    const objectType = (payload.object_type as string) ?? 'unknown';
    const objectId = (payload.object_id as string) ?? undefined;
    const resources = payload.resources as Record<string, unknown> | undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: objectType,
      resource_id: objectId,
      data: {
        event_type: eventType,
        object_type: objectType,
        object_id: objectId,
        resources: resources ?? {},
        raw: payload,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Map a SurveyMonkey survey and its responses to CrewShift's unified format.
   */
  private mapSurvey(
    survey: Record<string, unknown>,
    responses: Record<string, unknown>[],
  ): Record<string, unknown> {
    const surveyId = (survey.id as string) ?? 'unknown';

    return {
      external_id: surveyId,
      name: (survey.title as string) ?? (survey.nickname as string) ?? null,
      description: (survey.description as string) ?? null,
      question_count: (survey.question_count as number) ?? null,
      response_count: responses.length,
      category: (survey.category as string) ?? null,
      language: (survey.language as string) ?? null,
      created_at: (survey.date_created as string) ?? null,
      modified_at: (survey.date_modified as string) ?? null,
      collect_url: (survey.preview as string) ?? null,
      href: (survey.href as string) ?? null,
      responses: responses.map((r) => ({
        response_id: (r.id as string) ?? null,
        status: (r.response_status as string) ?? null,
        date_created: (r.date_created as string) ?? null,
        date_modified: (r.date_modified as string) ?? null,
        total_time: (r.total_time as number) ?? null,
        ip_address: (r.ip_address as string) ?? null,
        collector_id: (r.collector_id as string) ?? null,
        pages: (r.pages as unknown) ?? null,
      })),
      external_ids: { surveymonkey: surveyId },
      source: 'surveymonkey',
      metadata: {
        survey_id: surveyId,
        analyze_url: (survey.analyze_url as string) ?? null,
        folder_id: (survey.folder_id as string) ?? null,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SurveyMonkeyAdapter();
registerAdapter(adapter);
export default adapter;
