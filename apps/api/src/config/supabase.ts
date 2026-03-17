import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Public Supabase client — uses the anon key.
 *
 * Requests made through this client respect Row-Level Security (RLS).
 * Attach the user's JWT via `supabase.auth.setSession()` or by passing
 * the Authorization header so that RLS policies evaluate against the
 * authenticated user.
 */
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

/**
 * Admin Supabase client — uses the service-role key.
 *
 * This client **bypasses RLS** and should only be used for trusted
 * server-side operations (e.g. background jobs, admin endpoints, webhooks).
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);
