/**
 * ZipBooks Integration Adapter
 *
 * Tier 6 (special/legacy) adapter for ZipBooks.
 * Handles JWT token auth and invoice/contact sync.
 *
 * ZipBooks API Reference:
 * - API Base: https://api.zipbooks.com/v2
 *
 * Key details:
 * - JWT token authentication
 * - Invoice sync via GET /invoices
 * - Contact (customer) sync via GET /contacts
 * - No webhooks
 * - NOTE: Unstable API — breaking changes expected
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

const ZIPBOOKS_API_BASE = 'https://api.zipbooks.com/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = process.env.ZIPBOOKS_API_TOKEN;
  if (!token) throw new Error('ZIPBOOKS_API_TOKEN is not configured');
  return token;
}

/**
 * Make an authenticated request to the ZipBooks API.
 */
async function zipbooksFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${ZIPBOOKS_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'ZipBooks API error',
    );
    throw new Error(`ZipBooks API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class ZipBooksAdapter extends BaseAdapter {
  readonly provider = 'zipbooks' as const;
  readonly tier = 'native' as const;

  // ── Auth (JWT token — no OAuth) ──────────────────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error(
      'ZipBooks uses JWT token authentication, not OAuth. Configure ZIPBOOKS_API_TOKEN instead.',
    );
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    throw new Error('ZipBooks uses JWT token authentication, not OAuth. No callback flow required.');
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error(
      'ZipBooks uses JWT token authentication. Obtain a new token from the ZipBooks dashboard if expired.',
    );
  }

  // ── Sync: ZipBooks → CrewShift ─────────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();

    const response = await zipbooksFetch('/contacts', token);
    const data = (await response.json()) as Record<string, unknown>;
    const contacts = (data.contacts as Record<string, unknown>[]) ??
      (data.data as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const contact of contacts) {
      try {
        records.push({
          name: contact.name ?? (`${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || null),
          company_name: contact.company_name ?? null,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          address: contact.address
            ? {
                street: (contact.address as Record<string, unknown>).street ?? '',
                city: (contact.address as Record<string, unknown>).city ?? '',
                state: (contact.address as Record<string, unknown>).state ?? '',
                zip: (contact.address as Record<string, unknown>).zip ?? '',
              }
            : null,
          external_ids: { zipbooks: String(contact.id) },
          source: 'zipbooks',
          metadata: {
            zb_contact_type: contact.type,
            zb_balance: contact.balance,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: contact, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: contacts.length, created, errors: errors.length },
      'ZipBooks contact sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const token = accessToken || getApiToken();

    const response = await zipbooksFetch('/invoices', token);
    const data = (await response.json()) as Record<string, unknown>;
    const invoices = (data.invoices as Record<string, unknown>[]) ??
      (data.data as Record<string, unknown>[]) ?? [];

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    for (const inv of invoices) {
      try {
        records.push({
          invoice_number: inv.number ?? inv.invoice_number ?? null,
          status: inv.status ?? null,
          amount: inv.total ?? 0,
          balance_due: inv.balance ?? inv.amount_due ?? 0,
          due_date: inv.due_date ?? null,
          issued_date: inv.date ?? inv.created_at ?? null,
          customer_external_id: inv.contact_id ? String(inv.contact_id) : null,
          external_ids: { zipbooks: String(inv.id) },
          source: 'zipbooks',
          metadata: {
            zb_currency: inv.currency,
            zb_notes: inv.notes,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'ZipBooks invoice sync complete',
    );

    return { created, updated: 0, skipped: 0, errors, records };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new ZipBooksAdapter();
registerAdapter(adapter);
export default adapter;
