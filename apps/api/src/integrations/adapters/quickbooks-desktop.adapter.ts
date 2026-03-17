/**
 * QuickBooks Desktop Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for QuickBooks Desktop.
 * Uses conductor.is as a REST wrapper for the QBXML/SOAP Web Connector.
 *
 * QuickBooks Desktop via Conductor:
 * - API Base: https://conductor.is/api/v1
 * - Conductor docs: https://conductor.is/docs
 *
 * Key details:
 * - API Key authentication via conductor.is REST wrapper
 * - Customer sync via GET /customers
 * - Invoice sync via GET /invoices
 * - Invoice creation via POST /invoices
 * - NOTE: Desktop application — not cloud. Conductor.is provides REST wrapper
 *   over QBXML/SOAP Web Connector protocol.
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

const CONDUCTOR_API_BASE = 'https://conductor.is/api/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getConductorKey(): string {
  const key = process.env.QUICKBOOKS_DESKTOP_CONDUCTOR_KEY;
  if (!key) throw new Error('QUICKBOOKS_DESKTOP_CONDUCTOR_KEY is not configured — conductor.is subscription required');
  return key;
}

/**
 * Make an authenticated request to the Conductor API (QuickBooks Desktop REST wrapper).
 */
async function conductorFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${CONDUCTOR_API_BASE}${path}`;

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
      'QuickBooks Desktop (Conductor) API error',
    );
    throw new Error(`QuickBooks Desktop (Conductor) API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class QuickBooksDesktopAdapter extends BaseAdapter {
  readonly provider = 'quickbooks-desktop' as const;
  readonly tier = 'native' as const;

  // ── Auth (API Key — no OAuth) ────────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'QuickBooks Desktop uses API Key authentication via conductor.is, not OAuth. Configure QUICKBOOKS_DESKTOP_CONDUCTOR_KEY instead.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('QuickBooks Desktop uses API Key authentication via conductor.is. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error('QuickBooks Desktop uses API Key authentication. API keys do not expire or require refresh.');
  }

  // ── Sync: QuickBooks Desktop → CrewShift ────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getConductorKey();

    const response = await conductorFetch('/customers', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const customers = (data.customers as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: cust.name ?? cust.fullName ?? null,
          company_name: cust.companyName ?? null,
          email: cust.email ?? null,
          phone: cust.phone ?? null,
          address: cust.billingAddress
            ? {
                street: (cust.billingAddress as Record<string, unknown>).line1 ?? '',
                city: (cust.billingAddress as Record<string, unknown>).city ?? '',
                state: (cust.billingAddress as Record<string, unknown>).state ?? '',
                zip: (cust.billingAddress as Record<string, unknown>).postalCode ?? '',
              }
            : null,
          external_ids: { 'quickbooks-desktop': String(cust.id ?? cust.listId) },
          source: 'quickbooks-desktop',
          metadata: {
            qbd_list_id: cust.listId,
            qbd_edit_sequence: cust.editSequence,
            qbd_is_active: cust.isActive,
            qbd_balance: cust.balance,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'QuickBooks Desktop customer sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = accessToken || getConductorKey();

    const response = await conductorFetch('/invoices', apiKey);
    const data = (await response.json()) as Record<string, unknown>;
    const invoices = (data.invoices as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const inv of invoices) {
      try {
        records.push({
          invoice_number: inv.refNumber ?? inv.txnNumber ?? null,
          status: inv.isPaid ? 'paid' : 'sent',
          amount: inv.subtotal ?? 0,
          balance_due: inv.balanceRemaining ?? 0,
          due_date: inv.dueDate ?? null,
          issued_date: inv.txnDate ?? null,
          customer_external_id: inv.customerListId ? String(inv.customerListId) : null,
          external_ids: { 'quickbooks-desktop': String(inv.id ?? inv.txnId) },
          source: 'quickbooks-desktop',
          metadata: {
            qbd_txn_id: inv.txnId,
            qbd_edit_sequence: inv.editSequence,
            qbd_class: inv.className,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'QuickBooks Desktop invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → QuickBooks Desktop ──────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const apiKey = accessToken || getConductorKey();

    const response = await conductorFetch('/invoices', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        customerListId: invoiceData.customer_external_id,
        txnDate: invoiceData.issued_date ?? new Date().toISOString().slice(0, 10),
        dueDate: invoiceData.due_date,
        refNumber: invoiceData.invoice_number,
        lineItems: (invoiceData.line_items as Array<Record<string, unknown>>)?.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          rate: item.unit_price,
          amount: item.total,
        })) ?? [],
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;

    return {
      provider: this.provider,
      external_id: String(result.id ?? result.txnId),
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new QuickBooksDesktopAdapter();
registerAdapter(adapter);
export default adapter;
