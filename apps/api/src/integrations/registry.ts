/**
 * Integration Adapter Registry
 *
 * Central registry for all integration adapters. Keyed by provider name.
 * Adapters are registered at import time and retrieved by the OAuth service,
 * sync service, and webhook processor.
 *
 * Usage:
 *   import { getAdapter } from './registry.js';
 *   const qb = getAdapter('quickbooks');
 *   const url = qb.getAuthUrl(orgId, redirectUri);
 */

import type { IntegrationAdapter } from './adapter.interface.js';
import { logger } from '../utils/logger.js';

const adapters = new Map<string, IntegrationAdapter>();

/**
 * Register an integration adapter.
 * Called during module initialization by each adapter file.
 */
export function registerAdapter(adapter: IntegrationAdapter): void {
  if (adapters.has(adapter.provider)) {
    logger.warn({ provider: adapter.provider }, 'Adapter already registered — overwriting');
  }
  adapters.set(adapter.provider, adapter);
  logger.info({ provider: adapter.provider, tier: adapter.tier }, 'Adapter registered');
}

/**
 * Retrieve an adapter by provider name.
 * Throws if no adapter is registered for the provider.
 */
export function getAdapter(provider: string): IntegrationAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new Error(`No adapter registered for provider: ${provider}`);
  }
  return adapter;
}

/**
 * Check if an adapter is registered for a provider.
 */
export function hasAdapter(provider: string): boolean {
  return adapters.has(provider);
}

/**
 * Get all registered adapters.
 */
export function getAllAdapters(): IntegrationAdapter[] {
  return [...adapters.values()];
}

/**
 * Get all registered provider names.
 */
export function getRegisteredProviders(): string[] {
  return [...adapters.keys()];
}

// ── Adapter initialization ────────────────────────────────────────────────
// Call initAdapters() once during server bootstrap to register all adapters.
// This avoids circular dependency issues (adapters import registerAdapter
// from this module, and this module imports adapter modules).

let initialized = false;

/**
 * Initialize all integration adapters.
 * Must be called once during server startup.
 */
export async function initAdapters(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Dynamic imports break the circular dependency
  // Accounting adapters
  await import('./adapters/quickbooks.adapter.js');
  await import('./adapters/xero.adapter.js');
  await import('./adapters/freshbooks.adapter.js');
  await import('./adapters/wave.adapter.js');
  await import('./adapters/myob.adapter.js');
  await import('./adapters/zoho-books.adapter.js');
  await import('./adapters/google-calendar.adapter.js');
  await import('./adapters/calendly.adapter.js');
  await import('./adapters/acuity-scheduling.adapter.js');
  await import('./adapters/route4me.adapter.js');
  await import('./adapters/optimoroute.adapter.js');
  await import('./adapters/samsara.adapter.js');
  await import('./adapters/gps-trackit.adapter.js');
  await import('./adapters/epa-envirofacts.adapter.js');
  await import('./adapters/osha-ita.adapter.js');
  await import('./adapters/safetyculture.adapter.js');
  await import('./adapters/surveymonkey.adapter.js');
  await import('./adapters/typeform.adapter.js');
  await import('./adapters/trello.adapter.js');

  // Payment adapters
  await import('./adapters/stripe.adapter.js');
  await import('./adapters/paypal.adapter.js');
  await import('./adapters/braintree.adapter.js');
  await import('./adapters/helcim.adapter.js');
  await import('./adapters/stax.adapter.js');
  await import('./adapters/authorize-net.adapter.js');
  await import('./adapters/gocardless.adapter.js');

  // Communication adapters
  await import('./adapters/twilio.adapter.js');
  await import('./adapters/signalwire.adapter.js');
  await import('./adapters/vonage.adapter.js');
  await import('./adapters/sendgrid.adapter.js');
  await import('./adapters/postmark.adapter.js');
  await import('./adapters/mailchimp.adapter.js');
  await import('./adapters/slack.adapter.js');

  // FSM & CRM adapters (Tier 2)
  await import('./adapters/jobber.adapter.js');
  await import('./adapters/servicem8.adapter.js');
  await import('./adapters/simpro.adapter.js');
  await import('./adapters/zuper.adapter.js');
  await import('./adapters/fergus.adapter.js');
  await import('./adapters/procore.adapter.js');
  await import('./adapters/acculynx.adapter.js');
  await import('./adapters/jobnimbus.adapter.js');

  // Tier 2 — POS & Payments
  await import('./adapters/square.adapter.js');
  await import('./adapters/clover.adapter.js');

  // Tier 2 — Communication
  await import('./adapters/ringcentral.adapter.js');
  await import('./adapters/microsoft-teams.adapter.js');

  // Tier 2 — Marketing & CRM
  await import('./adapters/constant-contact.adapter.js');
  await import('./adapters/birdeye.adapter.js');

  // Tier 2 — Proposals & Documents
  await import('./adapters/pandadoc.adapter.js');
  await import('./adapters/docusign.adapter.js');

  // Tier 2 — Property & Measurement
  await import('./adapters/companycam.adapter.js');
  await import('./adapters/hover.adapter.js');
  await import('./adapters/eagleview.adapter.js');

  // Tier 2 — Construction & Takeoff
  await import('./adapters/stack-ct.adapter.js');

  // Tier 2 — Project Management
  await import('./adapters/notion.adapter.js');
  await import('./adapters/monday.adapter.js');
  await import('./adapters/asana.adapter.js');

  // Tier 2 — Government & Permits
  await import('./adapters/opengov.adapter.js');

  // Tier 3 adapters (developer application required)
  await import('./adapters/podium.adapter.js');
  await import('./adapters/nicejob.adapter.js');
  await import('./adapters/hatch.adapter.js');
  await import('./adapters/fieldedge.adapter.js');
  await import('./adapters/verizon-connect.adapter.js');
  await import('./adapters/leap.adapter.js');
  await import('./adapters/ferguson.adapter.js');
  await import('./adapters/bluebeam.adapter.js');
  await import('./adapters/accela.adapter.js');

  // Tier 4 adapters (paid plan required)
  await import('./adapters/housecall-pro.adapter.js');
  await import('./adapters/service-fusion.adapter.js');
  await import('./adapters/workiz.adapter.js');
  await import('./adapters/kickserv.adapter.js');
  await import('./adapters/fieldpulse.adapter.js');
  await import('./adapters/inflow.adapter.js');
  await import('./adapters/sortly.adapter.js');
  await import('./adapters/proposify.adapter.js');
  await import('./adapters/fleetio.adapter.js');
  await import('./adapters/sage-intacct.adapter.js');
  await import('./adapters/salesforce-field-service.adapter.js');
  await import('./adapters/dynamics-365-fs.adapter.js');

  // Tier 5 adapters (partner/enterprise programs)
  await import('./adapters/servicetitan.adapter.js');
  await import('./adapters/wepay.adapter.js');
  await import('./adapters/melio.adapter.js');
  await import('./adapters/fundbox.adapter.js');
  await import('./adapters/bench.adapter.js');
  await import('./adapters/worldpay.adapter.js');
  await import('./adapters/dispatch.adapter.js');
  await import('./adapters/next-insurance.adapter.js');
  await import('./adapters/thimble.adapter.js');
  await import('./adapters/simply-business.adapter.js');
  await import('./adapters/buildops.adapter.js');
  await import('./adapters/tyler-energov.adapter.js');

  // Tier 6 adapters (special/legacy)
  await import('./adapters/quickbooks-desktop.adapter.js');
  await import('./adapters/planswift.adapter.js');
  await import('./adapters/compliancequest.adapter.js');
  await import('./adapters/sap-fsm.adapter.js');
  await import('./adapters/rsmeans.adapter.js');
  await import('./adapters/clear-estimates.adapter.js');
  await import('./adapters/gorilladesk.adapter.js');
  await import('./adapters/zipbooks.adapter.js');
  await import('./adapters/sos-inventory.adapter.js');
  await import('./adapters/liberty-mutual-surety.adapter.js');
  await import('./adapters/merchants-bonding.adapter.js');
  await import('./adapters/interplay-learning.adapter.js');
  await import('./adapters/loc8.adapter.js');

  logger.info(
    { count: adapters.size, providers: [...adapters.keys()] },
    'All adapters initialized',
  );
}
