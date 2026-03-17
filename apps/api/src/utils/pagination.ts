// ── Types ───────────────────────────────────────────────────────────────────

export interface PaginationParams {
  limit: number;
  cursor?: string;
  sort: string;
  order: 'asc' | 'desc';
}

// ── Cursor helpers ──────────────────────────────────────────────────────────

/**
 * Encode an arbitrary key-value map into a URL-safe cursor string.
 *
 * The cursor is a base-64 encoded JSON object so callers can embed multiple
 * sort keys (e.g. `{ created_at: '…', id: '…' }`) without exposing the
 * underlying representation to API consumers.
 */
export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data), 'utf-8').toString('base64url');
}

/**
 * Decode a cursor previously produced by `encodeCursor`.
 *
 * Returns an empty object if the cursor is malformed so callers can treat
 * that as "start from the beginning".
 */
export function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

// ── Query param parsing ─────────────────────────────────────────────────────

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Parse common pagination / sorting query parameters.
 *
 * Accepts the raw `request.query` object (typed loosely) and returns
 * validated, clamped values.
 */
export function parsePaginationParams(
  query: Record<string, unknown>,
): PaginationParams {
  // ── limit ───────────────────────────────────────────────────────────
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // ── cursor ──────────────────────────────────────────────────────────
  const cursor =
    typeof query.cursor === 'string' && query.cursor.length > 0
      ? query.cursor
      : undefined;

  // ── sort ─────────────────────────────────────────────────────────────
  const sort =
    typeof query.sort === 'string' && query.sort.length > 0
      ? query.sort
      : 'created_at';

  // ── order ────────────────────────────────────────────────────────────
  const order: 'asc' | 'desc' =
    typeof query.order === 'string' && query.order.toLowerCase() === 'asc'
      ? 'asc'
      : 'desc';

  return { limit, cursor, sort, order };
}
