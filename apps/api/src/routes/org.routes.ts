import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { validate, uuidSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  settings: z.record(z.unknown()).optional(),
  trade_type: z.string().min(1).max(100).optional(),
  size: z.string().max(50).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'tech']),
  full_name: z.string().min(1).max(255).optional(),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'tech']),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];
const adminOnly = [...auth, requireRole('owner', 'admin')];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function orgRoutes(app: FastifyInstance): Promise<void> {
  // GET / — Get org details
  app.get('/', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('id', request.orgId!)
        .single();

      if (orgError || !org) {
        throw new NotFoundError('Organization not found');
      }

      return reply.send(success(org));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch organization');
      throw new AppError(500, 'ORG_FETCH_FAILED', 'Failed to fetch organization');
    }
  });

  // PATCH / — Update org settings (owner, admin only)
  app.patch('/', { preHandler: adminOnly }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(updateOrgSchema, request.body);

    try {
      const { data: org, error: updateError } = await supabaseAdmin
        .from('organizations')
        .update(body)
        .eq('id', request.orgId!)
        .select()
        .single();

      if (updateError) {
        throw new AppError(500, 'ORG_UPDATE_FAILED', updateError.message);
      }

      return reply.send(success(org));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to update organization');
      throw new AppError(500, 'ORG_UPDATE_FAILED', 'Failed to update organization');
    }
  });

  // GET /team — List team members
  app.get('/team', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: members, error: membersError } = await supabaseAdmin
        .from('users')
        .select('id, email, full_name, role, avatar_url, created_at')
        .eq('org_id', request.orgId!)
        .order('created_at', { ascending: true });

      if (membersError) {
        throw new AppError(500, 'TEAM_FETCH_FAILED', membersError.message);
      }

      return reply.send(success(members ?? []));
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch team');
      throw new AppError(500, 'TEAM_FETCH_FAILED', 'Failed to fetch team members');
    }
  });

  // POST /team/invite — Invite member (owner, admin)
  app.post(
    '/team/invite',
    { preHandler: adminOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = validate(inviteMemberSchema, request.body);

      try {
        // Create user in Supabase Auth with a random password (they will reset)
        const tempPassword = crypto.randomUUID();
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: body.email,
          password: tempPassword,
          email_confirm: false,
          app_metadata: {
            org_id: request.orgId,
            role: body.role,
          },
          user_metadata: {
            full_name: body.full_name ?? '',
          },
        });

        if (authError) {
          throw new AppError(400, 'INVITE_FAILED', authError.message);
        }

        // Insert into users table
        const { data: user, error: profileError } = await supabaseAdmin
          .from('users')
          .insert({
            id: authData.user.id,
            org_id: request.orgId,
            email: body.email,
            full_name: body.full_name ?? '',
            role: body.role,
          })
          .select('id, email, full_name, role, created_at')
          .single();

        if (profileError) {
          request.log.warn({ profileError }, 'Failed to create user profile row during invite');
        }

        // TODO: Send invite email via notification service

        return reply.status(201).send(success(user ?? { id: authData.user.id, email: body.email, role: body.role }));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to invite member');
        throw new AppError(500, 'INVITE_FAILED', 'Failed to invite team member');
      }
    },
  );

  // PATCH /team/:userId — Update member role (owner, admin)
  app.patch<{ Params: { userId: string } }>(
    '/team/:userId',
    { preHandler: adminOnly },
    async (request, reply) => {
      const userId = validate(uuidSchema, request.params.userId);
      const body = validate(updateMemberRoleSchema, request.body);

      try {
        // Update in our users table
        const { data: user, error: updateError } = await supabaseAdmin
          .from('users')
          .update({ role: body.role })
          .eq('id', userId)
          .eq('org_id', request.orgId!)
          .select('id, email, full_name, role')
          .single();

        if (updateError || !user) {
          throw new NotFoundError('Team member not found');
        }

        // Also update Supabase Auth app_metadata
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { org_id: request.orgId, role: body.role },
        });

        return reply.send(success(user));
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to update member role');
        throw new AppError(500, 'ROLE_UPDATE_FAILED', 'Failed to update member role');
      }
    },
  );

  // DELETE /team/:userId — Remove member (owner, admin)
  app.delete<{ Params: { userId: string } }>(
    '/team/:userId',
    { preHandler: adminOnly },
    async (request, reply) => {
      const userId = validate(uuidSchema, request.params.userId);

      try {
        // Remove from our users table
        const { error: deleteError } = await supabaseAdmin
          .from('users')
          .delete()
          .eq('id', userId)
          .eq('org_id', request.orgId!);

        if (deleteError) {
          throw new AppError(500, 'MEMBER_REMOVE_FAILED', deleteError.message);
        }

        // Optionally: delete from Supabase Auth or just unlink org
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { org_id: null, role: null },
        });

        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to remove member');
        throw new AppError(500, 'MEMBER_REMOVE_FAILED', 'Failed to remove team member');
      }
    },
  );
}
