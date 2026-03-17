/**
 * OAuth2 Flow Handler
 *
 * Manages OAuth2 authorization flows for all integration adapters.
 * Handles token storage (encrypted), refresh, and revocation.
 *
 * See docs/09-integrations.md for OAuth flow details.
 */

import { logger } from '../utils/logger.js';
import { supabaseAdmin } from '../config/supabase.js';
import { getAdapter, hasAdapter } from './registry.js';
import { encrypt, decrypt } from './token-store.js';
import type { TokenSet } from './adapter.interface.js';

/**
 * Start an OAuth authorization flow for a provider.
 * Returns the authorization URL to redirect the user to.
 */
export async function startOAuthFlow(
  provider: string,
  orgId: string,
  redirectUri: string,
): Promise<string> {
  logger.info({ provider, orgId }, 'Starting OAuth flow');

  if (!hasAdapter(provider)) {
    throw new Error(`No adapter registered for provider: ${provider}`);
  }

  const adapter = getAdapter(provider);
  const authUrl = adapter.getAuthUrl(orgId, redirectUri);

  return authUrl;
}

/**
 * Handle the OAuth callback. Exchange the authorization code for tokens
 * and store them encrypted in the database.
 */
export async function handleOAuthCallback(
  provider: string,
  code: string,
  orgId: string,
): Promise<void> {
  logger.info({ provider, orgId }, 'Handling OAuth callback');

  const adapter = getAdapter(provider);

  // 1. Exchange code for tokens via adapter
  const tokens = await adapter.handleCallback(code, orgId);

  // 2. Encrypt sensitive token fields
  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

  // 3. Upsert integration record with encrypted tokens
  const { error: upsertError } = await supabaseAdmin
    .from('integrations')
    .upsert(
      {
        org_id: orgId,
        provider,
        status: 'connected',
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expires_at: tokens.expires_at ?? null,
        connected_at: new Date().toISOString(),
        last_sync_at: null,
      },
      { onConflict: 'org_id,provider' },
    );

  if (upsertError) {
    logger.error({ provider, orgId, error: upsertError }, 'Failed to store integration tokens');
    throw new Error(`Failed to store integration: ${upsertError.message}`);
  }

  logger.info({ provider, orgId }, 'OAuth callback processed — integration connected');
}

/**
 * Refresh an expired OAuth token.
 * Called proactively by the token-refresh scheduled job.
 */
export async function refreshOAuthToken(
  integrationId: string,
): Promise<TokenSet> {
  logger.info({ integrationId }, 'Refreshing OAuth token');

  // 1. Load integration from DB
  const { data: integration, error: fetchError } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('id', integrationId)
    .single();

  if (fetchError || !integration) {
    throw new Error(`Integration not found: ${integrationId}`);
  }

  // 2. Decrypt current tokens
  const currentTokens: TokenSet = {
    access_token: decrypt(integration.access_token),
    refresh_token: integration.refresh_token ? decrypt(integration.refresh_token) : undefined,
    expires_at: integration.token_expires_at ?? undefined,
  };

  // 3. Call adapter.refreshToken()
  const adapter = getAdapter(integration.provider);
  const newTokens = await adapter.refreshToken(currentTokens);

  // 4. Encrypt and store new tokens
  const newEncryptedAccessToken = encrypt(newTokens.access_token);
  const newEncryptedRefreshToken = newTokens.refresh_token
    ? encrypt(newTokens.refresh_token)
    : integration.refresh_token;

  const { error: updateError } = await supabaseAdmin
    .from('integrations')
    .update({
      access_token: newEncryptedAccessToken,
      refresh_token: newEncryptedRefreshToken,
      token_expires_at: newTokens.expires_at ?? null,
    })
    .eq('id', integrationId);

  if (updateError) {
    logger.error({ integrationId, error: updateError }, 'Failed to update refreshed tokens');
    throw new Error(`Failed to update tokens: ${updateError.message}`);
  }

  logger.info({ integrationId, provider: integration.provider }, 'OAuth token refreshed');
  return newTokens;
}

/**
 * Disconnect an integration.
 * Updates status and clears tokens.
 */
export async function disconnectIntegration(
  provider: string,
  orgId: string,
): Promise<void> {
  logger.info({ provider, orgId }, 'Disconnecting integration');

  const { error: updateError } = await supabaseAdmin
    .from('integrations')
    .update({
      status: 'disconnected',
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
    })
    .eq('org_id', orgId)
    .eq('provider', provider);

  if (updateError) {
    logger.error({ provider, orgId, error: updateError }, 'Failed to disconnect integration');
    throw new Error(`Failed to disconnect: ${updateError.message}`);
  }

  logger.info({ provider, orgId }, 'Integration disconnected');
}
