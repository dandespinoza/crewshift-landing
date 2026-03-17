/**
 * Integration Sync Service
 *
 * Orchestrates data synchronization between external systems and CrewShift.
 * Handles both inbound (External → CrewShift) and outbound (CrewShift → External) sync.
 *
 * Uses the Unified Data Model — all external data is mapped to CrewShift's
 * canonical types (Customer, Job, Invoice) regardless of source.
 *
 * See docs/09-integrations.md for sync architecture.
 */

import { logger } from '../utils/logger.js';
import { supabaseAdmin } from '../config/supabase.js';
import { getAdapter } from './registry.js';
import { decrypt } from './token-store.js';
import { eventBus, EVENTS } from '../agents/event-bus.js';
import type { SyncResult } from './adapter.interface.js';

export interface SyncOptions {
  orgId: string;
  provider: string;
  syncType: 'full' | 'incremental';
  lastSyncAt?: string;
}

export interface SyncSummary {
  provider: string;
  syncType: string;
  customers: { created: number; updated: number; errors: number };
  jobs: { created: number; updated: number; errors: number };
  invoices: { created: number; updated: number; errors: number };
  duration_ms: number;
  completed_at: string;
}

/**
 * Run a sync for a specific provider and organization.
 */
export async function runSync(options: SyncOptions): Promise<SyncSummary> {
  const startTime = Date.now();

  logger.info(
    { provider: options.provider, orgId: options.orgId, syncType: options.syncType },
    'Starting integration sync',
  );

  // 1. Load integration from DB (get encrypted tokens)
  const { data: integration, error: fetchError } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('org_id', options.orgId)
    .eq('provider', options.provider)
    .single();

  if (fetchError || !integration) {
    throw new Error(`Integration not found for ${options.provider} in org ${options.orgId}`);
  }

  if (integration.status !== 'connected' && integration.status !== 'syncing') {
    throw new Error(`Integration ${options.provider} is not connected (status: ${integration.status})`);
  }

  // 2. Decrypt tokens
  const accessToken = decrypt(integration.access_token);
  const realmId = integration.external_account_id ?? '';

  // Compose access token with realmId for QB adapter (and similar patterns)
  const compositeToken = realmId ? `${accessToken}|${realmId}` : accessToken;

  // 3. Look up adapter for provider
  const adapter = getAdapter(options.provider);

  // 4. Determine lastSyncAt for incremental sync
  const lastSyncAt = options.syncType === 'incremental'
    ? (options.lastSyncAt ?? integration.last_sync_at ?? undefined)
    : undefined;

  // 5. Run syncs
  const customerResult = await safeSync(
    () => adapter.syncCustomers(compositeToken, lastSyncAt),
    'customers',
    options.provider,
  );

  const jobResult = await safeSync(
    () => adapter.syncJobs(compositeToken, lastSyncAt),
    'jobs',
    options.provider,
  );

  const invoiceResult = await safeSync(
    () => adapter.syncInvoices(compositeToken, lastSyncAt),
    'invoices',
    options.provider,
  );

  // 6. Upsert synced records into DB
  if (customerResult.records.length > 0) {
    await upsertCustomers(options.orgId, options.provider, customerResult.records);
  }

  if (invoiceResult.records.length > 0) {
    await upsertInvoices(options.orgId, options.provider, invoiceResult.records);
  }

  // 7. Update last_sync_at on integration record
  await supabaseAdmin
    .from('integrations')
    .update({
      last_sync_at: new Date().toISOString(),
      status: 'connected',
    })
    .eq('id', integration.id);

  // 8. Create sync_log entry
  const durationMs = Date.now() - startTime;
  await supabaseAdmin.from('sync_logs').insert({
    org_id: options.orgId,
    integration_id: integration.id,
    provider: options.provider,
    sync_type: options.syncType,
    status: 'completed',
    direction: 'inbound',
    records_created: customerResult.created + jobResult.created + invoiceResult.created,
    records_updated: customerResult.updated + jobResult.updated + invoiceResult.updated,
    records_skipped: customerResult.skipped + jobResult.skipped + invoiceResult.skipped,
    records_failed: customerResult.errors.length + jobResult.errors.length + invoiceResult.errors.length,
    errors: [
      ...customerResult.errors.map((e) => ({ entity: 'customer', ...e })),
      ...jobResult.errors.map((e) => ({ entity: 'job', ...e })),
      ...invoiceResult.errors.map((e) => ({ entity: 'invoice', ...e })),
    ],
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });

  const summary: SyncSummary = {
    provider: options.provider,
    syncType: options.syncType,
    customers: {
      created: customerResult.created,
      updated: customerResult.updated,
      errors: customerResult.errors.length,
    },
    jobs: {
      created: jobResult.created,
      updated: jobResult.updated,
      errors: jobResult.errors.length,
    },
    invoices: {
      created: invoiceResult.created,
      updated: invoiceResult.updated,
      errors: invoiceResult.errors.length,
    },
    duration_ms: durationMs,
    completed_at: new Date().toISOString(),
  };

  // 9. Emit sync.complete event
  eventBus.emitEvent({
    type: EVENTS.INTEGRATION_SYNC_COMPLETE,
    orgId: options.orgId,
    data: { provider: options.provider, summary },
    source: 'sync-service',
    timestamp: new Date().toISOString(),
  });

  logger.info({ ...summary, orgId: options.orgId }, 'Integration sync complete');

  return summary;
}

/**
 * Write back a record to an external system.
 * E.g., after Invoice Agent creates an invoice, sync it to QuickBooks.
 */
export async function writeBack(
  orgId: string,
  provider: string,
  recordType: 'invoice' | 'job' | 'customer' | 'payment',
  recordData: Record<string, unknown>,
): Promise<{ externalId: string }> {
  logger.info(
    { orgId, provider, recordType },
    'Writing back to external system',
  );

  // Load integration tokens
  const { data: integration, error: fetchError } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .single();

  if (fetchError || !integration) {
    throw new Error(`Integration not found for ${provider} in org ${orgId}`);
  }

  const accessToken = decrypt(integration.access_token);
  const realmId = integration.external_account_id ?? '';
  const compositeToken = realmId ? `${accessToken}|${realmId}` : accessToken;

  const adapter = getAdapter(provider);

  switch (recordType) {
    case 'invoice': {
      const result = await adapter.createInvoice(compositeToken, recordData);
      return { externalId: result.external_id };
    }
    case 'payment': {
      const result = await adapter.createPayment(compositeToken, recordData);
      return { externalId: result.external_id };
    }
    case 'job': {
      await adapter.updateJobStatus(compositeToken, recordData.external_id as string, recordData.status as string);
      return { externalId: recordData.external_id as string };
    }
    default:
      throw new Error(`Write-back not supported for record type: ${recordType}`);
  }
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Safely run a sync function, catching errors and returning empty results on failure.
 */
async function safeSync(
  fn: () => Promise<SyncResult<Record<string, unknown>>>,
  entity: string,
  provider: string,
): Promise<SyncResult<Record<string, unknown>>> {
  try {
    return await fn();
  } catch (err) {
    logger.error({ provider, entity, err }, `Sync failed for ${entity}`);
    return { created: 0, updated: 0, skipped: 0, errors: [{ item: null, error: (err as Error).message }], records: [] };
  }
}

/**
 * Upsert synced customers into the database using the external_ids pattern.
 */
async function upsertCustomers(
  orgId: string,
  provider: string,
  records: Record<string, unknown>[],
): Promise<void> {
  for (const record of records) {
    const externalIds = record.external_ids as Record<string, string>;
    const externalId = externalIds?.[provider];

    if (!externalId) continue;

    // Check if customer already exists by external_id
    const { data: existing } = await supabaseAdmin
      .from('customers')
      .select('id, external_ids')
      .eq('org_id', orgId)
      .contains('external_ids', { [provider]: externalId })
      .single();

    if (existing) {
      // Update existing customer
      await supabaseAdmin
        .from('customers')
        .update({
          name: record.name,
          email: record.email,
          phone: record.phone,
          address: record.address,
          metadata: record.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Create new customer
      await supabaseAdmin.from('customers').insert({
        org_id: orgId,
        name: record.name,
        email: record.email,
        phone: record.phone,
        address: record.address,
        external_ids: externalIds,
        source: record.source ?? provider,
        metadata: record.metadata,
      });
    }
  }
}

/**
 * Upsert synced invoices into the database using the external_ids pattern.
 */
async function upsertInvoices(
  orgId: string,
  provider: string,
  records: Record<string, unknown>[],
): Promise<void> {
  for (const record of records) {
    const externalIds = record.external_ids as Record<string, string>;
    const externalId = externalIds?.[provider];

    if (!externalId) continue;

    // Check if invoice already exists by external_id
    const { data: existing } = await supabaseAdmin
      .from('invoices')
      .select('id, external_ids')
      .eq('org_id', orgId)
      .contains('external_ids', { [provider]: externalId })
      .single();

    if (existing) {
      await supabaseAdmin
        .from('invoices')
        .update({
          status: record.status,
          amount: record.amount,
          balance_due: record.balance_due,
          due_date: record.due_date,
          line_items: record.line_items,
          metadata: record.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin.from('invoices').insert({
        org_id: orgId,
        invoice_number: record.invoice_number,
        status: record.status ?? 'draft',
        amount: record.amount ?? 0,
        balance_due: record.balance_due ?? 0,
        due_date: record.due_date,
        issued_date: record.issued_date,
        line_items: record.line_items,
        external_ids: externalIds,
        source: record.source ?? provider,
        metadata: record.metadata,
      });
    }
  }
}
