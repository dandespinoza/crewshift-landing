/**
 * SafetyCulture (iAuditor) Integration Adapter
 *
 * Native (Tier 1) adapter for the SafetyCulture platform.
 * Provides access to inspections, audits, templates, and compliance data.
 *
 * SafetyCulture API Reference:
 * - API Docs: https://developer.safetyculture.com/
 * - Audits: https://developer.safetyculture.com/reference/get_audits-search
 * - Auth: Bearer token (personal API token with 30-day expiry)
 *
 * Key details:
 * - Authentication via Bearer token (API token issued from SafetyCulture web app)
 * - Tokens have a 30-day expiry; must be manually rotated
 * - GET /audits/search to list inspections/audits with filtering
 * - GET /audits/{audit_id} for full audit detail
 * - No webhooks
 * - Env: SAFETYCULTURE_API_TOKEN
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

const API_BASE = 'https://api.safetyculture.io';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = process.env.SAFETYCULTURE_API_TOKEN ?? (env as Record<string, unknown>).SAFETYCULTURE_API_TOKEN as string | undefined;
  if (!token) throw new Error('SAFETYCULTURE_API_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the SafetyCulture API.
 */
async function safetyCultureFetch(
  path: string,
  bearerToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'SafetyCulture API error',
    );
    throw new Error(`SafetyCulture API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SafetyCultureAdapter extends BaseAdapter {
  readonly provider = 'safetyculture' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — Bearer token auth) ─────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('SafetyCulture uses Bearer token authentication, not OAuth. Configure SAFETYCULTURE_API_TOKEN instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('SafetyCulture uses Bearer token authentication — no callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('SafetyCulture uses Bearer token authentication — tokens must be manually rotated every 30 days.');
  }

  // ── Sync: SafetyCulture → CrewShift ───────────────────────────────────

  /**
   * Sync inspections/audits from SafetyCulture.
   *
   * The accessToken parameter can be used to pass the Bearer token directly.
   * If not provided, falls back to the SAFETYCULTURE_API_TOKEN environment variable.
   */
  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      try {
        const params = new URLSearchParams({
          field: 'audit_id,template_id,template_name,created_at,modified_at,audit_title,audit_score',
          limit: String(DEFAULT_PAGE_SIZE),
          order: 'desc',
        });

        if (lastSyncAt) {
          params.set('modified_after', lastSyncAt);
        }

        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await safetyCultureFetch(
          `/audits/search?${params.toString()}`,
          token,
        );
        const data = (await response.json()) as Record<string, unknown>;

        const audits = (data.audits as Record<string, unknown>[]) ?? [];

        for (const audit of audits) {
          try {
            const mapped = this.mapAudit(audit);
            records.push(mapped);
            created++;
          } catch (err) {
            errors.push({ item: audit, error: (err as Error).message });
          }
        }

        // Handle cursor-based pagination
        const metadata = data.metadata as Record<string, unknown> | undefined;
        const nextCursor = metadata?.next_cursor as string | undefined;

        if (nextCursor && audits.length === DEFAULT_PAGE_SIZE) {
          cursor = nextCursor;
        } else {
          hasMore = false;
        }
      } catch (err) {
        logger.error(
          { provider: this.provider, error: (err as Error).message },
          'SafetyCulture audit sync page failed',
        );
        errors.push({ item: { cursor }, error: (err as Error).message });
        hasMore = false;
      }
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'SafetyCulture audit sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks (not supported) ──────────────────────────────────────────

  // Base class defaults are sufficient since SafetyCulture
  // does not provide native webhook support.

  // ── Public Helpers ────────────────────────────────────────────────────

  /**
   * Fetch a full audit by ID, including all items and responses.
   */
  async getAuditDetail(
    auditId: string,
    bearerToken?: string,
  ): Promise<Record<string, unknown>> {
    const token = bearerToken || getApiToken();
    const response = await safetyCultureFetch(`/audits/${auditId}`, token);
    return (await response.json()) as Record<string, unknown>;
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Map a SafetyCulture audit record to CrewShift's unified job format.
   */
  private mapAudit(audit: Record<string, unknown>): Record<string, unknown> {
    const auditId = (audit.audit_id as string) ?? 'unknown';
    const templateName = (audit.template_name as string) ?? null;
    const auditTitle = (audit.audit_title as string) ?? templateName;
    const createdAt = (audit.created_at as string) ?? null;
    const modifiedAt = (audit.modified_at as string) ?? null;

    // Score can be a percentage or fraction
    const scoreObj = audit.audit_score as Record<string, unknown> | undefined;
    const score = scoreObj
      ? (scoreObj.percentage as number) ?? (scoreObj.score as number) ?? null
      : null;

    return {
      external_id: auditId,
      name: auditTitle,
      template_id: (audit.template_id as string) ?? null,
      template_name: templateName,
      created_at: createdAt,
      modified_at: modifiedAt,
      score,
      status: (audit.audit_status as string) ?? null,
      duration: (audit.audit_duration as number) ?? null,
      author: (audit.audit_author as Record<string, unknown>)?.name ?? null,
      site: (audit.audit_site as Record<string, unknown>)?.name ?? null,
      external_ids: { safetyculture: auditId },
      source: 'safetyculture',
      metadata: audit,
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SafetyCultureAdapter();
registerAdapter(adapter);
export default adapter;
