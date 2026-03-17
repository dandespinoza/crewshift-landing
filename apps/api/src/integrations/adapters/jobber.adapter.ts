/**
 * Jobber Integration Adapter
 *
 * Native (Tier 2) adapter for Jobber field service management.
 * Handles OAuth2, customer/job/invoice sync via GraphQL, and webhooks.
 *
 * Jobber API Reference:
 * - Auth: https://developer.getjobber.com/docs/build_with_jobber/authorization/
 * - GraphQL: https://developer.getjobber.com/docs/
 * - Webhooks: https://developer.getjobber.com/docs/build_with_jobber/webhooks/
 *
 * Key details:
 * - GraphQL-only API (no REST endpoints)
 * - Token exchange via standard OAuth 2.0 POST
 * - Pagination uses cursor-based (first/after) pattern
 * - Rate limit: 2500 requests per 5-minute window
 * - Webhook verification: HMAC-SHA256 via X-Jobber-Hmac-SHA256 header
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

// -- Constants ----------------------------------------------------------------

const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize';
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_SCOPES = 'read_clients,write_clients,read_jobs,write_jobs,read_invoices,write_invoices';
const JOBBER_PAGE_SIZE = 100;

// -- Helpers ------------------------------------------------------------------

/**
 * Execute a GraphQL query/mutation against the Jobber API.
 */
async function jobberGraphQL(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, errorBody },
      'Jobber GraphQL API error',
    );
    throw new Error(`Jobber API error: ${response.status} -- ${errorBody}`);
  }

  const result = (await response.json()) as Record<string, unknown>;
  const errors = result.errors as Array<Record<string, unknown>> | undefined;
  if (errors && errors.length > 0) {
    logger.error({ errors }, 'Jobber GraphQL errors');
    throw new Error(`Jobber GraphQL error: ${JSON.stringify(errors[0])}`);
  }

  return result.data as Record<string, unknown>;
}

// -- GraphQL Queries ----------------------------------------------------------

const CLIENTS_QUERY = `
  query GetClients($first: Int!, $after: String) {
    clients(first: $first, after: $after) {
      nodes {
        id
        firstName
        lastName
        companyName
        emails {
          address
          primary
        }
        phones {
          number
          primary
        }
        billingAddress {
          street1
          street2
          city
          province
          postalCode
          country
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
      totalCount
    }
  }
`;

const JOBS_QUERY = `
  query GetJobs($first: Int!, $after: String) {
    jobs(first: $first, after: $after) {
      nodes {
        id
        title
        jobNumber
        startAt
        endAt
        jobStatus
        client {
          id
        }
        lineItems {
          nodes {
            name
            description
            quantity
            unitPrice
          }
        }
        total
      }
      pageInfo {
        endCursor
        hasNextPage
      }
      totalCount
    }
  }
`;

const INVOICES_QUERY = `
  query GetInvoices($first: Int!, $after: String) {
    invoices(first: $first, after: $after) {
      nodes {
        id
        invoiceNumber
        subject
        issueDate
        dueDate
        total
        amountDue
        status
        client {
          id
        }
        lineItems {
          nodes {
            name
            description
            quantity
            unitPrice
            totalPrice
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
      totalCount
    }
  }
`;

const CREATE_INVOICE_MUTATION = `
  mutation InvoiceCreate($input: InvoiceCreateInput!) {
    invoiceCreate(input: $input) {
      invoice {
        id
        invoiceNumber
      }
      userErrors {
        message
        path
      }
    }
  }
`;

// -- Adapter ------------------------------------------------------------------

class JobberAdapter extends BaseAdapter {
  readonly provider = 'jobber' as const;
  readonly tier = 'native' as const;

  // -- OAuth ------------------------------------------------------------------

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.JOBBER_CLIENT_ID;
    if (!clientId) {
      throw new Error('JOBBER_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: JOBBER_SCOPES,
      state: orgId,
    });

    return `${JOBBER_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.JOBBER_CLIENT_ID ?? '';
    const clientSecret = env.JOBBER_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/jobber/callback`;

    const response = await fetch(JOBBER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Jobber token exchange failed');
      throw new Error(`Jobber token exchange failed: ${response.status}`);
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
      throw new Error('No refresh token available for Jobber');
    }

    const clientId = env.JOBBER_CLIENT_ID ?? '';
    const clientSecret = env.JOBBER_CLIENT_SECRET ?? '';

    const response = await fetch(JOBBER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentTokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Jobber token refresh failed');
      throw new Error(`Jobber token refresh failed: ${response.status}`);
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

  // -- Sync: Jobber -> CrewShift ----------------------------------------------

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await jobberGraphQL(
        CLIENTS_QUERY,
        { first: JOBBER_PAGE_SIZE, after: cursor },
        accessToken,
      );

      const clients = data.clients as Record<string, unknown>;
      const nodes = (clients.nodes as Array<Record<string, unknown>>) ?? [];
      const pageInfo = clients.pageInfo as Record<string, unknown>;

      for (const client of nodes) {
        try {
          records.push(this.mapClient(client));
          created++;
        } catch (err) {
          errors.push({ item: client, error: (err as Error).message });
        }
      }

      hasNextPage = (pageInfo.hasNextPage as boolean) ?? false;
      cursor = (pageInfo.endCursor as string) ?? null;
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Jobber customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await jobberGraphQL(
        JOBS_QUERY,
        { first: JOBBER_PAGE_SIZE, after: cursor },
        accessToken,
      );

      const jobs = data.jobs as Record<string, unknown>;
      const nodes = (jobs.nodes as Array<Record<string, unknown>>) ?? [];
      const pageInfo = jobs.pageInfo as Record<string, unknown>;

      for (const job of nodes) {
        try {
          records.push(this.mapJob(job));
          created++;
        } catch (err) {
          errors.push({ item: job, error: (err as Error).message });
        }
      }

      hasNextPage = (pageInfo.hasNextPage as boolean) ?? false;
      cursor = (pageInfo.endCursor as string) ?? null;
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Jobber job sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await jobberGraphQL(
        INVOICES_QUERY,
        { first: JOBBER_PAGE_SIZE, after: cursor },
        accessToken,
      );

      const invoices = data.invoices as Record<string, unknown>;
      const nodes = (invoices.nodes as Array<Record<string, unknown>>) ?? [];
      const pageInfo = invoices.pageInfo as Record<string, unknown>;

      for (const invoice of nodes) {
        try {
          records.push(this.mapInvoice(invoice));
          created++;
        } catch (err) {
          errors.push({ item: invoice, error: (err as Error).message });
        }
      }

      hasNextPage = (pageInfo.hasNextPage as boolean) ?? false;
      cursor = (pageInfo.endCursor as string) ?? null;
    }

    logger.info(
      { provider: this.provider, total: records.length, created, errors: errors.length },
      'Jobber invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // -- Write-back: CrewShift -> Jobber ----------------------------------------

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const input = {
      clientId: invoiceData.customer_external_id,
      subject: invoiceData.subject ?? invoiceData.description ?? '',
      dueDate: invoiceData.due_date,
      lineItems: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
        name: item.description ?? item.name ?? '',
        quantity: item.quantity ?? 1,
        unitPrice: item.unit_price ?? 0,
      })) ?? [],
    };

    const data = await jobberGraphQL(
      CREATE_INVOICE_MUTATION,
      { input },
      accessToken,
    );

    const result = data.invoiceCreate as Record<string, unknown>;
    const userErrors = result.userErrors as Array<Record<string, unknown>> | undefined;
    if (userErrors && userErrors.length > 0) {
      throw new Error(`Jobber invoice creation failed: ${JSON.stringify(userErrors)}`);
    }

    const invoice = result.invoice as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(invoice.id),
    };
  }

  // -- Webhooks ---------------------------------------------------------------

  verifyWebhook(payload: Buffer, signature: string): boolean {
    const secret = env.JOBBER_CLIENT_SECRET;
    if (!secret) {
      logger.warn('No Jobber client secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const topic = payload.topic as string | undefined;
    const data = payload.data as Record<string, unknown> | undefined;

    // Jobber webhook topics are formatted like "CLIENT_CREATE", "JOB_UPDATE", etc.
    const parts = (topic ?? 'UNKNOWN_UNKNOWN').split('_');
    const resourceType = (parts[0] ?? 'unknown').toLowerCase();
    const eventType = (parts.slice(1).join('_') ?? 'unknown').toLowerCase();

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: data?.id ? String(data.id) : undefined,
      data: payload,
      timestamp: new Date().toISOString(),
    };
  }

  // -- Private Helpers --------------------------------------------------------

  private mapClient(client: Record<string, unknown>): Record<string, unknown> {
    const emails = client.emails as Array<Record<string, unknown>> | undefined;
    const phones = client.phones as Array<Record<string, unknown>> | undefined;
    const billingAddress = client.billingAddress as Record<string, unknown> | undefined;
    const primaryEmail = emails?.find((e) => e.primary) ?? emails?.[0];
    const primaryPhone = phones?.find((p) => p.primary) ?? phones?.[0];

    return {
      name: `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim() || client.companyName,
      company_name: client.companyName ?? null,
      email: (primaryEmail?.address as string) ?? null,
      phone: (primaryPhone?.number as string) ?? null,
      address: billingAddress
        ? {
            street: [billingAddress.street1, billingAddress.street2].filter(Boolean).join(', '),
            city: billingAddress.city ?? '',
            state: billingAddress.province ?? '',
            zip: billingAddress.postalCode ?? '',
            country: billingAddress.country ?? '',
          }
        : null,
      external_ids: { jobber: String(client.id) },
      source: 'jobber',
    };
  }

  private mapJob(job: Record<string, unknown>): Record<string, unknown> {
    const client = job.client as Record<string, unknown> | undefined;
    const lineItemsContainer = job.lineItems as Record<string, unknown> | undefined;
    const lineItemNodes = (lineItemsContainer?.nodes as Array<Record<string, unknown>>) ?? [];

    return {
      title: job.title ?? '',
      job_number: job.jobNumber ?? null,
      status: job.jobStatus ?? 'unknown',
      start_at: job.startAt ?? null,
      end_at: job.endAt ?? null,
      total: job.total ?? 0,
      customer_external_id: client?.id ? String(client.id) : null,
      line_items: lineItemNodes.map((li) => ({
        name: li.name ?? '',
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unit_price: li.unitPrice ?? 0,
      })),
      external_ids: { jobber: String(job.id) },
      source: 'jobber',
    };
  }

  private mapInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const client = invoice.client as Record<string, unknown> | undefined;
    const lineItemsContainer = invoice.lineItems as Record<string, unknown> | undefined;
    const lineItemNodes = (lineItemsContainer?.nodes as Array<Record<string, unknown>>) ?? [];

    return {
      invoice_number: invoice.invoiceNumber ?? null,
      subject: invoice.subject ?? null,
      status: (invoice.status as string)?.toLowerCase() ?? 'unknown',
      amount: invoice.total ?? 0,
      balance_due: invoice.amountDue ?? 0,
      due_date: invoice.dueDate ?? null,
      issued_date: invoice.issueDate ?? null,
      customer_external_id: client?.id ? String(client.id) : null,
      line_items: lineItemNodes.map((li) => ({
        name: li.name ?? '',
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unit_price: li.unitPrice ?? 0,
        total: li.totalPrice ?? 0,
      })),
      external_ids: { jobber: String(invoice.id) },
      source: 'jobber',
    };
  }
}

// -- Self-register ------------------------------------------------------------

const adapter = new JobberAdapter();
registerAdapter(adapter);
export default adapter;
