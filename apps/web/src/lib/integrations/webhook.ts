/* ------------------------------------------------------------------ */
/*  Webhook Configuration Utilities                                     */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Generate the webhook URL for a given provider.
 * External services send events to this endpoint.
 */
export function getWebhookUrl(provider: string): string {
  return `${API_URL}/api/webhooks/${provider}`;
}

/**
 * Fetch current webhook configuration for a provider.
 */
export async function getWebhookConfig(
  provider: string,
): Promise<{ url: string; secret?: string; events?: string[]; active: boolean } | null> {
  try {
    const res = await fetch(`${API_URL}/api/integrations/${provider}/webhook`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Update webhook configuration (e.g. subscribed events).
 */
export async function updateWebhookConfig(
  provider: string,
  config: { events?: string[]; active?: boolean },
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/integrations/${provider}/webhook`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(config),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.message || 'Failed to update webhook config' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
