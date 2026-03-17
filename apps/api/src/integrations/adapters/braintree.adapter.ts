/**
 * Braintree Integration Adapter
 *
 * Native (Tier 1) adapter for Braintree (a PayPal service).
 * Handles API key auth, customer sync, payment creation, and webhooks.
 *
 * Braintree API Reference:
 * - GraphQL: https://graphql.braintreepayments.com/guides/
 * - Webhooks: https://developer.paypal.com/braintree/docs/guides/webhooks/overview
 *
 * Key details:
 * - Auth via API key triplet (merchant ID, public key, private key)
 * - Uses GraphQL API (payments.braintree-api.com/graphql)
 * - Webhook verification uses Braintree's bt_signature + bt_payload format
 * - Amounts are decimal strings (e.g., "10.00")
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

const GRAPHQL_URL = 'https://payments.braintree-api.com/graphql';
const SANDBOX_GRAPHQL_URL = 'https://payments.sandbox.braintree-api.com/graphql';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSandbox(): boolean {
  return env.NODE_ENV !== 'production';
}

function getGraphQLUrl(): string {
  return isSandbox() ? SANDBOX_GRAPHQL_URL : GRAPHQL_URL;
}

function getMerchantId(): string {
  const id = process.env.BRAINTREE_MERCHANT_ID ?? env.BRAINTREE_MERCHANT_ID;
  if (!id) throw new Error('BRAINTREE_MERCHANT_ID is not configured');
  return id;
}

function getPublicKey(): string {
  const key = process.env.BRAINTREE_PUBLIC_KEY ?? env.BRAINTREE_PUBLIC_KEY;
  if (!key) throw new Error('BRAINTREE_PUBLIC_KEY is not configured');
  return key;
}

function getPrivateKey(): string {
  const key = process.env.BRAINTREE_PRIVATE_KEY ?? env.BRAINTREE_PRIVATE_KEY;
  if (!key) throw new Error('BRAINTREE_PRIVATE_KEY is not configured');
  return key;
}

/**
 * Build the Basic auth header from Braintree public/private key pair.
 * Braintree GraphQL uses: Basic base64(publicKey:privateKey)
 */
function getBraintreeAuthHeader(): string {
  return `Basic ${Buffer.from(`${getPublicKey()}:${getPrivateKey()}`).toString('base64')}`;
}

/**
 * Execute a GraphQL query against the Braintree API.
 */
async function braintreeGraphQL(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const url = getGraphQLUrl();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': getBraintreeAuthHeader(),
      'Content-Type': 'application/json',
      'Braintree-Version': '2024-08-01',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, errorBody },
      'Braintree GraphQL error',
    );
    throw new Error(`Braintree GraphQL error: ${response.status} — ${errorBody}`);
  }

  const result = (await response.json()) as Record<string, unknown>;

  // Check for GraphQL-level errors
  const errors = result.errors as Array<Record<string, unknown>> | undefined;
  if (errors && errors.length > 0) {
    const messages = errors.map((e) => e.message).join('; ');
    logger.error({ errors }, 'Braintree GraphQL response errors');
    throw new Error(`Braintree GraphQL errors: ${messages}`);
  }

  return (result.data as Record<string, unknown>) ?? {};
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class BraintreeAdapter extends BaseAdapter {
  readonly provider = 'braintree' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API key auth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'Braintree uses API key authentication, not OAuth. Configure BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, and BRAINTREE_PRIVATE_KEY.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Braintree uses API key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Braintree uses API key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: Braintree → CrewShift ────────────────────────────────────────

  async syncCustomers(
    _accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Braintree GraphQL: search customers with pagination
    const allCustomers: Record<string, unknown>[] = [];
    let hasNextPage = true;
    let afterCursor: string | null = null;

    while (hasNextPage) {
      const query = `
        query SearchCustomers($after: String) {
          search {
            customers(input: {}, first: 50, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  legacyId
                  firstName
                  lastName
                  company
                  email
                  phoneNumber
                  createdAt
                  defaultPaymentMethod {
                    id
                    details {
                      ... on CreditCardDetails {
                        last4
                        brandCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const data = await braintreeGraphQL(query, { after: afterCursor });
      const search = data.search as Record<string, unknown>;
      const customers = search.customers as Record<string, unknown>;
      const pageInfo = customers.pageInfo as Record<string, unknown>;
      const edges = (customers.edges as Array<Record<string, unknown>>) ?? [];

      for (const edge of edges) {
        allCustomers.push(edge.node as Record<string, unknown>);
      }

      hasNextPage = (pageInfo.hasNextPage as boolean) ?? false;
      afterCursor = (pageInfo.endCursor as string) ?? null;
    }

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    for (const btCust of allCustomers) {
      try {
        const mapped = this.mapBraintreeCustomer(btCust);
        records.push(mapped);
        created++;
      } catch (err) {
        errors.push({ item: btCust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: allCustomers.length, created, errors: errors.length },
      'Braintree customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Braintree ──────────────────────────────────

  async createPayment(
    _accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const mutation = `
      mutation ChargePaymentMethod($input: ChargePaymentMethodInput!) {
        chargePaymentMethod(input: $input) {
          transaction {
            id
            legacyId
            status
            amount {
              value
              currencyCode
            }
            createdAt
          }
        }
      }
    `;

    const variables = {
      input: {
        paymentMethodId: paymentData.payment_method_id,
        transaction: {
          amount: String(paymentData.amount),
          merchantAccountId: paymentData.merchant_account_id ?? getMerchantId(),
          orderId: paymentData.order_id ?? undefined,
          customFields: paymentData.metadata ?? undefined,
        },
      },
    };

    const data = await braintreeGraphQL(mutation, variables);
    const chargeResult = data.chargePaymentMethod as Record<string, unknown>;
    const transaction = chargeResult.transaction as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: (transaction.legacyId as string) ?? (transaction.id as string),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    // Braintree webhooks come as:
    //   bt_signature: "public_key|signature_hash"
    //   bt_payload: base64-encoded XML notification
    //
    // The signature param here contains "bt_signature" value.
    // The payload param contains the bt_payload value.

    const publicKey = getPublicKey();
    const privateKey = getPrivateKey();

    // Parse bt_signature: "publicKey|signatureHash"
    const parts = signature.split('|');
    if (parts.length !== 2) {
      logger.warn('Invalid Braintree webhook signature format');
      return false;
    }

    const [sigPublicKey, sigHash] = parts;

    // Verify the public key matches
    if (sigPublicKey !== publicKey) {
      logger.warn('Braintree webhook public key mismatch');
      return false;
    }

    // Compute HMAC-SHA1 of the payload with the private key
    const expectedHash = createHmac('sha1', privateKey)
      .update(payload.toString('utf8'))
      .digest('hex');

    return expectedHash === sigHash;
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Braintree webhook payload (after base64-decoding the bt_payload):
    // XML that gets parsed into: { kind, subject: { ... } }
    // When pre-parsed to JSON, structure is:
    // { kind: "subscription_charged_successfully", subject: { subscription: {...} } }

    const kind = (payload.kind as string) ?? 'unknown';
    const subject = payload.subject as Record<string, unknown> | undefined;

    // Derive resource type from the kind (e.g., "subscription_charged_successfully" -> "subscription")
    const resourceType = kind.split('_')[0] ?? 'unknown';

    // Try to extract resource ID from subject
    let resourceId: string | undefined;
    if (subject) {
      const firstKey = Object.keys(subject)[0];
      if (firstKey) {
        const resource = subject[firstKey] as Record<string, unknown> | undefined;
        resourceId = (resource?.id as string) ?? undefined;
      }
    }

    return {
      provider: this.provider,
      event_type: kind,
      resource_type: resourceType,
      resource_id: resourceId,
      data: payload,
      timestamp: (payload.timestamp as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map a Braintree Customer to CrewShift's unified customer format.
   */
  private mapBraintreeCustomer(btCust: Record<string, unknown>): Record<string, unknown> {
    return {
      name: [btCust.firstName, btCust.lastName].filter(Boolean).join(' ') || null,
      company_name: (btCust.company as string) ?? null,
      email: (btCust.email as string) ?? null,
      phone: (btCust.phoneNumber as string) ?? null,
      address: null, // Braintree customer search doesn't return addresses by default
      external_ids: {
        braintree: (btCust.legacyId as string) ?? String(btCust.id),
      },
      source: 'braintree',
      metadata: {
        braintree_global_id: btCust.id,
        braintree_legacy_id: btCust.legacyId,
        braintree_created_at: btCust.createdAt,
        braintree_has_payment_method: !!btCust.defaultPaymentMethod,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const braintreeAdapter = new BraintreeAdapter();
registerAdapter(braintreeAdapter);
export default braintreeAdapter;
