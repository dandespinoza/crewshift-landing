import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const completeStepSchema = z.object({
  step: z.string().min(1).max(100),
});

// ── Default onboarding steps ───────────────────────────────────────────────

const DEFAULT_STEPS = [
  'profile_setup',
  'team_invite',
  'first_customer',
  'first_job',
  'agent_config',
  'integration_connect',
] as const;

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // GET /status — Get current onboarding state
  app.get('/status', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: org, error: fetchError } = await supabaseAdmin
        .from('organizations')
        .select('onboarding_status')
        .eq('id', request.orgId!)
        .single();

      if (fetchError || !org) {
        throw new NotFoundError('Organization not found');
      }

      // Parse onboarding_status or return default
      const onboardingStatus = org.onboarding_status ?? {
        completed_steps: [],
        is_complete: false,
        started_at: null,
      };

      return reply.send(
        success({
          ...onboardingStatus,
          all_steps: DEFAULT_STEPS,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to fetch onboarding status');
      throw new AppError(500, 'ONBOARDING_FETCH_FAILED', 'Failed to fetch onboarding status');
    }
  });

  // POST /complete-step — Mark a step as complete
  app.post('/complete-step', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(completeStepSchema, request.body);

    try {
      // Fetch current onboarding status
      const { data: org, error: fetchError } = await supabaseAdmin
        .from('organizations')
        .select('onboarding_status')
        .eq('id', request.orgId!)
        .single();

      if (fetchError || !org) {
        throw new NotFoundError('Organization not found');
      }

      const current = org.onboarding_status ?? {
        completed_steps: [],
        is_complete: false,
        started_at: new Date().toISOString(),
      };

      // Add step if not already completed
      const completedSteps: string[] = current.completed_steps ?? [];
      if (!completedSteps.includes(body.step)) {
        completedSteps.push(body.step);
      }

      // Check if all steps are complete
      const isComplete = DEFAULT_STEPS.every((step) => completedSteps.includes(step));

      const updatedStatus = {
        ...current,
        completed_steps: completedSteps,
        is_complete: isComplete,
        ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
      };

      // Update org
      const { error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({ onboarding_status: updatedStatus })
        .eq('id', request.orgId!);

      if (updateError) {
        throw new AppError(500, 'ONBOARDING_UPDATE_FAILED', updateError.message);
      }

      return reply.send(
        success({
          ...updatedStatus,
          all_steps: DEFAULT_STEPS,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to complete onboarding step');
      throw new AppError(500, 'ONBOARDING_UPDATE_FAILED', 'Failed to complete step');
    }
  });

  // POST /skip — Mark onboarding as complete (skip remaining)
  app.post('/skip', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const updatedStatus = {
        completed_steps: [...DEFAULT_STEPS], // Mark all as done
        is_complete: true,
        skipped: true,
        completed_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({ onboarding_status: updatedStatus })
        .eq('id', request.orgId!);

      if (updateError) {
        throw new AppError(500, 'ONBOARDING_SKIP_FAILED', updateError.message);
      }

      return reply.send(
        success({
          ...updatedStatus,
          all_steps: DEFAULT_STEPS,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to skip onboarding');
      throw new AppError(500, 'ONBOARDING_SKIP_FAILED', 'Failed to skip onboarding');
    }
  });
}
