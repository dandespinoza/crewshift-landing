import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { AuthError } from '../utils/errors.js';
import { error } from '../utils/response.js';

// ── Supabase JWT custom claims ──────────────────────────────────────────────

interface SupabaseJwtClaims extends JWTPayload {
  /** User UUID — always present in a valid Supabase JWT (the `sub` claim). */
  sub: string;
  /** Organisation UUID — stored in app_metadata.org_id. */
  app_metadata?: {
    org_id?: string;
    role?: string;
    is_super_admin?: boolean;
  };
}

// ── Fastify declaration merging ─────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated user's UUID (from the JWT `sub` claim). */
    userId: string;
    /** Organisation UUID extracted from JWT app_metadata. */
    orgId: string | undefined;
    /** User role extracted from JWT app_metadata. */
    role: string | undefined;
    /** Whether the user is a CrewShift super-admin (from JWT app_metadata). */
    isSuperAdmin: boolean;
  }
}

// ── Secret key ──────────────────────────────────────────────────────────────

/**
 * Supabase signs JWTs with an HMAC secret (HS256).  We import it once at
 * module load so we don't recreate the key object on every request.
 */
const secretKey = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Fastify `preHandler` hook that verifies the Supabase JWT from the
 * `Authorization: Bearer <token>` header **locally** (no network call).
 *
 * On success it decorates the request with `userId`, `orgId`, and `role`.
 * On failure it short-circuits with a `401 AUTH_REQUIRED` error response.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    const err = new AuthError('Missing or malformed Authorization header');
    reply.status(err.statusCode).send(error(err));
    return;
  }

  const token = header.slice(7); // strip "Bearer "

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
      // Supabase tokens have an `aud` of "authenticated"
      audience: 'authenticated',
    });

    const claims = payload as SupabaseJwtClaims;

    if (!claims.sub) {
      throw new Error('JWT missing sub claim');
    }

    request.userId = claims.sub;
    request.orgId = claims.app_metadata?.org_id;
    request.role = claims.app_metadata?.role;
    request.isSuperAdmin = claims.app_metadata?.is_super_admin === true;
  } catch (cause) {
    const err = new AuthError('Invalid or expired token');
    request.log.debug({ cause }, 'JWT verification failed');
    reply.status(err.statusCode).send(error(err));
  }
}
