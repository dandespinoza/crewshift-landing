/**
 * Dynamics 365 Field Service Integration Adapter
 *
 * Native (Tier 1) adapter for Microsoft Dynamics 365 Field Service.
 * Handles OAuth2 (Entra ID/Azure AD), customer/job/invoice sync via OData, and webhooks.
 *
 * Dynamics 365 API Reference:
 * - Auth: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * - Web API: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview
 *
 * Key details:
 * - OAuth 2.0 via Microsoft Entra ID (Azure AD)
 * - Tenant-specific auth URLs
 * - OData v4 REST API with $select, $filter, $orderby, $top, @odata.nextLink pagination
 * - Syncs accounts, msdyn_workorders, and invoices
 * - Webhook: Azure Service Bus or shared key verification
 * - Rate limit: ~40,000 requests per 24 hours per user
 * - License required: Dynamics 365 Field Service
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

const API_VERSION = 'v9.2';
const DEFAULT_PAGE_SIZE = 250;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientId(): string {
  const id = process.env.DYNAMICS_CLIENT_ID ?? env.DYNAMICS_CLIENT_ID;
  if (!id) throw new Error('DYNAMICS_CLIENT_ID is not configured');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.DYNAMICS_CLIENT_SECRET ?? env.DYNAMICS_CLIENT_SECRET;
  if (!secret) throw new Error('DYNAMICS_CLIENT_SECRET is not configured');
  return secret;
}

function getTenantId(): string {
  const tenant = process.env.DYNAMICS_TENANT_ID ?? env.DYNAMICS_TENANT_ID;
  if (!tenant) throw new Error('DYNAMICS_TENANT_ID is not configured');
  return tenant;
}

function getAuthUrl(): string {
  return `https://login.microsoftonline.com/${getTenantId()}/oauth2/v2.0/authorize`;
}

function getTokenUrl(): string {
  return `https://login.microsoftonline.com/${getTenantId()}/oauth2/v2.0/token`;
}

/**
 * Parse composite access token "accessToken|orgUrl".
 * orgUrl is the Dynamics 365 organization URL (e.g., https://org.api.crm.dynamics.com).
 */
function parseCompositeToken(accessToken: string): [string, string] {
  const pipe = accessToken.indexOf('|');
  if (pipe === -1) {
    throw new Error('Dynamics 365 adapter requires accessToken in format "token|orgUrl"');
  }
  return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
}

/**
 * Make an authenticated request to the Dynamics 365 Web API.
 */
async function d365Fetch(
  orgUrl: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${orgUrl}/api/data/${API_VERSION}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Prefer': `odata.maxpagesize=${DEFAULT_PAGE_SIZE}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Dynamics 365 API error',
    );
    throw new Error(`Dynamics 365 API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

/**
 * Paginate through a Dynamics 365 OData endpoint using @odata.nextLink.
 */
async function d365FetchAllPages(
  orgUrl: string,
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let nextUrl: string | null = path;

  while (nextUrl) {
    const response = await d365Fetch(orgUrl, nextUrl, accessToken);
    const data = (await response.json()) as Record<string, unknown>;
    const items = (data.value as Array<Record<string, unknown>>) ?? [];

    results.push(...items);

    // OData pagination via @odata.nextLink
    const nextLink = data['@odata.nextLink'] as string | undefined;
    nextUrl = nextLink ?? null;
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class Dynamics365FieldServiceAdapter extends BaseAdapter {
  readonly provider = 'dynamics-365-fs' as const;
  readonly tier = 'native' as const;

  // ── OAuth (Entra ID / Azure AD) ──────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://dynamics.microsoft.com/.default offline_access',
      state: orgId,
      prompt: 'consent',
    });

    return `${getAuthUrl()}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = `${env.API_URL}/api/integrations/dynamics-365-fs/callback`;

    const response = await fetch(getTokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        scope: 'https://dynamics.microsoft.com/.default offline_access',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Dynamics 365 token exchange failed');
      throw new Error(`Dynamics 365 token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // The org URL must be configured or discovered separately.
    // For now, we'll expect it to be passed in the state or a separate config.
    // The access token is stored as "token|orgUrl".
    const orgUrl = (tokens.resource as string) ?? '';

    return {
      access_token: `${tokens.access_token as string}|${orgUrl}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Dynamics 365');
    }

    const clientId = getClientId();
    const clientSecret = getClientSecret();

    const response = await fetch(getTokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://dynamics.microsoft.com/.default offline_access',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Dynamics 365 token refresh failed');
      throw new Error(`Dynamics 365 token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Preserve the org URL from the current token
    const [, orgUrl] = parseCompositeToken(currentTokens.access_token);

    return {
      access_token: `${tokens.access_token as string}|${orgUrl}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Dynamics 365 → CrewShift ────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, orgUrl] = parseCompositeToken(accessToken);

    let filter = '';
    if (lastSyncAt) {
      filter = `&$filter=modifiedon gt ${lastSyncAt}`;
    }

    const accounts = await d365FetchAllPages(
      orgUrl,
      `/accounts?$select=accountid,name,emailaddress1,telephone1,address1_line1,address1_city,address1_stateorprovince,address1_postalcode,address1_country,websiteurl,industrycode,createdon,modifiedon${filter}&$orderby=modifiedon desc`,
      token,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const acct of accounts) {
      try {
        records.push({
          name: (acct.name as string) ?? '',
          company_name: (acct.name as string) ?? null,
          email: (acct.emailaddress1 as string) ?? null,
          phone: (acct.telephone1 as string) ?? null,
          address: acct.address1_line1
            ? {
                street: (acct.address1_line1 as string) ?? '',
                city: (acct.address1_city as string) ?? '',
                state: (acct.address1_stateorprovince as string) ?? '',
                zip: (acct.address1_postalcode as string) ?? '',
                country: (acct.address1_country as string) ?? '',
              }
            : null,
          external_ids: { 'dynamics-365-fs': String(acct.accountid) },
          source: 'dynamics-365-fs',
          metadata: {
            d365_website: acct.websiteurl,
            d365_industry_code: acct.industrycode,
            d365_created_on: acct.createdon,
            d365_modified_on: acct.modifiedon,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: acct, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: accounts.length, created, errors: errors.length },
      'Dynamics 365 account/customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, orgUrl] = parseCompositeToken(accessToken);

    let filter = '';
    if (lastSyncAt) {
      filter = `&$filter=modifiedon gt ${lastSyncAt}`;
    }

    const workOrders = await d365FetchAllPages(
      orgUrl,
      `/msdyn_workorders?$select=msdyn_workorderid,msdyn_name,msdyn_workordersummary,msdyn_systemstatus,msdyn_substatus,msdyn_datewindowstart,msdyn_datewindowend,msdyn_serviceaccount,msdyn_address1,msdyn_city,msdyn_stateorprovince,msdyn_postalcode,msdyn_country,createdon,modifiedon${filter}&$orderby=modifiedon desc`,
      token,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const wo of workOrders) {
      try {
        records.push({
          title: (wo.msdyn_name as string) ?? `WO ${wo.msdyn_workorderid}`,
          status: this.mapWorkOrderStatus(wo.msdyn_systemstatus as number),
          type: 'work_order',
          scheduled_start: (wo.msdyn_datewindowstart as string) ?? null,
          scheduled_end: (wo.msdyn_datewindowend as string) ?? null,
          customer_external_id: wo['_msdyn_serviceaccount_value'] ? String(wo['_msdyn_serviceaccount_value']) : null,
          address: wo.msdyn_address1
            ? {
                street: (wo.msdyn_address1 as string) ?? '',
                city: (wo.msdyn_city as string) ?? '',
                state: (wo.msdyn_stateorprovince as string) ?? '',
                zip: (wo.msdyn_postalcode as string) ?? '',
                country: (wo.msdyn_country as string) ?? '',
              }
            : null,
          external_ids: { 'dynamics-365-fs': String(wo.msdyn_workorderid) },
          source: 'dynamics-365-fs',
          metadata: {
            d365_type: 'msdyn_workorder',
            d365_summary: wo.msdyn_workordersummary,
            d365_system_status: wo.msdyn_systemstatus,
            d365_substatus: wo.msdyn_substatus,
            d365_created_on: wo.createdon,
            d365_modified_on: wo.modifiedon,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: wo, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: workOrders.length, created, errors: errors.length },
      'Dynamics 365 work order sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, orgUrl] = parseCompositeToken(accessToken);

    let filter = '';
    if (lastSyncAt) {
      filter = `&$filter=modifiedon gt ${lastSyncAt}`;
    }

    const invoices = await d365FetchAllPages(
      orgUrl,
      `/invoices?$select=invoiceid,invoicenumber,name,totalamount,totaltax,totallineitemamount,duedate,createdon,modifiedon,statuscode,statecode${filter}&$orderby=modifiedon desc`,
      token,
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const inv of invoices) {
      try {
        records.push({
          invoice_number: (inv.invoicenumber as string) ?? (inv.name as string) ?? null,
          status: this.mapInvoiceStatus(inv.statuscode as number, inv.statecode as number),
          amount: (inv.totalamount as number) ?? 0,
          balance_due: (inv.totalamount as number) ?? 0,
          due_date: (inv.duedate as string) ?? null,
          issued_date: (inv.createdon as string) ?? null,
          customer_external_id: inv['_customerid_value'] ? String(inv['_customerid_value']) : null,
          external_ids: { 'dynamics-365-fs': String(inv.invoiceid) },
          source: 'dynamics-365-fs',
          metadata: {
            d365_invoice_number: inv.invoicenumber,
            d365_total_tax: inv.totaltax,
            d365_total_line_item_amount: inv.totallineitemamount,
            d365_status_code: inv.statuscode,
            d365_state_code: inv.statecode,
            d365_created_on: inv.createdon,
            d365_modified_on: inv.modifiedon,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Dynamics 365 invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Dynamics 365 ───────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, orgUrl] = parseCompositeToken(accessToken);

    const body: Record<string, unknown> = {
      name: invoiceData.invoice_number ?? `INV-${Date.now()}`,
      'customerid_account@odata.bind': invoiceData.customer_external_id
        ? `/accounts(${invoiceData.customer_external_id})`
        : undefined,
      description: invoiceData.notes as string ?? '',
    };

    // Remove undefined values
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }

    const response = await d365Fetch(orgUrl, '/invoices', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // Dynamics 365 returns the new entity ID in the OData-EntityId header
    const entityIdHeader = response.headers.get('OData-EntityId') ?? '';
    const idMatch = entityIdHeader.match(/\(([^)]+)\)/);
    const invoiceId = idMatch?.[1] ?? 'unknown';

    return {
      provider: this.provider,
      external_id: invoiceId,
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    // Dynamics 365 webhooks can use shared access key verification
    // or Azure Service Bus signatures.
    const secret = getClientSecret();

    try {
      const hash = createHmac('sha256', secret)
        .update(payload)
        .digest('base64');

      return timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Dynamics 365 webhook payload structure varies by configuration.
    // Common pattern: RemoteExecutionContext with MessageName and PrimaryEntityId.
    const messageName = (payload.MessageName as string) ?? (payload.message as string) ?? 'unknown';
    const primaryEntityName = (payload.PrimaryEntityName as string) ?? (payload.entity as string) ?? 'unknown';
    const primaryEntityId = (payload.PrimaryEntityId as string) ?? undefined;

    return {
      provider: this.provider,
      event_type: messageName.toLowerCase(),
      resource_type: primaryEntityName.toLowerCase(),
      resource_id: primaryEntityId,
      data: payload,
      timestamp: (payload.OperationCreatedOn as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Map Dynamics 365 work order system status (option set) to CrewShift status.
   * 690970000 = Open - Unscheduled, 690970001 = Open - Scheduled,
   * 690970002 = Open - In Progress, 690970003 = Open - Completed,
   * 690970004 = Closed - Posted, 690970005 = Closed - Canceled
   */
  private mapWorkOrderStatus(systemStatus: number | undefined): string {
    switch (systemStatus) {
      case 690970000: return 'unscheduled';
      case 690970001: return 'scheduled';
      case 690970002: return 'in_progress';
      case 690970003: return 'completed';
      case 690970004: return 'closed';
      case 690970005: return 'canceled';
      default: return 'unknown';
    }
  }

  /**
   * Map Dynamics 365 invoice status code to CrewShift status.
   * statecode: 0 = Active, 1 = Closed, 2 = Paid, 3 = Canceled
   * statuscode varies by statecode.
   */
  private mapInvoiceStatus(statusCode: number | undefined, stateCode: number | undefined): string {
    if (stateCode === 2) return 'paid';
    if (stateCode === 3) return 'void';
    if (stateCode === 1) return 'sent';
    if (stateCode === 0) return 'draft';
    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new Dynamics365FieldServiceAdapter();
registerAdapter(adapter);
export default adapter;
