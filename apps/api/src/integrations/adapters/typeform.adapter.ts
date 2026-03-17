/**
 * Typeform Integration Adapter
 *
 * Native (Tier 1) adapter for Typeform.
 * Handles OAuth 2.0 authentication, form listing, response syncing, and webhooks.
 *
 * Typeform API Reference:
 * - OAuth: https://www.typeform.com/developers/get-started/applications/
 * - Forms: https://www.typeform.com/developers/create-api/reference/retrieve-forms/
 * - Responses: https://www.typeform.com/developers/responses/reference/retrieve-responses/
 * - Webhooks: https://www.typeform.com/developers/webhooks/
 *
 * Key details:
 * - OAuth 2.0 with authorization_code grant and refresh_token support
 * - Also supports Personal Access Tokens (PAT)
 * - Scopes: forms:read, responses:read
 * - Webhook verification: HMAC-SHA256 with Typeform-Signature header (sha256=...)
 * - Pagination via page/page_size for forms, before token for responses
 * - Env: TYPEFORM_CLIENT_ID, TYPEFORM_CLIENT_SECRET
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
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

const AUTH_URL = 'https://api.typeform.com/oauth/authorize';
const TOKEN_URL = 'https://api.typeform.com/oauth/token';
const API_BASE = 'https://api.typeform.com';
const SCOPES = 'forms:read responses:read';
const DEFAULT_PAGE_SIZE = 200;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const clientId = process.env.TYPEFORM_CLIENT_ID ?? (env as Record<string, unknown>).TYPEFORM_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('TYPEFORM_CLIENT_ID is not configured');
  return clientId;
}

function getClientSecret(): string {
  const clientSecret = process.env.TYPEFORM_CLIENT_SECRET ?? (env as Record<string, unknown>).TYPEFORM_CLIENT_SECRET as string | undefined;
  if (!clientSecret) throw new Error('TYPEFORM_CLIENT_SECRET is not configured');
  return clientSecret;
}

/**
 * Make an authenticated request to the Typeform API.
 */
async function typeformFetch(
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
      'Typeform API error',
    );
    throw new Error(`Typeform API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class TypeformAdapter extends BaseAdapter {
  readonly provider = 'typeform' as const;
  readonly tier = 'native' as const;

  // ── OAuth ─────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      state: orgId,
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = `${env.API_URL}/api/integrations/typeform/callback`;

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
        'Typeform token exchange failed',
      );
      throw new Error(`Typeform token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Typeform');
    }

    const clientId = getClientId();
    const clientSecret = getClientSecret();

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, errorBody },
        'Typeform token refresh failed',
      );
      throw new Error(`Typeform token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    return {
      access_token: tokens.access_token as string,
      refresh_token: (tokens.refresh_token as string) ?? currentTokens.refresh_token,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Typeform → CrewShift ────────────────────────────────────────

  /**
   * Sync forms and their responses from Typeform.
   *
   * Retrieves all forms, then fetches responses for each form.
   * Maps each form+responses combination into a unified job record.
   */
  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    try {
      // Step 1: Get all forms
      const forms = await this.fetchAllForms(accessToken);

      for (const form of forms) {
        try {
          const formId = form.id as string;

          // Step 2: Get responses for each form
          let responses: Record<string, unknown>[] = [];
          try {
            responses = await this.fetchFormResponses(formId, accessToken, lastSyncAt);
          } catch (err) {
            logger.debug(
              { formId, error: (err as Error).message },
              'Failed to fetch responses for form',
            );
          }

          const mapped = this.mapForm(form, responses);
          records.push(mapped);
          created++;
        } catch (err) {
          errors.push({ item: form, error: (err as Error).message });
        }
      }

      logger.info(
        { provider: this.provider, total: forms.length, created, errors: errors.length },
        'Typeform sync complete',
      );
    } catch (err) {
      logger.error(
        { provider: this.provider, error: (err as Error).message },
        'Typeform form list failed',
      );
      errors.push({ item: {}, error: (err as Error).message });
    }

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ──────────────────────────────────────────────────────────

  /**
   * Verify a Typeform webhook using HMAC-SHA256.
   *
   * Typeform sends the signature in the Typeform-Signature header as:
   *   sha256=<hex-encoded-hmac>
   *
   * The HMAC is computed using the webhook secret (TYPEFORM_CLIENT_SECRET) as key
   * and the raw request body as message.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    let secret: string;
    try {
      secret = getClientSecret();
    } catch {
      logger.warn('No Typeform client secret configured for webhook verification');
      return false;
    }

    // Parse the "sha256=..." format
    const expectedPrefix = 'sha256=';
    if (!signature.startsWith(expectedPrefix)) {
      logger.warn('Invalid Typeform webhook signature format — expected sha256=...');
      return false;
    }

    const receivedHash = signature.slice(expectedPrefix.length);
    const computedHash = createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    try {
      return timingSafeEqual(
        Buffer.from(receivedHash, 'base64'),
        Buffer.from(computedHash, 'base64'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse a Typeform webhook payload into a normalized WebhookEvent.
   *
   * Typeform webhook payload structure:
   * {
   *   event_type: "form_response",
   *   form_response: {
   *     form_id: "abc123",
   *     token: "unique-response-token",
   *     submitted_at: "2024-01-01T00:00:00Z",
   *     answers: [{ field: { id, type, title }, type, value }],
   *     definition: { id, title, fields: [...] }
   *   }
   * }
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const eventType = (payload.event_type as string) ?? 'unknown';
    const formResponse = payload.form_response as Record<string, unknown> | undefined;
    const formId = (formResponse?.form_id as string) ?? undefined;
    const responseToken = (formResponse?.token as string) ?? undefined;
    const submittedAt = (formResponse?.submitted_at as string) ?? undefined;

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: 'form_response',
      resource_id: responseToken ?? formId,
      data: {
        form_id: formId ?? null,
        response_token: responseToken ?? null,
        submitted_at: submittedAt ?? null,
        answers: (formResponse?.answers as unknown) ?? null,
        definition: (formResponse?.definition as unknown) ?? null,
        raw: payload,
      },
      timestamp: submittedAt ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Fetch all forms with pagination.
   */
  private async fetchAllForms(
    accessToken: string,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await typeformFetch(
        `/forms?page=${page}&page_size=${DEFAULT_PAGE_SIZE}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const items = (data.items as Record<string, unknown>[]) ?? [];

      results.push(...items);

      const totalItems = data.total_items as number | undefined;
      if (totalItems && results.length < totalItems) {
        page++;
      } else {
        hasMore = false;
      }
    }

    return results;
  }

  /**
   * Fetch all responses for a specific form.
   * Uses cursor-based pagination with the "before" token.
   */
  private async fetchFormResponses(
    formId: string,
    accessToken: string,
    since?: string,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    let hasMore = true;
    let beforeToken: string | undefined;

    while (hasMore) {
      const params = new URLSearchParams({
        page_size: String(DEFAULT_PAGE_SIZE),
      });

      if (since) {
        params.set('since', since);
      }

      if (beforeToken) {
        params.set('before', beforeToken);
      }

      const response = await typeformFetch(
        `/forms/${formId}/responses?${params.toString()}`,
        accessToken,
      );
      const data = (await response.json()) as Record<string, unknown>;
      const items = (data.items as Record<string, unknown>[]) ?? [];

      results.push(...items);

      const totalItems = data.total_items as number | undefined;
      if (totalItems && results.length < totalItems && items.length > 0) {
        // Use the last item's token as the "before" cursor
        const lastItem = items[items.length - 1];
        beforeToken = lastItem.token as string;
      } else {
        hasMore = false;
      }
    }

    return results;
  }

  /**
   * Map a Typeform form and its responses to CrewShift's unified format.
   */
  private mapForm(
    form: Record<string, unknown>,
    responses: Record<string, unknown>[],
  ): Record<string, unknown> {
    const formId = (form.id as string) ?? 'unknown';

    return {
      external_id: formId,
      name: (form.title as string) ?? null,
      description: (form.description as string) ?? null,
      type: (form.type as string) ?? null,
      status: (form.status as string) ?? null,
      created_at: (form.created_at as string) ?? null,
      updated_at: (form.last_updated_at as string) ?? null,
      published_at: (form.published_at as string) ?? null,
      response_count: responses.length,
      field_count: ((form.fields as unknown[]) ?? []).length,
      self_url: (form.self as Record<string, unknown>)?.href ?? (form._links as Record<string, unknown>)?.display ?? null,
      responses: responses.map((r) => ({
        response_id: (r.response_id as string) ?? (r.token as string) ?? null,
        submitted_at: (r.submitted_at as string) ?? null,
        landed_at: (r.landed_at as string) ?? null,
        answers: (r.answers as unknown) ?? null,
        calculated: (r.calculated as unknown) ?? null,
        variables: (r.variables as unknown) ?? null,
      })),
      external_ids: { typeform: formId },
      source: 'typeform',
      metadata: {
        form_id: formId,
        workspace: (form.workspace as Record<string, unknown>)?.href ?? null,
        theme: (form.theme as Record<string, unknown>)?.href ?? null,
        settings: form.settings ?? null,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new TypeformAdapter();
registerAdapter(adapter);
export default adapter;
