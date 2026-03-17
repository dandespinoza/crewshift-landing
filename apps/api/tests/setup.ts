/**
 * Test Setup
 *
 * Global test configuration and utilities.
 * Runs before every test suite.
 */

import { vi } from 'vitest';

// ============================================
// Mock Environment Variables
// ============================================

process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.API_URL = 'http://localhost:3001';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long-for-hs256';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:54322/postgres';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.AI_SERVICE_URL = 'http://localhost:8000';
process.env.LOG_LEVEL = 'silent';

// ============================================
// Mock External Services
// ============================================

// Mock Supabase client
vi.mock('../src/config/supabase.js', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
    })),
  },
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: vi.fn(),
        deleteUser: vi.fn(),
        updateUserById: vi.fn(),
        generateLink: vi.fn(),
      },
      signInWithPassword: vi.fn(),
      refreshSession: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
    })),
  },
}));

// Mock Redis
vi.mock('../src/config/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
  },
  createBullConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
  })),
}));
