/**
 * Sprint 3 — QuickBooks Adapter + Integration Infrastructure Tests
 *
 * Tests for token encryption, adapter registry, QuickBooks adapter,
 * and sync service orchestration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

// Top-level imports — these will be cached by vitest but that's fine
import { registerAdapter, getAdapter, hasAdapter, initAdapters } from '../src/integrations/registry.js';

// ============================================
// Token Encryption Tests
// ============================================

describe('Token Store — AES-256-GCM encryption', () => {
  beforeEach(() => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'a'.repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should encrypt and decrypt a string round-trip', async () => {
    const { encrypt, decrypt } = await import('../src/integrations/token-store.js');

    const plaintext = 'my-secret-access-token-12345';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);

    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for the same plaintext (random IV)', async () => {
    const { encrypt } = await import('../src/integrations/token-store.js');

    const plaintext = 'same-token-value';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);

    expect(enc1).not.toBe(enc2);
  });

  it('should encrypt and decrypt TokenSet fields', async () => {
    const { encryptTokenSet, decryptTokenSet } = await import('../src/integrations/token-store.js');

    const tokens = {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expires_at: '2025-01-01T00:00:00Z',
    };

    const encrypted = encryptTokenSet(tokens);
    expect(encrypted.access_token).not.toBe('access-123');
    expect(encrypted.refresh_token).not.toBe('refresh-456');
    expect(encrypted.expires_at).toBe('2025-01-01T00:00:00Z');

    const decrypted = decryptTokenSet(encrypted as { access_token: string; refresh_token?: string });
    expect(decrypted.access_token).toBe('access-123');
    expect(decrypted.refresh_token).toBe('refresh-456');
  });

  it('should handle tokens without refresh_token', async () => {
    const { encryptTokenSet, decryptTokenSet } = await import('../src/integrations/token-store.js');

    const tokens = { access_token: 'access-only' };

    const encrypted = encryptTokenSet(tokens);
    expect(encrypted.refresh_token).toBeUndefined();

    const decrypted = decryptTokenSet(encrypted as { access_token: string });
    expect(decrypted.access_token).toBe('access-only');
    expect(decrypted.refresh_token).toBeUndefined();
  });

  it('should throw on invalid encrypted format', async () => {
    const { decrypt } = await import('../src/integrations/token-store.js');
    expect(() => decrypt('not-valid-format')).toThrow('Invalid encrypted token format');
  });
});

// ============================================
// Adapter Registry Tests
// ============================================

describe('Adapter Registry', () => {
  // Initialize adapters (QB) before registry tests
  beforeEach(async () => {
    await initAdapters();
  });

  it('should register and retrieve an adapter', () => {
    const mockAdapter = {
      provider: 'test-provider-reg',
      tier: 'native' as const,
      getAuthUrl: () => 'https://example.com/auth',
      handleCallback: async () => ({ access_token: 'test' }),
      refreshToken: async () => ({ access_token: 'refreshed' }),
      syncCustomers: async () => ({ created: 0, updated: 0, skipped: 0, errors: [], records: [] }),
      syncJobs: async () => ({ created: 0, updated: 0, skipped: 0, errors: [], records: [] }),
      syncInvoices: async () => ({ created: 0, updated: 0, skipped: 0, errors: [], records: [] }),
      createInvoice: async () => ({ provider: 'test', external_id: '1' }),
      updateJobStatus: async () => {},
      createPayment: async () => ({ provider: 'test', external_id: '2' }),
      verifyWebhook: () => true,
      processWebhook: async () => ({
        provider: 'test',
        event_type: 'test',
        resource_type: 'test',
        data: {},
        timestamp: new Date().toISOString(),
      }),
    };

    registerAdapter(mockAdapter);

    expect(hasAdapter('test-provider-reg')).toBe(true);
    expect(getAdapter('test-provider-reg')).toBe(mockAdapter);
  });

  it('should throw when adapter not found', () => {
    expect(() => getAdapter('nonexistent-provider-xyz')).toThrow('No adapter registered');
  });

  it('should have quickbooks adapter auto-registered', () => {
    expect(hasAdapter('quickbooks')).toBe(true);

    const adapter = getAdapter('quickbooks');
    expect(adapter.provider).toBe('quickbooks');
    expect(adapter.tier).toBe('native');
  });
});

// ============================================
// QuickBooks Adapter Tests
// ============================================

describe('QuickBooks Adapter', () => {
  beforeEach(async () => {
    await initAdapters();
  });

  it('should generate correct auth URL', () => {
    vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'test-client-id');

    const adapter = getAdapter('quickbooks');
    const url = adapter.getAuthUrl('org-123', 'https://api.example.com/callback');

    expect(url).toContain('appcenter.intuit.com/connect/oauth2');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=com.intuit.quickbooks.accounting');
    expect(url).toContain('state=org-123');

    vi.unstubAllEnvs();
  });

  it('should have correct provider and tier', () => {
    const adapter = getAdapter('quickbooks');
    expect(adapter.provider).toBe('quickbooks');
    expect(adapter.tier).toBe('native');
  });

  it('should have all required methods', () => {
    const adapter = getAdapter('quickbooks');

    // OAuth methods
    expect(typeof adapter.getAuthUrl).toBe('function');
    expect(typeof adapter.handleCallback).toBe('function');
    expect(typeof adapter.refreshToken).toBe('function');

    // Sync methods
    expect(typeof adapter.syncCustomers).toBe('function');
    expect(typeof adapter.syncJobs).toBe('function');
    expect(typeof adapter.syncInvoices).toBe('function');

    // Write-back methods
    expect(typeof adapter.createInvoice).toBe('function');
    expect(typeof adapter.updateJobStatus).toBe('function');
    expect(typeof adapter.createPayment).toBe('function');

    // Webhook methods
    expect(typeof adapter.verifyWebhook).toBe('function');
    expect(typeof adapter.processWebhook).toBe('function');
  });

  it('should require token|realmId format for sync methods', async () => {
    const adapter = getAdapter('quickbooks');

    try {
      await adapter.syncCustomers('token-without-realm-id');
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('token|realmId');
    }
  });
});

// ============================================
// QuickBooks Webhook Tests
// ============================================

describe('QuickBooks Webhooks', () => {
  beforeEach(async () => {
    await initAdapters();
  });

  it('QB webhook verification should use HMAC-SHA256', () => {
    vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'test-webhook-secret');

    const adapter = getAdapter('quickbooks');

    // Invalid signature should return false
    const result = adapter.verifyWebhook(Buffer.from('test-payload'), 'invalid-signature');
    expect(typeof result).toBe('boolean');
    expect(result).toBe(false);

    // Correct HMAC signature should return true
    const payload = Buffer.from('test-payload');
    const correctSig = createHmac('sha256', 'test-webhook-secret')
      .update(payload)
      .digest('base64');

    const validResult = adapter.verifyWebhook(payload, correctSig);
    expect(validResult).toBe(true);

    vi.unstubAllEnvs();
  });

  it('QB processWebhook should parse QB webhook format', async () => {
    const adapter = getAdapter('quickbooks');

    const qbWebhookPayload = {
      eventNotifications: [
        {
          realmId: '1234567890',
          dataChangeEvent: {
            entities: [
              {
                name: 'Invoice',
                id: '123',
                operation: 'Create',
                lastUpdated: '2025-01-01T00:00:00Z',
              },
            ],
          },
        },
      ],
    };

    const event = await adapter.processWebhook(qbWebhookPayload);

    expect(event.provider).toBe('quickbooks');
    expect(event.event_type).toBe('Create');
    expect(event.resource_type).toBe('invoice');
    expect(event.resource_id).toBe('123');
  });
});

// ============================================
// Service Interface Tests
// ============================================

describe('Sync Service — interface', () => {
  it('should export runSync and writeBack', async () => {
    const syncModule = await import('../src/integrations/sync.service.js');
    expect(typeof syncModule.runSync).toBe('function');
    expect(typeof syncModule.writeBack).toBe('function');
  });
});

describe('OAuth Service — interface', () => {
  it('should export all OAuth flow functions', async () => {
    const oauthModule = await import('../src/integrations/oauth.service.js');
    expect(typeof oauthModule.startOAuthFlow).toBe('function');
    expect(typeof oauthModule.handleOAuthCallback).toBe('function');
    expect(typeof oauthModule.refreshOAuthToken).toBe('function');
    expect(typeof oauthModule.disconnectIntegration).toBe('function');
  });
});

describe('Webhook Processor — interface', () => {
  it('should export all webhook functions', async () => {
    const webhookModule = await import('../src/integrations/webhook.processor.js');
    expect(typeof webhookModule.verifyWebhookSignature).toBe('function');
    expect(typeof webhookModule.processWebhook).toBe('function');
    expect(typeof webhookModule.isDuplicate).toBe('function');
  });
});
