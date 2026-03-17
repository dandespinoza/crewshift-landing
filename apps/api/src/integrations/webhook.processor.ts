/**
 * Webhook Processor
 *
 * Handles inbound webhooks from external integration partners.
 * Verifies signatures, deduplicates, and routes to appropriate handlers.
 *
 * Webhooks return 200 immediately and enqueue for async processing.
 *
 * See docs/09-integrations.md and docs/22-error-handling.md for webhook details.
 */

import { logger } from '../utils/logger.js';
import { getAdapter, hasAdapter } from './registry.js';
import { redis } from '../config/redis.js';
import { eventBus, EVENTS } from '../agents/event-bus.js';
import type { WebhookEvent } from './adapter.interface.js';

const DEDUP_TTL_SECONDS = 86_400; // 24 hours
const DEDUP_PREFIX = 'webhook:';

/**
 * Verify a webhook signature for a specific provider.
 * Each provider uses a different signature scheme.
 */
export function verifyWebhookSignature(
  provider: string,
  payload: Buffer,
  signature: string,
): boolean {
  logger.info({ provider }, 'Verifying webhook signature');

  if (!hasAdapter(provider)) {
    logger.warn({ provider }, 'No adapter registered for webhook verification');
    return false;
  }

  const adapter = getAdapter(provider);
  return adapter.verifyWebhook(payload, signature);
}

/**
 * Process an inbound webhook payload.
 * Maps the external event to a CrewShift event and emits it.
 */
export async function processWebhook(
  provider: string,
  payload: Record<string, unknown>,
): Promise<WebhookEvent> {
  logger.info({ provider, payloadKeys: Object.keys(payload) }, 'Processing webhook');

  // 1. Look up adapter for provider
  const adapter = getAdapter(provider);

  // 2. Call adapter.processWebhook to get normalized event
  const event = await adapter.processWebhook(payload);

  // 3. Check idempotency (deduplicate by event ID)
  const eventId = generateEventId(event);
  const duplicate = await isDuplicate(provider, eventId);

  if (duplicate) {
    logger.info({ provider, eventId }, 'Duplicate webhook event — skipping');
    return event;
  }

  // Mark as processed
  await markProcessed(provider, eventId);

  // 4. Emit appropriate CrewShift event on event bus
  eventBus.emitEvent({
    type: EVENTS.WEBHOOK_RECEIVED,
    orgId: '', // Webhooks may not have orgId yet — resolver will look it up
    data: {
      provider,
      event_type: event.event_type,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      raw: payload,
    },
    source: `webhook:${provider}`,
    timestamp: event.timestamp,
  });

  logger.info(
    { provider, eventType: event.event_type, resourceType: event.resource_type },
    'Webhook processed and event emitted',
  );

  return event;
}

/**
 * Check if a webhook event has already been processed (deduplication).
 * Uses Redis with a 24-hour TTL.
 */
export async function isDuplicate(
  provider: string,
  eventId: string,
): Promise<boolean> {
  try {
    const key = `${DEDUP_PREFIX}${provider}:${eventId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (err) {
    // If Redis is down, allow the webhook through (better to process twice
    // than to drop an event)
    logger.warn({ provider, eventId, err }, 'Redis dedup check failed — allowing through');
    return false;
  }
}

/**
 * Mark a webhook event as processed in Redis.
 */
async function markProcessed(
  provider: string,
  eventId: string,
): Promise<void> {
  try {
    const key = `${DEDUP_PREFIX}${provider}:${eventId}`;
    await redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS);
  } catch (err) {
    logger.warn({ provider, eventId, err }, 'Redis dedup mark failed');
  }
}

/**
 * Generate a unique event ID for deduplication.
 * Uses the resource_id + event_type + timestamp if available,
 * falls back to a hash of the payload.
 */
function generateEventId(event: WebhookEvent): string {
  if (event.resource_id) {
    return `${event.resource_type}:${event.resource_id}:${event.event_type}`;
  }
  // Fallback: use timestamp as a rough dedup key
  return `${event.event_type}:${event.timestamp}`;
}
