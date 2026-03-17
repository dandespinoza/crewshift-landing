/**
 * Integration Adapter Interface
 *
 * Every integration (QuickBooks, Stripe, Jobber, etc.) implements this interface.
 * The agent runtime calls adapters through this contract — it never knows which
 * specific integration is being used.
 *
 * Tier 1 (native) adapters implement each method directly.
 * Tier 2 (Merge.dev/Nango) adapters wrap unified API calls behind this interface.
 * Tier 3 (Zapier bridge) adapters use webhook triggers.
 */

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scope?: string;
}

export interface ExternalId {
  provider: string;
  external_id: string;
}

export interface WebhookEvent {
  provider: string;
  event_type: string;
  resource_type: string;
  resource_id?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface SyncResult<T> {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ item: unknown; error: string }>;
  records: T[];
}

export type IntegrationTier = 'native' | 'unified' | 'bridge';

export interface IntegrationAdapter {
  /** Provider identifier (e.g., 'quickbooks', 'stripe') */
  readonly provider: string;

  /** Integration tier */
  readonly tier: IntegrationTier;

  // ============================================
  // OAuth
  // ============================================

  /** Generate the OAuth authorization URL */
  getAuthUrl(orgId: string, redirectUri: string): string;

  /** Handle the OAuth callback and exchange code for tokens */
  handleCallback(code: string, orgId: string): Promise<TokenSet>;

  /** Refresh an expired access token */
  refreshToken(currentTokens: TokenSet): Promise<TokenSet>;

  // ============================================
  // Sync: External → CrewShift (Unified Model)
  // ============================================

  /** Pull customers from external system */
  syncCustomers(accessToken: string, lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>>;

  /** Pull jobs/work orders from external system */
  syncJobs(accessToken: string, lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>>;

  /** Pull invoices from external system */
  syncInvoices(accessToken: string, lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>>;

  // ============================================
  // Write-back: CrewShift → External
  // ============================================

  /** Create an invoice in the external system */
  createInvoice(accessToken: string, invoiceData: Record<string, unknown>): Promise<ExternalId>;

  /** Update a job/work order status in the external system */
  updateJobStatus(accessToken: string, externalId: string, status: string): Promise<void>;

  /** Create a payment record in the external system */
  createPayment(accessToken: string, paymentData: Record<string, unknown>): Promise<ExternalId>;

  // ============================================
  // Webhooks
  // ============================================

  /** Verify the authenticity of an inbound webhook */
  verifyWebhook(payload: Buffer, signature: string): boolean;

  /** Parse a webhook payload into a normalized event */
  processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent>;
}

/**
 * Base class for integration adapters.
 * Provides default no-op implementations for methods that not all adapters support.
 */
export abstract class BaseAdapter implements IntegrationAdapter {
  abstract readonly provider: string;
  abstract readonly tier: IntegrationTier;

  abstract getAuthUrl(orgId: string, redirectUri: string): string;
  abstract handleCallback(code: string, orgId: string): Promise<TokenSet>;
  abstract refreshToken(currentTokens: TokenSet): Promise<TokenSet>;

  async syncCustomers(_accessToken: string, _lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>> {
    return { created: 0, updated: 0, skipped: 0, errors: [], records: [] };
  }

  async syncJobs(_accessToken: string, _lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>> {
    return { created: 0, updated: 0, skipped: 0, errors: [], records: [] };
  }

  async syncInvoices(_accessToken: string, _lastSyncAt?: string): Promise<SyncResult<Record<string, unknown>>> {
    return { created: 0, updated: 0, skipped: 0, errors: [], records: [] };
  }

  async createInvoice(_accessToken: string, _invoiceData: Record<string, unknown>): Promise<ExternalId> {
    throw new Error(`${this.provider} adapter does not support createInvoice`);
  }

  async updateJobStatus(_accessToken: string, _externalId: string, _status: string): Promise<void> {
    throw new Error(`${this.provider} adapter does not support updateJobStatus`);
  }

  async createPayment(_accessToken: string, _paymentData: Record<string, unknown>): Promise<ExternalId> {
    throw new Error(`${this.provider} adapter does not support createPayment`);
  }

  verifyWebhook(_payload: Buffer, _signature: string): boolean {
    return false;
  }

  async processWebhook(_payload: Record<string, unknown>): Promise<WebhookEvent> {
    throw new Error(`${this.provider} adapter does not support processWebhook`);
  }
}
