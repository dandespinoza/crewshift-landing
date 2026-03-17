import { z } from 'zod';
import { ValidationError } from './errors.js';

// ── Reusable atomic schemas ────────────────────────────────────────────────

/** UUID v4 string. */
export const uuidSchema = z.string().uuid();

// ── Pagination query schema ────────────────────────────────────────────────

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  sort: z.string().default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

// ── Address ────────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  zip: z.string().min(1).max(20),
});

export type Address = z.infer<typeof addressSchema>;

// ── Invoice / estimate line item ────────────────────────────────────────────

export const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
  total: z.number().nonnegative(),
});

export type LineItem = z.infer<typeof lineItemSchema>;

// ── Material ────────────────────────────────────────────────────────────────

export const materialSchema = z.object({
  part_name: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unit_cost: z.number().nonnegative(),
});

export type Material = z.infer<typeof materialSchema>;

// ── Validation helper ──────────────────────────────────────────────────────

/**
 * Validate `data` against a Zod schema.
 *
 * Returns the parsed (and possibly transformed) value on success.
 * Throws a `ValidationError` with the structured Zod issues on failure.
 *
 * ```ts
 * const body = validate(createJobSchema, request.body);
 * ```
 */
export function validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ValidationError('Validation failed', issues);
  }
  return result.data;
}
