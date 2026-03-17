/**
 * Utility Function Tests
 *
 * Tests for error classes, response helpers, pagination, and validators.
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  AIUnavailableError,
} from '../src/utils/errors.js';
import { success, error } from '../src/utils/response.js';
import { encodeCursor, decodeCursor, parsePaginationParams } from '../src/utils/pagination.js';
import { validate, uuidSchema, addressSchema, lineItemSchema } from '../src/utils/validators.js';

// ============================================
// Error Classes
// ============================================

describe('Error Classes', () => {
  it('should create AppError with correct properties', () => {
    const err = new AppError(400, 'TEST_ERROR', 'Test message', { field: 'name' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('Test message');
    expect(err.details).toEqual({ field: 'name' });
  });

  it('should create ValidationError with 400 status', () => {
    const err = new ValidationError('Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err).toBeInstanceOf(AppError);
  });

  it('should create AuthError with 401 status', () => {
    const err = new AuthError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_REQUIRED');
  });

  it('should create ForbiddenError with 403 status', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('should create NotFoundError with 404 status', () => {
    const err = new NotFoundError('User');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('should create ConflictError with 409 status', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });

  it('should create RateLimitError with 429 status', () => {
    const err = new RateLimitError();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('should create AIUnavailableError with 503 status', () => {
    const err = new AIUnavailableError();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('AI_UNAVAILABLE');
  });
});

// ============================================
// Response Helpers
// ============================================

describe('Response Helpers', () => {
  it('should create success response with data', () => {
    const result = success({ id: '123', name: 'Test' });
    expect(result).toEqual({ data: { id: '123', name: 'Test' } });
  });

  it('should create success response with pagination meta', () => {
    const meta = { limit: 25, has_more: true, next_cursor: 'abc123' };
    const result = success([{ id: '1' }], meta);
    expect(result).toEqual({
      data: [{ id: '1' }],
      meta: { limit: 25, has_more: true, next_cursor: 'abc123' },
    });
  });

  it('should create error response from AppError', () => {
    const err = new ValidationError('Bad input', { field: 'email' });
    const result = error(err);
    expect(result).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Bad input',
        details: { field: 'email' },
      },
    });
  });
});

// ============================================
// Pagination
// ============================================

describe('Pagination', () => {
  it('should encode and decode cursor', () => {
    const data = { id: '123', created_at: '2024-01-01T00:00:00Z' };
    const cursor = encodeCursor(data);
    expect(typeof cursor).toBe('string');
    expect(cursor.length).toBeGreaterThan(0);

    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual(data);
  });

  it('should handle malformed cursor gracefully', () => {
    const decoded = decodeCursor('not-valid-base64!');
    expect(decoded).toEqual({});
  });

  it('should parse pagination params with defaults', () => {
    const params = parsePaginationParams({});
    expect(params.limit).toBe(25);
    expect(params.sort).toBe('created_at');
    expect(params.order).toBe('desc');
    expect(params.cursor).toBeUndefined();
  });

  it('should clamp limit to max 100', () => {
    const params = parsePaginationParams({ limit: '500' });
    expect(params.limit).toBe(100);
  });

  it('should use default limit for invalid values', () => {
    const params = parsePaginationParams({ limit: '0' });
    expect(params.limit).toBe(25); // 0 is not > 0, so falls back to default
  });
});

// ============================================
// Validators
// ============================================

describe('Validators', () => {
  it('should validate UUID', () => {
    const valid = '550e8400-e29b-41d4-a716-446655440000';
    const result = validate(uuidSchema, valid);
    expect(result).toBe(valid);
  });

  it('should reject invalid UUID', () => {
    expect(() => validate(uuidSchema, 'not-a-uuid')).toThrow();
  });

  it('should validate address', () => {
    const addr = { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' };
    const result = validate(addressSchema, addr);
    expect(result).toEqual(addr);
  });

  it('should validate line item', () => {
    const item = { description: 'Labor', quantity: 2, unit_price: 75, total: 150 };
    const result = validate(lineItemSchema, item);
    expect(result).toEqual(item);
  });

  it('should throw ValidationError for invalid data', () => {
    expect(() => validate(lineItemSchema, { description: '' })).toThrow();
  });
});
