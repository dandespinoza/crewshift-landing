/**
 * PlanSwift Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for PlanSwift.
 * PlanSwift is a desktop-only takeoff and estimating application.
 *
 * Key details:
 * - Desktop COM/OLE SDK only — no REST API available
 * - All methods throw errors directing users to the COM/OLE SDK
 * - Contact takeoff@constructconnect.com for SDK access
 * - No environment variables required (no cloud API)
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

const DESKTOP_ERROR =
  'PlanSwift is a desktop application — use COM/OLE SDK or contact takeoff@constructconnect.com for integration support. No REST API is available.';

// ── Adapter ──────────────────────────────────────────────────────────────────

class PlanSwiftAdapter extends BaseAdapter {
  readonly provider = 'planswift' as const;
  readonly tier = 'native' as const;

  // ── Auth (Not applicable — desktop SDK) ──────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(DESKTOP_ERROR);
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error(DESKTOP_ERROR);
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error(DESKTOP_ERROR);
  }

  // ── Sync (Not available — desktop SDK) ──────────────────────────────────

  async syncCustomers(_accessToken: string, _lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>> {
    throw new Error(DESKTOP_ERROR);
  }

  async syncJobs(_accessToken: string, _lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>> {
    throw new Error(DESKTOP_ERROR);
  }

  async syncInvoices(_accessToken: string, _lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>> {
    throw new Error(DESKTOP_ERROR);
  }

  // ── Write-back (Not available — desktop SDK) ────────────────────────────

  async createInvoice(_accessToken: string, _invoiceData: Record<string, unknown>): Promise<ExternalId> {
    throw new Error(DESKTOP_ERROR);
  }

  async updateJobStatus(_accessToken: string, _externalId: string, _status: string): Promise<void> {
    throw new Error(DESKTOP_ERROR);
  }

  async createPayment(_accessToken: string, _paymentData: Record<string, unknown>): Promise<ExternalId> {
    throw new Error(DESKTOP_ERROR);
  }

  // ── Webhooks (Not available — desktop SDK) ──────────────────────────────

  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    logger.warn('PlanSwift is a desktop application — webhooks are not supported');
    return false;
  }

  async processWebhook(_payload: Record<string, unknown>): Promise<WebhookEvent> {
    throw new Error(DESKTOP_ERROR);
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new PlanSwiftAdapter();
registerAdapter(adapter);
export default adapter;
