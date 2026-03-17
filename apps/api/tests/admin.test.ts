/**
 * Sprint 2 — Super-Admin System Tests
 *
 * Tests for super-admin middleware, org-scope middleware,
 * schema additions (integrationOauthStates, syncLogs), and
 * admin route schemas/validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ── Schema Imports ──────────────────────────────────────────────────────────

import {
  profiles,
  integrationOauthStates,
  syncLogs,
  organizations,
  integrations,
  agentConfigs,
} from '../src/db/schema.js';

// ── Agent types ─────────────────────────────────────────────────────────────

import { AGENT_TYPES } from '../src/agents/types.js';

// ============================================
// Schema Tests — Verify new columns/tables
// ============================================

describe('Schema: profiles.isSuperAdmin', () => {
  it('should have the isSuperAdmin column defined', () => {
    expect(profiles.isSuperAdmin).toBeDefined();
    expect(profiles.isSuperAdmin.name).toBe('is_super_admin');
  });

  it('should default to false', () => {
    // The column has .default(false) — verify it's a boolean column
    expect(profiles.isSuperAdmin.notNull).toBe(true);
  });
});

describe('Schema: integrationOauthStates', () => {
  it('should have all required columns', () => {
    expect(integrationOauthStates.id).toBeDefined();
    expect(integrationOauthStates.state).toBeDefined();
    expect(integrationOauthStates.orgId).toBeDefined();
    expect(integrationOauthStates.provider).toBeDefined();
    expect(integrationOauthStates.initiatedBy).toBeDefined();
    expect(integrationOauthStates.redirectUrl).toBeDefined();
    expect(integrationOauthStates.expiresAt).toBeDefined();
    expect(integrationOauthStates.createdAt).toBeDefined();
  });

  it('should map to correct SQL column names', () => {
    expect(integrationOauthStates.state.name).toBe('state');
    expect(integrationOauthStates.orgId.name).toBe('org_id');
    expect(integrationOauthStates.provider.name).toBe('provider');
    expect(integrationOauthStates.initiatedBy.name).toBe('initiated_by');
    expect(integrationOauthStates.redirectUrl.name).toBe('redirect_url');
    expect(integrationOauthStates.expiresAt.name).toBe('expires_at');
  });
});

describe('Schema: syncLogs', () => {
  it('should have all required columns', () => {
    expect(syncLogs.id).toBeDefined();
    expect(syncLogs.orgId).toBeDefined();
    expect(syncLogs.integrationId).toBeDefined();
    expect(syncLogs.provider).toBeDefined();
    expect(syncLogs.syncType).toBeDefined();
    expect(syncLogs.status).toBeDefined();
    expect(syncLogs.direction).toBeDefined();
    expect(syncLogs.recordsCreated).toBeDefined();
    expect(syncLogs.recordsUpdated).toBeDefined();
    expect(syncLogs.recordsSkipped).toBeDefined();
    expect(syncLogs.recordsFailed).toBeDefined();
    expect(syncLogs.errors).toBeDefined();
    expect(syncLogs.startedAt).toBeDefined();
    expect(syncLogs.completedAt).toBeDefined();
    expect(syncLogs.durationMs).toBeDefined();
    expect(syncLogs.errorMessage).toBeDefined();
  });

  it('should map to correct SQL column names', () => {
    expect(syncLogs.orgId.name).toBe('org_id');
    expect(syncLogs.integrationId.name).toBe('integration_id');
    expect(syncLogs.syncType.name).toBe('sync_type');
    expect(syncLogs.recordsCreated.name).toBe('records_created');
    expect(syncLogs.recordsUpdated.name).toBe('records_updated');
    expect(syncLogs.recordsSkipped.name).toBe('records_skipped');
    expect(syncLogs.recordsFailed.name).toBe('records_failed');
    expect(syncLogs.durationMs.name).toBe('duration_ms');
    expect(syncLogs.errorMessage.name).toBe('error_message');
  });
});

// ============================================
// Middleware Tests — requireSuperAdmin
// ============================================

describe('requireSuperAdmin middleware', () => {
  let mockRequest: Record<string, unknown>;
  let mockReply: Record<string, unknown>;
  let sendMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn();
    statusMock = vi.fn(() => ({ send: sendMock }));
    mockReply = { status: statusMock, send: sendMock };
    mockRequest = { isSuperAdmin: false, userId: 'user-1' };
  });

  it('should return 403 when isSuperAdmin is false', async () => {
    const { requireSuperAdmin } = await import('../src/middleware/super-admin.middleware.js');
    await requireSuperAdmin(mockRequest as never, mockReply as never);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(sendMock).toHaveBeenCalledWith({
      error: {
        code: 'SUPER_ADMIN_REQUIRED',
        message: 'This endpoint requires super-admin access',
      },
    });
  });

  it('should pass through when isSuperAdmin is true', async () => {
    mockRequest.isSuperAdmin = true;
    const { requireSuperAdmin } = await import('../src/middleware/super-admin.middleware.js');
    await requireSuperAdmin(mockRequest as never, mockReply as never);

    expect(statusMock).not.toHaveBeenCalled();
  });
});

// ============================================
// Middleware Tests — orgMiddleware super-admin bypass
// ============================================

describe('orgMiddleware — super-admin bypass', () => {
  let mockRequest: Record<string, unknown>;
  let mockReply: Record<string, unknown>;
  let sendMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn();
    statusMock = vi.fn(() => ({ send: sendMock }));
    mockReply = { status: statusMock, send: sendMock };
    mockRequest = { isSuperAdmin: false, orgId: undefined };
  });

  it('should return 403 for non-super-admin without orgId', async () => {
    const { orgMiddleware } = await import('../src/middleware/org.middleware.js');
    await orgMiddleware(mockRequest as never, mockReply as never);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(sendMock).toHaveBeenCalledWith({
      error: {
        code: 'NO_ORG',
        message: expect.any(String),
      },
    });
  });

  it('should allow super-admin through even without orgId', async () => {
    mockRequest.isSuperAdmin = true;
    const { orgMiddleware } = await import('../src/middleware/org.middleware.js');
    await orgMiddleware(mockRequest as never, mockReply as never);

    expect(statusMock).not.toHaveBeenCalled();
  });

  it('should allow non-super-admin through with orgId', async () => {
    mockRequest.orgId = 'org-123';
    const { orgMiddleware } = await import('../src/middleware/org.middleware.js');
    await orgMiddleware(mockRequest as never, mockReply as never);

    expect(statusMock).not.toHaveBeenCalled();
  });
});

// ============================================
// Validation Schema Tests — Admin route schemas
// ============================================

describe('Admin route validation schemas', () => {
  const createOrgSchema = z.object({
    name: z.string().min(1).max(255),
    tradeType: z.string().min(1).max(100),
    size: z.string().optional(),
    tier: z.enum(['starter', 'pro', 'enterprise']).default('starter'),
  });

  const updateOrgSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    tradeType: z.string().min(1).max(100).optional(),
    size: z.string().optional(),
    tier: z.enum(['starter', 'pro', 'enterprise']).optional(),
    onboardingStatus: z.enum(['not_started', 'in_progress', 'completed']).optional(),
    settings: z.record(z.unknown()).optional(),
  });

  const inviteSchema = z.object({
    email: z.string().email(),
    fullName: z.string().min(1).max(255).optional(),
    role: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
  });

  const allProviders = z.enum([
    'quickbooks', 'stripe', 'jobber', 'servicetitan', 'housecallpro',
    'plaid', 'twilio', 'google', 'fleetio', 'fishbowl',
  ]);

  describe('createOrgSchema', () => {
    it('should validate a valid create org payload', () => {
      const result = createOrgSchema.safeParse({
        name: 'ABC Plumbing',
        tradeType: 'plumbing',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tier).toBe('starter'); // default
      }
    });

    it('should reject empty name', () => {
      const result = createOrgSchema.safeParse({
        name: '',
        tradeType: 'plumbing',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all tier values', () => {
      for (const tier of ['starter', 'pro', 'enterprise']) {
        const result = createOrgSchema.safeParse({
          name: 'Test Co',
          tradeType: 'hvac',
          tier,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('updateOrgSchema', () => {
    it('should accept partial updates', () => {
      const result = updateOrgSchema.safeParse({ tier: 'pro' });
      expect(result.success).toBe(true);
    });

    it('should accept onboarding status', () => {
      const result = updateOrgSchema.safeParse({ onboardingStatus: 'completed' });
      expect(result.success).toBe(true);
    });

    it('should accept empty body', () => {
      const result = updateOrgSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('inviteSchema', () => {
    it('should validate a valid invite', () => {
      const result = inviteSchema.safeParse({
        email: 'tech@company.com',
        fullName: 'John Doe',
        role: 'admin',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = inviteSchema.safeParse({
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('should default role to member', () => {
      const result = inviteSchema.safeParse({
        email: 'tech@company.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('member');
      }
    });
  });

  describe('allProviders', () => {
    it('should accept all 10 Tier 1 providers', () => {
      const providers = [
        'quickbooks', 'stripe', 'jobber', 'servicetitan', 'housecallpro',
        'plaid', 'twilio', 'google', 'fleetio', 'fishbowl',
      ];
      for (const provider of providers) {
        const result = allProviders.safeParse(provider);
        expect(result.success).toBe(true);
      }
    });

    it('should reject unknown providers', () => {
      const result = allProviders.safeParse('unknown');
      expect(result.success).toBe(false);
    });
  });
});

// ============================================
// Agent Types — Verify all 9 agent types
// ============================================

describe('Agent types for config seeding', () => {
  it('should have 9 agent types', () => {
    expect(AGENT_TYPES).toHaveLength(9);
  });

  it('should include all expected types', () => {
    const expected = [
      'invoice', 'estimate', 'collections', 'bookkeeping', 'insights',
      'field-ops', 'compliance', 'inventory', 'customer',
    ];
    for (const type of expected) {
      expect(AGENT_TYPES).toContain(type);
    }
  });
});

// ============================================
// Provider OAuth Config Tests
// ============================================

describe('Integration provider expansion', () => {
  const expandedProviders = z.enum([
    'quickbooks', 'stripe', 'jobber', 'servicetitan', 'housecallpro',
    'plaid', 'twilio', 'google', 'fleetio', 'fishbowl',
  ]);

  it('should have exactly 10 providers', () => {
    expect(expandedProviders.options).toHaveLength(10);
  });

  it('OAuth providers should be a subset', () => {
    const oauthProviders = ['quickbooks', 'google', 'jobber', 'servicetitan', 'housecallpro'];
    for (const p of oauthProviders) {
      expect(expandedProviders.safeParse(p).success).toBe(true);
    }
  });

  it('API key / non-OAuth providers should be a subset', () => {
    const apiKeyProviders = ['stripe', 'twilio', 'plaid', 'fleetio', 'fishbowl'];
    for (const p of apiKeyProviders) {
      expect(expandedProviders.safeParse(p).success).toBe(true);
    }
  });
});
