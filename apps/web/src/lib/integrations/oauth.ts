/* ------------------------------------------------------------------ */
/*  OAuth 2.0 Flow Utilities                                           */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Initiate an OAuth 2.0 authorization flow for a given provider.
 * Redirects the browser to the provider's auth page via the backend.
 */
export function startOAuthFlow(provider: string, redirectPath?: string): void {
  const redirectUri = `${window.location.origin}/integrations/${provider}/callback`;
  const params = new URLSearchParams({
    provider,
    redirect_uri: redirectUri,
    ...(redirectPath ? { state: redirectPath } : {}),
  });
  window.location.href = `${API_URL}/api/integrations/oauth/authorize/${provider}?${params}`;
}

/**
 * Exchange an OAuth callback code for tokens via the backend.
 */
export async function handleOAuthCallback(
  provider: string,
  code: string,
  state?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/integrations/oauth/callback/${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code, state }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.message || 'OAuth callback failed' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Disconnect an integration by provider slug.
 */
export async function disconnectIntegration(
  provider: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/integrations/${provider}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.message || 'Disconnect failed' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Test the connection for a given integration.
 */
export async function testConnection(
  provider: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/integrations/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.message || 'Connection test failed' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
