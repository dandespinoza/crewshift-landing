/**
 * Wave Integration Adapter
 *
 * Native (Tier 1) adapter for Wave accounting.
 * Handles OAuth2, customer/invoice sync, and invoice creation via GraphQL.
 *
 * Wave API Reference:
 * - Auth: https://developer.waveapps.com/hc/en-us/articles/360019762711-Authentication
 * - GraphQL API: https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference
 *
 * Key details:
 * - Wave uses a GraphQL API (not REST)
 * - All queries go to https://gql.waveapps.com/graphql/public
 * - Business ID is required for most queries (fetched after auth)
 * - No webhook support — sync is polling-based only
 * - Pagination uses cursor-based relay-style (edges/nodes with pageInfo)
 */

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

const WAVE_AUTH_URL = 'https://api.waveapps.com/oauth2/authorize/';
const WAVE_TOKEN_URL = 'https://api.waveapps.com/oauth2/token/';
const WAVE_GRAPHQL_URL = 'https://gql.waveapps.com/graphql/public';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Execute a GraphQL query/mutation against the Wave API.
 */
async function waveGraphQL(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(WAVE_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, errorBody },
      'Wave GraphQL request failed',
    );
    throw new Error(`Wave GraphQL error: ${response.status} — ${errorBody}`);
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (result.errors) {
    const gqlErrors = result.errors as Array<Record<string, unknown>>;
    const messages = gqlErrors.map((e) => e.message).join('; ');
    logger.error({ errors: gqlErrors }, 'Wave GraphQL errors');
    throw new Error(`Wave GraphQL errors: ${messages}`);
  }

  return result.data as Record<string, unknown>;
}

/**
 * Fetch the primary business ID from Wave after authentication.
 */
async function fetchBusinessId(accessToken: string): Promise<string> {
  const query = `
    query {
      businesses(page: 1, pageSize: 10) {
        edges {
          node {
            id
            name
            isPersonal
          }
        }
      }
    }
  `;

  const data = await waveGraphQL(accessToken, query);
  const businesses = data.businesses as Record<string, unknown>;
  const edges = businesses.edges as Array<Record<string, unknown>>;

  if (!edges || edges.length === 0) {
    throw new Error('No Wave businesses found for this user');
  }

  // Prefer the first non-personal business, fall back to first one
  const nonPersonal = edges.find((e) => {
    const node = e.node as Record<string, unknown>;
    return !node.isPersonal;
  });

  const selectedEdge = nonPersonal ?? edges[0];
  const node = selectedEdge.node as Record<string, unknown>;
  return node.id as string;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class WaveAdapter extends BaseAdapter {
  readonly provider = 'wave' as const;
  readonly tier = 'native' as const;

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = env.WAVE_CLIENT_ID;
    if (!clientId) {
      throw new Error('WAVE_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: orgId,
    });

    return `${WAVE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    const clientId = env.WAVE_CLIENT_ID ?? '';
    const clientSecret = env.WAVE_CLIENT_SECRET ?? '';
    const redirectUri = `${env.API_URL}/api/integrations/wave/callback`;

    const response = await fetch(WAVE_TOKEN_URL, {
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
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, 'Wave token exchange failed');
      throw new Error(`Wave token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Fetch the business ID immediately after token exchange
    const businessId = await fetchBusinessId(tokens.access_token as string);
    logger.info({ businessId }, 'Wave business ID retrieved');

    return {
      access_token: `${tokens.access_token as string}|${businessId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  async refreshToken(currentTokens: TokenSet): Promise<TokenSet> {
    if (!currentTokens.refresh_token) {
      throw new Error('No refresh token available for Wave');
    }

    const clientId = env.WAVE_CLIENT_ID ?? '';
    const clientSecret = env.WAVE_CLIENT_SECRET ?? '';

    const response = await fetch(WAVE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
      logger.error({ status: response.status, errorBody }, 'Wave token refresh failed');
      throw new Error(`Wave token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    // Re-fetch business ID
    const businessId = await fetchBusinessId(tokens.access_token as string);

    return {
      access_token: `${tokens.access_token as string}|${businessId}`,
      refresh_token: tokens.refresh_token as string,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
        : undefined,
      scope: tokens.scope as string | undefined,
    };
  }

  // ── Sync: Wave → CrewShift ─────────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, businessId] = this.parseAccessToken(accessToken);

    const query = `
      query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
        business(id: $businessId) {
          customers(page: $page, pageSize: $pageSize) {
            pageInfo {
              currentPage
              totalPages
              totalCount
            }
            edges {
              node {
                id
                name
                firstName
                lastName
                email
                address {
                  addressLine1
                  addressLine2
                  city
                  province { code name }
                  country { code name }
                  postalCode
                }
                phone
                mobile
                website
                currency { code }
                createdAt
                modifiedAt
              }
            }
          }
        }
      }
    `;

    const allCustomers: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await waveGraphQL(token, query, {
        businessId,
        page,
        pageSize: 100,
      });

      const business = data.business as Record<string, unknown>;
      const customers = business.customers as Record<string, unknown>;
      const pageInfo = customers.pageInfo as Record<string, unknown>;
      const edges = customers.edges as Array<Record<string, unknown>>;

      for (const edge of edges) {
        allCustomers.push(edge.node as Record<string, unknown>);
      }

      if (page < (pageInfo.totalPages as number)) {
        page++;
      } else {
        hasMore = false;
      }
    }

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const customer of allCustomers) {
      try {
        const mapped = this.mapWaveCustomer(customer);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: customer, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: allCustomers.length, created, errors: errors.length },
      'Wave customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const [token, businessId] = this.parseAccessToken(accessToken);

    const query = `
      query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
        business(id: $businessId) {
          invoices(page: $page, pageSize: $pageSize) {
            pageInfo {
              currentPage
              totalPages
              totalCount
            }
            edges {
              node {
                id
                invoiceNumber
                invoiceDate
                dueDate
                amountDue { value currency { code } }
                amountPaid { value currency { code } }
                total { value currency { code } }
                status
                memo
                customer { id name email }
                items {
                  description
                  quantity
                  unitPrice
                  amount { value }
                  account { id name }
                }
                createdAt
                modifiedAt
              }
            }
          }
        }
      }
    `;

    const allInvoices: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await waveGraphQL(token, query, {
        businessId,
        page,
        pageSize: 100,
      });

      const business = data.business as Record<string, unknown>;
      const invoices = business.invoices as Record<string, unknown>;
      const pageInfo = invoices.pageInfo as Record<string, unknown>;
      const edges = invoices.edges as Array<Record<string, unknown>>;

      for (const edge of edges) {
        allInvoices.push(edge.node as Record<string, unknown>);
      }

      if (page < (pageInfo.totalPages as number)) {
        page++;
      } else {
        hasMore = false;
      }
    }

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const invoice of allInvoices) {
      try {
        const mapped = this.mapWaveInvoice(invoice);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: invoice, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: allInvoices.length, created, errors: errors.length },
      'Wave invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Wave ───────────────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const [token, businessId] = this.parseAccessToken(accessToken);

    const mutation = `
      mutation ($input: InvoiceCreateInput!) {
        invoiceCreate(input: $input) {
          didSucceed
          inputErrors {
            path
            message
            code
          }
          invoice {
            id
            invoiceNumber
            status
            total { value }
          }
        }
      }
    `;

    const variables = {
      input: {
        businessId,
        customerId: invoiceData.customer_external_id,
        invoiceDate: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
        dueDate: invoiceData.due_date,
        invoiceNumber: invoiceData.invoice_number ?? undefined,
        memo: invoiceData.notes ?? '',
        items: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
          description: item.description ?? 'Service',
          quantity: item.quantity ?? 1,
          unitPrice: item.unit_price ?? 0,
          productId: item.product_id ?? undefined,
        })) ?? [],
      },
    };

    const data = await waveGraphQL(token, mutation, variables);
    const invoiceCreate = data.invoiceCreate as Record<string, unknown>;

    if (!invoiceCreate.didSucceed) {
      const inputErrors = invoiceCreate.inputErrors as Array<Record<string, unknown>>;
      const messages = inputErrors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new Error(`Wave invoice creation failed: ${messages}`);
    }

    const invoice = invoiceCreate.invoice as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(invoice.id),
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────
  // Wave does not support webhooks. The base class defaults (verifyWebhook
  // returns false, processWebhook throws) are appropriate.

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Parse composite access token "token|businessId" used by sync service.
   */
  private parseAccessToken(accessToken: string): [string, string] {
    const pipe = accessToken.indexOf('|');
    if (pipe === -1) {
      throw new Error('Wave adapter requires accessToken in format "token|businessId"');
    }
    return [accessToken.slice(0, pipe), accessToken.slice(pipe + 1)];
  }

  /**
   * Map a Wave Customer node to CrewShift's unified customer format.
   */
  private mapWaveCustomer(customer: Record<string, unknown>): Record<string, unknown> {
    const address = customer.address as Record<string, unknown> | undefined;
    const province = address?.province as Record<string, unknown> | undefined;
    const country = address?.country as Record<string, unknown> | undefined;

    return {
      name: (customer.name as string) ?? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim(),
      company_name: customer.name as string ?? null,
      email: customer.email as string ?? null,
      phone: (customer.phone as string) || (customer.mobile as string) || null,
      address: address
        ? {
            street: [address.addressLine1, address.addressLine2].filter(Boolean).join(', '),
            city: address.city ?? '',
            state: (province?.code as string) ?? (province?.name as string) ?? '',
            zip: address.postalCode ?? '',
            country: (country?.code as string) ?? (country?.name as string) ?? '',
          }
        : null,
      external_ids: { wave: String(customer.id) },
      source: 'wave',
      metadata: {
        wave_website: customer.website,
        wave_currency: (customer.currency as Record<string, unknown>)?.code,
        wave_created_at: customer.createdAt,
        wave_modified_at: customer.modifiedAt,
      },
    };
  }

  /**
   * Map a Wave Invoice node to CrewShift's unified invoice format.
   */
  private mapWaveInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
    const items = (invoice.items as Array<Record<string, unknown>>) ?? [];
    const total = invoice.total as Record<string, unknown> | undefined;
    const amountDue = invoice.amountDue as Record<string, unknown> | undefined;
    const customer = invoice.customer as Record<string, unknown> | undefined;

    return {
      invoice_number: invoice.invoiceNumber as string ?? null,
      status: this.mapWaveInvoiceStatus(invoice.status as string),
      amount: total?.value ? parseFloat(total.value as string) : 0,
      balance_due: amountDue?.value ? parseFloat(amountDue.value as string) : 0,
      due_date: invoice.dueDate as string ?? null,
      issued_date: invoice.invoiceDate as string ?? null,
      customer_external_id: customer?.id ? String(customer.id) : null,
      external_ids: { wave: String(invoice.id) },
      line_items: items.map((item) => {
        const amount = item.amount as Record<string, unknown> | undefined;
        return {
          description: item.description ?? '',
          quantity: item.quantity ?? 1,
          unit_price: item.unitPrice ?? 0,
          total: amount?.value ? parseFloat(amount.value as string) : 0,
        };
      }),
      source: 'wave',
      metadata: {
        wave_memo: invoice.memo,
        wave_created_at: invoice.createdAt,
        wave_modified_at: invoice.modifiedAt,
      },
    };
  }

  /**
   * Map Wave invoice status to CrewShift status.
   */
  private mapWaveInvoiceStatus(waveStatus: string): string {
    switch (waveStatus) {
      case 'PAID': return 'paid';
      case 'PARTIAL': return 'partial';
      case 'UNPAID': return 'sent';
      case 'OVERDUE': return 'overdue';
      case 'DRAFT': return 'draft';
      case 'SENT': return 'sent';
      case 'VIEWED': return 'sent';
      default: return 'draft';
    }
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const waveAdapter = new WaveAdapter();
registerAdapter(waveAdapter);
export default waveAdapter;
