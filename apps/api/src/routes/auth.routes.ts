import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, AuthError } from '../utils/errors.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  full_name: z.string().min(1).max(255),
  org_name: z.string().min(1).max(255),
  trade_type: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /signup — Create org + user via Supabase Auth
  app.post('/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(signupSchema, request.body);

    try {
      // 1. Create the organisation
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: body.org_name,
          trade_type: body.trade_type,
        })
        .select()
        .single();

      if (orgError) {
        throw new AppError(500, 'ORG_CREATE_FAILED', orgError.message);
      }

      // 2. Create the user via Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        app_metadata: {
          org_id: org.id,
          role: 'owner',
        },
        user_metadata: {
          full_name: body.full_name,
        },
      });

      if (authError) {
        // Clean up the org if user creation failed
        await supabaseAdmin.from('organizations').delete().eq('id', org.id);
        throw new AppError(400, 'USER_CREATE_FAILED', authError.message);
      }

      // 3. Insert into our users table
      const { error: profileError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authData.user.id,
          org_id: org.id,
          email: body.email,
          full_name: body.full_name,
          role: 'owner',
        });

      if (profileError) {
        request.log.warn({ profileError }, 'Failed to create user profile row');
      }

      return reply.status(201).send(
        success({
          user: {
            id: authData.user.id,
            email: body.email,
            full_name: body.full_name,
            role: 'owner',
          },
          org: {
            id: org.id,
            name: body.org_name,
            trade_type: body.trade_type,
          },
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Signup failed');
      throw new AppError(500, 'SIGNUP_FAILED', 'Failed to create account');
    }
  });

  // POST /login — Sign in via Supabase Auth
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(loginSchema, request.body);

    try {
      const { data, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });

      if (signInError || !data.session) {
        throw new AuthError('Invalid email or password');
      }

      return reply.send(
        success({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          user: {
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.user_metadata?.full_name,
            role: data.user.app_metadata?.role,
            org_id: data.user.app_metadata?.org_id,
          },
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Login failed');
      throw new AuthError('Invalid email or password');
    }
  });

  // POST /logout — Sign out via Supabase Auth (requires auth)
  app.post(
    '/logout',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
          request.headers.authorization!.slice(7),
        );

        if (signOutError) {
          request.log.warn({ signOutError }, 'Logout warning');
        }

        return reply.send(success({ message: 'Logged out successfully' }));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Logout failed');
        throw new AppError(500, 'LOGOUT_FAILED', 'Failed to sign out');
      }
    },
  );

  // POST /refresh — Refresh JWT
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(refreshSchema, request.body);

    try {
      const { data, error: refreshError } = await supabaseAdmin.auth.refreshSession({
        refresh_token: body.refresh_token,
      });

      if (refreshError || !data.session) {
        throw new AuthError('Invalid refresh token');
      }

      return reply.send(
        success({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AuthError('Invalid refresh token');
    }
  });

  // GET /me — Return current user profile + org (requires auth)
  app.get(
    '/me',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Fetch user profile
        const { data: user, error: userError } = await supabaseAdmin
          .from('users')
          .select('id, email, full_name, role, avatar_url, created_at')
          .eq('id', request.userId)
          .single();

        if (userError || !user) {
          throw new AuthError('User not found');
        }

        // Fetch org if user has one
        let org = null;
        if (request.orgId) {
          const { data: orgData } = await supabaseAdmin
            .from('organizations')
            .select('id, name, trade_type, settings, onboarding_status, created_at')
            .eq('id', request.orgId)
            .single();
          org = orgData;
        }

        return reply.send(success({ user, org }));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch profile');
        throw new AppError(500, 'PROFILE_FETCH_FAILED', 'Failed to fetch profile');
      }
    },
  );
}
