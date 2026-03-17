/**
 * Interplay Learning Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for Interplay Learning.
 * Handles API Key auth and training completion report sync.
 *
 * Interplay Learning API Reference:
 * - API Base: https://api.interplaylearning.com/v1
 *
 * Key details:
 * - API Key authentication
 * - Training report sync via GET /reports
 * - No webhooks
 * - NOTE: Reporting API only — Enterprise plan required
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

const INTERPLAY_API_BASE = 'https://api.interplaylearning.com/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.INTERPLAY_API_KEY;
  if (!key) throw new Error('INTERPLAY_API_KEY is not configured — Enterprise plan required');
  return key;
}

/**
 * Make an authenticated request to the Interplay Learning API.
 */
async function interplayFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${INTERPLAY_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Interplay Learning API error',
    );
    throw new Error(`Interplay Learning API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class InterplayLearningAdapter extends BaseAdapter {
  readonly provider = 'interplay-learning' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Interplay Learning uses API Key authentication, not OAuth. Configure INTERPLAY_API_KEY instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Interplay Learning uses API Key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Interplay Learning uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Interplay Learning → CrewShift ──────────────────────────────

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getApiKey();

    const response = await interplayFetch('/reports', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const reports = (data.reports as Record<string, unknown>[]) ??
      (data.data as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const report of reports) {
      try {
        records.push({
          title: `Training — ${report.courseName ?? report.title ?? 'N/A'}`,
          status: report.completionStatus ?? report.status ?? null,
          scheduled_start: report.startDate ?? null,
          scheduled_end: report.completionDate ?? null,
          external_ids: { 'interplay-learning': String(report.id) },
          source: 'interplay-learning',
          metadata: {
            interplay_course_name: report.courseName,
            interplay_user_name: report.userName,
            interplay_user_email: report.userEmail,
            interplay_score: report.score,
            interplay_time_spent: report.timeSpent,
            interplay_certification: report.certification,
            interplay_skill_area: report.skillArea,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: report, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: reports.length, created, errors: errors.length },
      'Interplay Learning report sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new InterplayLearningAdapter();
registerAdapter(adapter);
export default adapter;
