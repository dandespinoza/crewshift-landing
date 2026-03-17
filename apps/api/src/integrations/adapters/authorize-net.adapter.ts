/**
 * Authorize.Net Integration Adapter
 *
 * Native (Tier 1) adapter for Authorize.Net.
 * Handles Basic Auth (API Login ID + Transaction Key), customer sync,
 * payment creation, and webhooks.
 *
 * Authorize.Net API Reference:
 * - API Docs: https://developer.authorize.net/api/reference/
 * - Customer Profiles: https://developer.authorize.net/api/reference/index.html#customer-profiles
 * - Payment Transactions: https://developer.authorize.net/api/reference/index.html#payment-transactions
 * - Webhooks: https://developer.authorize.net/api/reference/features/webhooks.html
 *
 * Key details:
 * - Uses JSON API at https://api.authorize.net/xml/v1/request.api (despite the "xml" path)
 * - Every request is a POST with authentication in the JSON body
 * - Sandbox: https://apitest.authorize.net/xml/v1/request.api
 * - Webhook verification: HMAC-SHA512 using x-anet-signature header
 * - Amounts in dollars (decimal, e.g., 10.50)
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

const API_URL = 'https://api.authorize.net/xml/v1/request.api';
const SANDBOX_API_URL = 'https://apitest.authorize.net/xml/v1/request.api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSandbox(): boolean {
  return env.NODE_ENV !== 'production';
}

function getApiUrl(): string {
  return isSandbox() ? SANDBOX_API_URL : API_URL;
}

function getLoginId(): string {
  const id = process.env.AUTHORIZE_NET_LOGIN_ID ?? env.AUTHORIZE_NET_LOGIN_ID;
  if (!id) throw new Error('AUTHORIZE_NET_LOGIN_ID is not configured');
  return id;
}

function getTransactionKey(): string {
  const key = process.env.AUTHORIZE_NET_TRANSACTION_KEY ?? env.AUTHORIZE_NET_TRANSACTION_KEY;
  if (!key) throw new Error('AUTHORIZE_NET_TRANSACTION_KEY is not configured');
  return key;
}

function getSignatureKey(): string {
  const key = process.env.AUTHORIZE_NET_SIGNATURE_KEY ?? env.AUTHORIZE_NET_SIGNATURE_KEY;
  if (!key) throw new Error('AUTHORIZE_NET_SIGNATURE_KEY is not configured');
  return key;
}

/**
 * Build the merchantAuthentication block required by all Authorize.Net API calls.
 */
function getMerchantAuth(): Record<string, string> {
  return {
    name: getLoginId(),
    transactionKey: getTransactionKey(),
  };
}

/**
 * Make a request to the Authorize.Net API.
 * All Authorize.Net API calls are POST with JSON body containing authentication.
 */
async function anetRequest(
  requestBody: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = getApiUrl();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  // Authorize.Net always returns 200, errors are in the response body
  let responseText = await response.text();

  // Authorize.Net sometimes returns a BOM character at the start of the response
  if (responseText.charCodeAt(0) === 0xfeff) {
    responseText = responseText.slice(1);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    logger.error({ responseText }, 'Failed to parse Authorize.Net response');
    throw new Error(`Authorize.Net API returned invalid JSON`);
  }

  // Check for API-level errors
  const messages = data.messages as Record<string, unknown> | undefined;
  const resultCode = messages?.resultCode as string | undefined;

  if (resultCode === 'Error') {
    const messageList = (messages?.message as Array<Record<string, unknown>>) ?? [];
    const errorMsg = messageList.map((m) => `${m.code}: ${m.text}`).join('; ');
    logger.error({ messages: messageList }, 'Authorize.Net API error');
    throw new Error(`Authorize.Net API error: ${errorMsg}`);
  }

  return data;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class AuthorizeNetAdapter extends BaseAdapter {
  readonly provider = 'authorize-net' as const;
  readonly tier = 'native' as const;

  // ── OAuth (not applicable — API key auth) ──────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'Authorize.Net uses API Login ID + Transaction Key authentication, not OAuth. Configure AUTHORIZE_NET_LOGIN_ID and AUTHORIZE_NET_TRANSACTION_KEY.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('Authorize.Net uses API key authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('Authorize.Net uses API key authentication. Keys do not expire or require refresh.');
  }

  // ── Sync: Authorize.Net → CrewShift ────────────────────────────────────

  async syncCustomers(
    _accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    // Step 1: Get all customer profile IDs
    const listResponse = await anetRequest({
      getCustomerProfileIdsRequest: {
        merchantAuthentication: getMerchantAuth(),
      },
    });

    const profileIds = (listResponse.ids as string[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    let updated = 0;

    // Step 2: Fetch each customer profile individually
    for (const profileId of profileIds) {
      try {
        const profileResponse = await anetRequest({
          getCustomerProfileRequest: {
            merchantAuthentication: getMerchantAuth(),
            customerProfileId: profileId,
            includeIssuerInfo: 'true',
          },
        });

        const profile = profileResponse.profile as Record<string, unknown>;
        if (profile) {
          const mapped = this.mapAnetCustomer(profile);
          records.push(mapped);
          created++;
        }
      } catch (err) {
        errors.push({ item: { profileId }, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: profileIds.length, created, errors: errors.length },
      'Authorize.Net customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Authorize.Net ──────────────────────────────

  async createPayment(
    _accessToken: string,
    paymentData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const transactionRequest: Record<string, unknown> = {
      transactionType: 'authCaptureTransaction',
      amount: paymentData.amount,
    };

    // Payment via customer profile (tokenized)
    if (paymentData.customer_profile_id && paymentData.payment_profile_id) {
      transactionRequest.profile = {
        customerProfileId: paymentData.customer_profile_id,
        paymentProfile: {
          paymentProfileId: paymentData.payment_profile_id,
        },
      };
    }
    // Payment via raw card data
    else if (paymentData.card_number) {
      transactionRequest.payment = {
        creditCard: {
          cardNumber: paymentData.card_number,
          expirationDate: paymentData.expiration_date, // YYYY-MM
          cardCode: paymentData.cvv,
        },
      };
    }
    // Payment via opaque data (Accept.js token)
    else if (paymentData.opaque_data_value) {
      transactionRequest.payment = {
        opaqueData: {
          dataDescriptor: paymentData.opaque_data_descriptor ?? 'COMMON.ACCEPT.INAPP.PAYMENT',
          dataValue: paymentData.opaque_data_value,
        },
      };
    }

    // Optional fields
    if (paymentData.order_id || paymentData.description) {
      transactionRequest.order = {
        invoiceNumber: paymentData.order_id ?? undefined,
        description: paymentData.description ?? undefined,
      };
    }

    if (paymentData.customer_email) {
      transactionRequest.customer = {
        email: paymentData.customer_email,
      };
    }

    if (paymentData.billing_address) {
      const addr = paymentData.billing_address as Record<string, unknown>;
      transactionRequest.billTo = {
        firstName: addr.first_name ?? undefined,
        lastName: addr.last_name ?? undefined,
        company: addr.company ?? undefined,
        address: addr.street ?? undefined,
        city: addr.city ?? undefined,
        state: addr.state ?? undefined,
        zip: addr.zip ?? undefined,
        country: addr.country ?? undefined,
      };
    }

    const response = await anetRequest({
      createTransactionRequest: {
        merchantAuthentication: getMerchantAuth(),
        transactionRequest,
      },
    });

    const transactionResponse = response.transactionResponse as Record<string, unknown>;
    if (!transactionResponse) {
      throw new Error('Authorize.Net: No transaction response returned');
    }

    const responseCode = transactionResponse.responseCode as string;
    if (responseCode !== '1') {
      // 1 = Approved, 2 = Declined, 3 = Error, 4 = Held for Review
      const errorMessages = (transactionResponse.errors as Array<Record<string, unknown>>) ?? [];
      const errorText = errorMessages.map((e) => `${e.errorCode}: ${e.errorText}`).join('; ');
      throw new Error(`Authorize.Net transaction failed (code ${responseCode}): ${errorText}`);
    }

    return {
      provider: this.provider,
      external_id: String(transactionResponse.transId),
    };
  }

  async createInvoice(
    _accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    // Authorize.Net doesn't have a dedicated invoice API.
    // We create an "auth only" transaction that can be captured later,
    // effectively functioning as an invoice/hold.
    const transactionRequest: Record<string, unknown> = {
      transactionType: 'authOnlyTransaction',
      amount: invoiceData.amount,
    };

    if (invoiceData.customer_profile_id && invoiceData.payment_profile_id) {
      transactionRequest.profile = {
        customerProfileId: invoiceData.customer_profile_id,
        paymentProfile: {
          paymentProfileId: invoiceData.payment_profile_id,
        },
      };
    }

    if (invoiceData.invoice_number || invoiceData.description) {
      transactionRequest.order = {
        invoiceNumber: invoiceData.invoice_number ?? undefined,
        description: invoiceData.description ?? undefined,
      };
    }

    const response = await anetRequest({
      createTransactionRequest: {
        merchantAuthentication: getMerchantAuth(),
        transactionRequest,
      },
    });

    const transactionResponse = response.transactionResponse as Record<string, unknown>;
    if (!transactionResponse) {
      throw new Error('Authorize.Net: No transaction response returned');
    }

    return {
      provider: this.provider,
      external_id: String(transactionResponse.transId),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(payload: Buffer, signature: string): boolean {
    let sigKey: string;
    try {
      sigKey = getSignatureKey();
    } catch {
      logger.warn('No Authorize.Net signature key configured');
      return false;
    }

    // Authorize.Net webhook signature: x-anet-signature header
    // Format: "sha512=HEXDIGEST"
    // HMAC-SHA512 of the raw body using the signature key
    const sigValue = signature.startsWith('sha512=') ? signature.slice(7) : signature;

    const expectedSignature = createHmac('sha512', sigKey)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(expectedSignature.toUpperCase()),
        Buffer.from(sigValue.toUpperCase()),
      );
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    // Authorize.Net webhook structure:
    // { notificationId, eventType, eventDate, webhookId, payload: { ... } }
    const eventType = (payload.eventType as string) ?? 'unknown';
    const eventData = (payload.payload as Record<string, unknown>) ?? payload;

    // Derive resource type from event type (e.g., "net.authorize.payment.authcapture.created" -> "payment")
    const eventParts = eventType.split('.');
    // Format: net.authorize.{resource}.{action}.{status}
    const resourceType = eventParts.length >= 3 ? eventParts[2] : 'unknown';

    return {
      provider: this.provider,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: (eventData.id as string) ?? (eventData.entityName as string) ?? undefined,
      data: payload,
      timestamp: (payload.eventDate as string) ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /**
   * Map an Authorize.Net Customer Profile to CrewShift's unified customer format.
   */
  private mapAnetCustomer(profile: Record<string, unknown>): Record<string, unknown> {
    const paymentProfiles = (profile.paymentProfiles as Array<Record<string, unknown>>) ?? [];
    const firstPaymentProfile = paymentProfiles[0] as Record<string, unknown> | undefined;
    const billTo = firstPaymentProfile?.billTo as Record<string, unknown> | undefined;

    return {
      name: billTo
        ? [billTo.firstName, billTo.lastName].filter(Boolean).join(' ')
        : (profile.description as string) ?? null,
      company_name: (billTo?.company as string) ?? null,
      email: (profile.email as string) ?? null,
      phone: (billTo?.phoneNumber as string) ?? null,
      address: billTo?.address
        ? {
            street: (billTo.address as string) ?? '',
            city: (billTo.city as string) ?? '',
            state: (billTo.state as string) ?? '',
            zip: (billTo.zip as string) ?? '',
            country: (billTo.country as string) ?? '',
          }
        : null,
      external_ids: {
        'authorize-net': String(profile.customerProfileId),
      },
      source: 'authorize-net',
      metadata: {
        anet_merchant_customer_id: profile.merchantCustomerId,
        anet_description: profile.description,
        anet_payment_profile_count: paymentProfiles.length,
        anet_payment_profile_ids: paymentProfiles.map((pp) => pp.customerPaymentProfileId),
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const authorizeNetAdapter = new AuthorizeNetAdapter();
registerAdapter(authorizeNetAdapter);
export default authorizeNetAdapter;
