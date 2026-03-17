import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { redis } from './config/redis.js';
import { AppError } from './utils/errors.js';
import { error as errorEnvelope } from './utils/response.js';
import { createGlobalRateLimit } from './middleware/rate-limit.js';

// ── Route plugins ──────────────────────────────────────────────────────────
import authRoutes from './routes/auth.routes.js';
import orgRoutes from './routes/org.routes.js';
import customerRoutes from './routes/customers.routes.js';
import jobRoutes from './routes/jobs.routes.js';
import invoiceRoutes from './routes/invoices.routes.js';
import estimateRoutes from './routes/estimates.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import agentRoutes from './routes/agents.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import webhookRoutes from './routes/webhooks.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import workflowRoutes from './routes/workflows.routes.js';
import integrationRoutes from './routes/integrations.routes.js';
import copilotRoutes from './routes/copilot.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import adminRoutes from './routes/admin.routes.js';

// ── Fastify declaration merging ─────────────────────────────────────────────
// NOTE: The canonical declaration merging for userId / orgId / role lives in
// middleware/auth.middleware.ts.  We re-declare here only to ensure the server
// file compiles independently if the middleware import is tree-shaken.

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    orgId: string | undefined;
    role: string | undefined;
    isSuperAdmin: boolean;
  }
}

// ── Build the Fastify instance ──────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    // Fastify v5 generates request IDs out of the box.
    // Use an incoming header if the request went through a load balancer.
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
  });

  // ── Decorate request with auth properties ───────────────────────────
  // Values are set by authMiddleware; these defaults keep TypeScript happy.
  app.decorateRequest('userId', '');
  app.decorateRequest('orgId', undefined);
  app.decorateRequest('role', undefined);
  app.decorateRequest('isSuperAdmin', false);

  // ── CORS ────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: [
      'http://localhost:3001',       // Client dashboard (dev)
      'http://localhost:3002',       // Admin panel (dev)
      'https://app.crewshift.com',   // Client dashboard (prod)
      'https://admin.crewshift.com', // Admin panel (prod)
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  // ── Rate limiting ──────────────────────────────────────────────────
  await app.register(rateLimit, {
    ...createGlobalRateLimit(),
    redis,
  });

  // ── Global error handler ──────────────────────────────────────────
  app.setErrorHandler(
    (err: Error & { statusCode?: number; validation?: unknown }, _request: FastifyRequest, reply: FastifyReply) => {
      // Known application errors
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send(errorEnvelope(err));
      }

      // Fastify validation errors (thrown by JSON Schema validation)
      if (err.validation) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: err.validation,
          },
        });
      }

      // Rate limit errors from @fastify/rate-limit
      if (err.statusCode === 429) {
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMITED',
            message: err.message || 'Rate limit exceeded',
          },
        });
      }

      // Unexpected errors — log full details but return a generic message
      app.log.error({ err }, 'Unhandled error');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message:
            env.NODE_ENV === 'production'
              ? 'An unexpected error occurred'
              : err.message,
        },
      });
    },
  );

  // ── Health check ──────────────────────────────────────────────────
  app.get('/health', async (_request, _reply) => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  }));

  // ── Route plugins ─────────────────────────────────────────────────
  await app.register(authRoutes,         { prefix: '/api/auth' });
  await app.register(orgRoutes,          { prefix: '/api/org' });
  await app.register(customerRoutes,     { prefix: '/api/customers' });
  await app.register(jobRoutes,          { prefix: '/api/jobs' });
  await app.register(invoiceRoutes,      { prefix: '/api/invoices' });
  await app.register(estimateRoutes,     { prefix: '/api/estimates' });
  await app.register(inventoryRoutes,    { prefix: '/api/inventory' });
  await app.register(agentRoutes,        { prefix: '/api/agents' });
  await app.register(dashboardRoutes,    { prefix: '/api/dashboard' });
  await app.register(webhookRoutes,      { prefix: '/api/webhooks' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(workflowRoutes,     { prefix: '/api/workflows' });
  await app.register(integrationRoutes,  { prefix: '/api/integrations' });
  await app.register(copilotRoutes,      { prefix: '/api/copilot' });
  await app.register(uploadRoutes,       { prefix: '/api/upload' });
  await app.register(onboardingRoutes,   { prefix: '/api/onboarding' });
  await app.register(adminRoutes,        { prefix: '/api/admin' });

  return app;
}

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on http://0.0.0.0:${env.PORT}`);
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }

  // ── Graceful shutdown ───────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal} — shutting down gracefully`);
    try {
      await app.close();
      await redis.quit();
      app.log.info('Server closed');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

export { buildApp };
