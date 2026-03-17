import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENTS } from '../agents/event-bus.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const providerParamSchema = z.string().min(1).max(50);

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // POST /:provider — Receive webhook from external service
  // NO auth middleware — webhooks authenticate via provider-specific signatures
  app.post<{ Params: { provider: string } }>(
    '/:provider',
    async (request, reply) => {
      const provider = validate(providerParamSchema, request.params.provider);

      try {
        // 1. Verify webhook signature (stub — each provider has its own mechanism)
        const isValid = verifyWebhookSignature(provider, request);
        if (!isValid) {
          logger.warn({ provider }, 'Webhook signature verification failed');
          return reply.status(401).send({
            error: {
              code: 'WEBHOOK_INVALID_SIGNATURE',
              message: 'Invalid webhook signature',
            },
          });
        }

        // 2. Log the webhook receipt
        logger.info(
          { provider, contentType: request.headers['content-type'] },
          `Webhook received from ${provider}`,
        );

        // 3. Emit event for async processing
        eventBus.emitEvent({
          type: EVENTS.WEBHOOK_RECEIVED,
          orgId: '', // Determined during processing from the payload
          data: {
            provider,
            headers: sanitizeHeaders(request.headers),
            body: request.body,
          },
          source: `webhook:${provider}`,
          timestamp: new Date().toISOString(),
        });

        // 4. Return 200 immediately (webhooks must respond quickly)
        return reply.status(200).send(success({ received: true }));
      } catch (err) {
        // Even on error, return 200 to avoid webhook retries that could amplify issues.
        // Log the error for debugging.
        logger.error({ err, provider }, 'Webhook processing error');
        return reply.status(200).send(success({ received: true }));
      }
    },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Stub signature verification — each provider uses a different mechanism.
 * TODO: Implement real verification per provider:
 * - Stripe: verify HMAC with STRIPE_WEBHOOK_SECRET
 * - QuickBooks: verify Intuit signature header
 * - Google: verify Google-specific tokens
 * - Twilio: verify Twilio request signature
 */
function verifyWebhookSignature(
  _provider: string,
  _request: FastifyRequest,
): boolean {
  // Stub: accept all webhooks during development
  // In production, this MUST verify the signature
  return true;
}

/**
 * Strip sensitive headers before storing in event payload.
 */
function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...headers };
  delete safe.authorization;
  delete safe.cookie;
  return safe;
}
