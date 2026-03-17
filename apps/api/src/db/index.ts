/**
 * Drizzle ORM database instance.
 *
 * Creates a single postgres.js connection and wraps it with drizzle-orm,
 * providing full schema awareness for type-safe relational queries.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env.js';
import * as schema from './schema.js';

// ---------------------------------------------------------------------------
// Connection — postgres.js client
// ---------------------------------------------------------------------------

const client = postgres(env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Drizzle instance — schema-aware for relational queries
// ---------------------------------------------------------------------------

export const db = drizzle(client, { schema });

/** Convenience type for the database instance (useful for dependency injection). */
export type Database = typeof db;
