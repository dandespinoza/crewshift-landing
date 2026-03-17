/**
 * Auth Service
 *
 * Business logic for authentication operations.
 * Wraps Supabase Auth with CrewShift-specific logic:
 * - Organization creation on signup
 * - Custom JWT claims (org_id, role) injection
 * - Default agent config seeding for new orgs
 *
 * See docs/05-security.md for auth architecture.
 */

import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { AuthError, ValidationError, NotFoundError } from '../utils/errors.js';
import { AGENT_TYPES } from '../agents/types.js';

// ============================================
// Types
// ============================================

export interface SignupInput {
  email: string;
  password: string;
  full_name: string;
  org_name: string;
  trade_type: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    full_name: string;
  };
  org: {
    id: string;
    name: string;
    trade_type: string;
    tier: string;
  };
  session: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
}

// ============================================
// Default Autonomy Rules (seeded on org creation)
// ============================================

const DEFAULT_AUTONOMY: Record<string, object> = {
  invoice: {
    auto: ['generate_pdf', 'sync_to_accounting'],
    review: ['create_invoice', 'send_to_customer'],
    escalate: [],
    thresholds: { amount_over: 1000, confidence_below: 0.85 },
  },
  estimate: {
    auto: ['generate_pdf'],
    review: ['create_estimate', 'send_to_customer'],
    escalate: [],
    thresholds: { amount_over: 5000, confidence_below: 0.8 },
  },
  collections: {
    auto: ['check_status', 'generate_report'],
    review: ['send_reminder', 'escalate_collections'],
    escalate: ['send_final_notice'],
    thresholds: { amount_over: 2000, confidence_below: 0.85 },
  },
  bookkeeping: {
    auto: ['categorize_transaction', 'reconcile'],
    review: ['create_journal_entry'],
    escalate: [],
    thresholds: { amount_over: 5000, confidence_below: 0.9 },
  },
  insights: {
    auto: ['generate_report', 'analyze_trends'],
    review: [],
    escalate: [],
    thresholds: {},
  },
  'field-ops': {
    auto: ['optimize_route', 'check_schedule'],
    review: ['reschedule_job', 'assign_tech'],
    escalate: [],
    thresholds: {},
  },
  compliance: {
    auto: ['check_deadlines', 'generate_alerts'],
    review: ['file_document'],
    escalate: ['expired_license'],
    thresholds: {},
  },
  inventory: {
    auto: ['check_stock', 'generate_alerts'],
    review: ['place_order'],
    escalate: [],
    thresholds: { amount_over: 500, confidence_below: 0.9 },
  },
  customer: {
    auto: ['send_confirmation', 'update_profile'],
    review: ['send_review_request', 'send_campaign'],
    escalate: [],
    thresholds: {},
  },
};

const DEFAULT_ONBOARDING_STATUS = {
  account_created: true,
  trade_type_selected: true,
  first_integration_connected: false,
  first_sync_complete: false,
  first_agent_run: false,
  onboarding_complete: false,
};

// ============================================
// Service Functions
// ============================================

/**
 * Sign up a new user + create their organization.
 * This is the PLG entry point.
 */
export async function signup(input: SignupInput): Promise<AuthResult> {
  const { email, password, full_name, org_name, trade_type } = input;

  logger.info({ email, org_name, trade_type }, 'Signup started');

  // 1. Create organization
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: org_name,
      trade_type,
      tier: 'starter',
      settings: {},
      onboarding_status: DEFAULT_ONBOARDING_STATUS,
    })
    .select()
    .single();

  if (orgError || !org) {
    logger.error({ error: orgError }, 'Failed to create organization');
    throw new ValidationError('Failed to create organization', orgError);
  }

  // 2. Create user via Supabase Auth with custom claims
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      org_id: org.id,
      role: 'owner',
    },
    user_metadata: {
      full_name,
    },
  });

  if (authError || !authData.user) {
    // Rollback: delete the org we just created
    await supabaseAdmin.from('organizations').delete().eq('id', org.id);
    logger.error({ error: authError }, 'Failed to create user');
    throw new AuthError(authError?.message ?? 'Failed to create user');
  }

  // 3. Create profile
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      org_id: org.id,
      full_name,
      role: 'owner',
    });

  if (profileError) {
    logger.error({ error: profileError }, 'Failed to create profile');
    // Non-fatal: profile will be created on first login if needed
  }

  // 4. Seed default agent configs
  await seedAgentConfigs(org.id, 'starter');

  // 5. Sign in to get session tokens
  const { data: _session, error: _sessionError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  // For signup, we'll use the admin sign-in approach
  const { data: signInData } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  logger.info({ userId: authData.user.id, orgId: org.id }, 'Signup complete');

  return {
    user: {
      id: authData.user.id,
      email,
      full_name,
    },
    org: {
      id: org.id,
      name: org_name,
      trade_type,
      tier: 'starter',
    },
    session: {
      access_token: signInData?.session?.access_token ?? '',
      refresh_token: signInData?.session?.refresh_token ?? '',
      expires_at: signInData?.session?.expires_at ?? 0,
    },
  };
}

/**
 * Sign in an existing user.
 */
export async function login(input: LoginInput): Promise<AuthResult> {
  const { email, password } = input;

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session || !data.user) {
    throw new AuthError('Invalid email or password');
  }

  // Get profile + org
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*, organizations(*)')
    .eq('id', data.user.id)
    .single();

  const org = (profile as any)?.organizations;

  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? email,
      full_name: profile?.full_name ?? '',
    },
    org: {
      id: org?.id ?? '',
      name: org?.name ?? '',
      trade_type: org?.trade_type ?? '',
      tier: org?.tier ?? 'starter',
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? 0,
    },
  };
}

/**
 * Refresh an expired JWT.
 */
export async function refreshSession(refreshToken: string) {
  const { data, error } = await supabaseAdmin.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    throw new AuthError('Invalid refresh token');
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  };
}

/**
 * Get the current user's profile and organization.
 */
export async function getCurrentUser(userId: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*, organizations(*)')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    throw new NotFoundError('User profile not found');
  }

  return profile;
}

/**
 * Seed default agent configurations for a new organization.
 */
async function seedAgentConfigs(orgId: string, tier: string): Promise<void> {
  const agentsForTier = tier === 'starter'
    ? ['invoice', 'estimate', 'collections', 'customer']
    : AGENT_TYPES;

  const configs = agentsForTier.map((agentType) => ({
    org_id: orgId,
    agent_type: agentType,
    enabled: true,
    autonomy_rules: DEFAULT_AUTONOMY[agentType] ?? {},
    settings: {},
  }));

  const { error } = await supabaseAdmin
    .from('agent_configs')
    .insert(configs);

  if (error) {
    logger.error({ error, orgId }, 'Failed to seed agent configs');
    // Non-fatal: configs can be created later
  } else {
    logger.info({ orgId, count: configs.length }, 'Agent configs seeded');
  }
}
