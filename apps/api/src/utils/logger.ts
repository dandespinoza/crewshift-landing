import pino from 'pino';
import { env } from '../config/env.js';

const isDevelopment = env.NODE_ENV === 'development';

/**
 * Structured JSON logger powered by Pino.
 *
 * In development the output is piped through `pino-pretty` for readability.
 * In production plain JSON lines are emitted so log aggregators can parse
 * them without extra work.
 */
export const logger = pino({
  level: env.LOG_LEVEL,

  // Redact sensitive headers if they ever end up in serialised requests
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },

  serializers: {
    req(request: Record<string, unknown>) {
      return {
        method: request.method,
        url: request.url,
        request_id: request.id,
        org_id: (request as Record<string, unknown>).orgId ?? undefined,
        user_id: (request as Record<string, unknown>).userId ?? undefined,
      };
    },
  },

  ...(isDevelopment
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
});
