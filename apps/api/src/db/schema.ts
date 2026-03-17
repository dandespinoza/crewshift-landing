/**
 * CrewShift Database Schema — Drizzle ORM definitions
 *
 * Mirrors the SQL migration exactly. Every table, column, type, default,
 * and constraint from docs/02-database-schema.md is represented here.
 *
 * Usage:
 *   import { organizations, customers, jobs, ... } from './schema.js';
 */

import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  real,
  decimal,
  integer,
  jsonb,
  timestamp,
  date,
  unique,
  customType,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Custom type: pgvector `vector(1024)` — stored as text placeholder since
// drizzle-orm does not have native pgvector support. Use raw SQL or a
// pgvector-specific Drizzle plugin for actual similarity queries.
// ---------------------------------------------------------------------------
const vector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'vector(1024)';
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. ORGANIZATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tradeType: text('trade_type').notNull(),
  size: text('size'),
  tier: text('tier').notNull().default('starter'),
  onboardingStatus: text('onboarding_status').notNull().default('not_started'),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROFILES
// ═══════════════════════════════════════════════════════════════════════════

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(), // References auth.users(id) — FK managed at migration level
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  fullName: text('full_name'),
  role: text('role').notNull().default('member'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('pending'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  externalAccountId: text('external_account_id'),
  metadata: jsonb('metadata').default({}),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 3a. INTEGRATION OAUTH STATES
// ═══════════════════════════════════════════════════════════════════════════

export const integrationOauthStates = pgTable('integration_oauth_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: text('state').notNull().unique(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  provider: text('provider').notNull(),
  initiatedBy: uuid('initiated_by').references(() => profiles.id),
  redirectUrl: text('redirect_url'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 3b. SYNC LOGS
// ═══════════════════════════════════════════════════════════════════════════

export const syncLogs = pgTable('sync_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  integrationId: uuid('integration_id')
    .notNull()
    .references(() => integrations.id),
  provider: text('provider').notNull(),
  syncType: text('sync_type').notNull().default('incremental'),
  status: text('status').notNull().default('running'),
  direction: text('direction').notNull().default('inbound'),
  recordsCreated: integer('records_created').default(0),
  recordsUpdated: integer('records_updated').default(0),
  recordsSkipped: integer('records_skipped').default(0),
  recordsFailed: integer('records_failed').default(0),
  errors: jsonb('errors').default([]),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CUSTOMERS
// ═══════════════════════════════════════════════════════════════════════════

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  externalIds: jsonb('external_ids').default({}),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: jsonb('address'),
  tags: text('tags').array(),
  notes: text('notes'),
  paymentScore: real('payment_score'),
  lifetimeValue: decimal('lifetime_value', { precision: 12, scale: 2 }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. JOBS
// ═══════════════════════════════════════════════════════════════════════════

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  customerId: uuid('customer_id').references(() => customers.id),
  externalIds: jsonb('external_ids').default({}),
  status: text('status').notNull().default('pending'),
  type: text('type'),
  description: text('description'),
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
  actualStart: timestamp('actual_start', { withTimezone: true }),
  actualEnd: timestamp('actual_end', { withTimezone: true }),
  assignedTechId: uuid('assigned_tech_id').references(() => profiles.id),
  address: jsonb('address'),
  lineItems: jsonb('line_items').default([]),
  materials: jsonb('materials').default([]),
  laborHours: decimal('labor_hours', { precision: 6, scale: 2 }),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }),
  margin: decimal('margin', { precision: 5, scale: 2 }),
  notes: text('notes'),
  photos: text('photos').array(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. INVOICES
// ═══════════════════════════════════════════════════════════════════════════

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  jobId: uuid('job_id').references(() => jobs.id),
  customerId: uuid('customer_id').references(() => customers.id),
  externalIds: jsonb('external_ids').default({}),
  status: text('status').notNull().default('draft'),
  invoiceNumber: text('invoice_number'),
  lineItems: jsonb('line_items').notNull().default([]),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }),
  taxRate: decimal('tax_rate', { precision: 5, scale: 4 }),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }),
  total: decimal('total', { precision: 12, scale: 2 }),
  dueDate: date('due_date'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paymentMethod: text('payment_method'),
  generatedBy: text('generated_by').default('manual'),
  pdfUrl: text('pdf_url'),
  notes: text('notes'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. ESTIMATES
// ═══════════════════════════════════════════════════════════════════════════

export const estimates = pgTable('estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  customerId: uuid('customer_id').references(() => customers.id),
  externalIds: jsonb('external_ids').default({}),
  status: text('status').notNull().default('draft'),
  estimateNumber: text('estimate_number'),
  type: text('type').default('estimate'),
  lineItems: jsonb('line_items').notNull().default([]),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }),
  total: decimal('total', { precision: 12, scale: 2 }),
  validUntil: date('valid_until'),
  scopeDescription: text('scope_description'),
  photos: text('photos').array(),
  confidenceScore: real('confidence_score'),
  generatedBy: text('generated_by').default('manual'),
  pdfUrl: text('pdf_url'),
  notes: text('notes'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. PARTS (Inventory)
// ═══════════════════════════════════════════════════════════════════════════

export const parts = pgTable('parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  sku: text('sku'),
  category: text('category'),
  quantityOnHand: decimal('quantity_on_hand', { precision: 10, scale: 2 }).default('0'),
  reorderPoint: decimal('reorder_point', { precision: 10, scale: 2 }),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }),
  preferredSupplier: text('preferred_supplier'),
  supplierData: jsonb('supplier_data').default({}),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. AGENT CONFIGS
// ═══════════════════════════════════════════════════════════════════════════

export const agentConfigs = pgTable(
  'agent_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    agentType: text('agent_type').notNull(),
    enabled: boolean('enabled').default(true),
    autonomyRules: jsonb('autonomy_rules').default({}),
    settings: jsonb('settings').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueOrgAgent: unique('agent_configs_org_id_agent_type_key').on(
      table.orgId,
      table.agentType,
    ),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// 10. AGENT EXECUTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const agentExecutions = pgTable('agent_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  agentType: text('agent_type').notNull(),
  triggerType: text('trigger_type').notNull(),
  triggerSource: text('trigger_source'),
  status: text('status').notNull().default('pending'),
  inputData: jsonb('input_data'),
  outputData: jsonb('output_data'),
  actionsTaken: jsonb('actions_taken').default([]),
  confidenceScore: real('confidence_score'),
  reviewedBy: uuid('reviewed_by').references(() => profiles.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  error: text('error'),
  durationMs: integer('duration_ms'),
  aiModelUsed: text('ai_model_used'),
  aiTokensUsed: integer('ai_tokens_used'),
  aiCostCents: integer('ai_cost_cents'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id),
  title: text('title'),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  intent: text('intent'),
  agentsDispatched: text('agents_dispatched').array(),
  executionIds: text('execution_ids').array(), // Stored as text[] (uuid[] not easily available in Drizzle)
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  trigger: jsonb('trigger').notNull(),
  steps: jsonb('steps').notNull().default([]),
  enabled: boolean('enabled').default(true),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. WORKFLOW EXECUTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const workflowExecutions = pgTable('workflow_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id),
  triggerData: jsonb('trigger_data'),
  status: text('status').notNull().default('running'),
  currentStep: text('current_step'),
  stepResults: jsonb('step_results').default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. BUSINESS CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export const businessContext = pgTable(
  'business_context',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    category: text('category').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    confidence: real('confidence').default(1.0),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueOrgCategoryKey: unique('business_context_org_id_category_key_key').on(
      table.orgId,
      table.category,
      table.key,
    ),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// 16. NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  userId: uuid('user_id').references(() => profiles.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  channel: text('channel').notNull(),
  read: boolean('read').default(false),
  actionUrl: text('action_url'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. EMBEDDINGS (Vector Store)
// ═══════════════════════════════════════════════════════════════════════════

export const embeddings = pgTable('embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding'), // vector(1024) — pgvector custom type
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. TRAINING DATA (Anonymized, global)
// ═══════════════════════════════════════════════════════════════════════════

export const trainingData = pgTable('training_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataType: text('data_type').notNull(),
  tradeType: text('trade_type').notNull(),
  region: text('region'),
  data: jsonb('data').notNull(),
  orgHash: text('org_hash').notNull(),
  qualityScore: real('quality_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. DATA CONSENT
// ═══════════════════════════════════════════════════════════════════════════

export const dataConsent = pgTable('data_consent', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id),
  consented: boolean('consented').default(false),
  consentedAt: timestamp('consented_at', { withTimezone: true }),
  consentVersion: text('consent_version'),
  dataTypesAllowed: text('data_types_allowed').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. TRAINING RUNS (Global, not org-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export const trainingRuns = pgTable('training_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelName: text('model_name').notNull(),
  modelVersion: text('model_version').notNull(),
  dataTypesUsed: text('data_types_used').array(),
  recordCount: integer('record_count'),
  metrics: jsonb('metrics'),
  status: text('status').default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  profiles: many(profiles),
  integrations: many(integrations),
  customers: many(customers),
  jobs: many(jobs),
  invoices: many(invoices),
  estimates: many(estimates),
  parts: many(parts),
  agentConfigs: many(agentConfigs),
  agentExecutions: many(agentExecutions),
  conversations: many(conversations),
  workflows: many(workflows),
  workflowExecutions: many(workflowExecutions),
  businessContext: many(businessContext),
  notifications: many(notifications),
  embeddings: many(embeddings),
  dataConsent: one(dataConsent),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [profiles.orgId],
    references: [organizations.id],
  }),
  conversations: many(conversations),
  assignedJobs: many(jobs),
  reviewedExecutions: many(agentExecutions),
  notifications: many(notifications),
  createdWorkflows: many(workflows),
}));

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [integrations.orgId],
    references: [organizations.id],
  }),
  syncLogs: many(syncLogs),
}));

export const integrationOauthStatesRelations = relations(integrationOauthStates, ({ one }) => ({
  organization: one(organizations, {
    fields: [integrationOauthStates.orgId],
    references: [organizations.id],
  }),
  initiator: one(profiles, {
    fields: [integrationOauthStates.initiatedBy],
    references: [profiles.id],
  }),
}));

export const syncLogsRelations = relations(syncLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [syncLogs.orgId],
    references: [organizations.id],
  }),
  integration: one(integrations, {
    fields: [syncLogs.integrationId],
    references: [integrations.id],
  }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [customers.orgId],
    references: [organizations.id],
  }),
  jobs: many(jobs),
  invoices: many(invoices),
  estimates: many(estimates),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [jobs.orgId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [jobs.customerId],
    references: [customers.id],
  }),
  assignedTech: one(profiles, {
    fields: [jobs.assignedTechId],
    references: [profiles.id],
  }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [invoices.orgId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [invoices.jobId],
    references: [jobs.id],
  }),
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
}));

export const estimatesRelations = relations(estimates, ({ one }) => ({
  organization: one(organizations, {
    fields: [estimates.orgId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [estimates.customerId],
    references: [customers.id],
  }),
}));

export const partsRelations = relations(parts, ({ one }) => ({
  organization: one(organizations, {
    fields: [parts.orgId],
    references: [organizations.id],
  }),
}));

export const agentConfigsRelations = relations(agentConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [agentConfigs.orgId],
    references: [organizations.id],
  }),
}));

export const agentExecutionsRelations = relations(agentExecutions, ({ one }) => ({
  organization: one(organizations, {
    fields: [agentExecutions.orgId],
    references: [organizations.id],
  }),
  reviewer: one(profiles, {
    fields: [agentExecutions.reviewedBy],
    references: [profiles.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [conversations.orgId],
    references: [organizations.id],
  }),
  user: one(profiles, {
    fields: [conversations.userId],
    references: [profiles.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  organization: one(organizations, {
    fields: [messages.orgId],
    references: [organizations.id],
  }),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflows.orgId],
    references: [organizations.id],
  }),
  createdByProfile: one(profiles, {
    fields: [workflows.createdBy],
    references: [profiles.id],
  }),
  executions: many(workflowExecutions),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowExecutions.orgId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowExecutions.workflowId],
    references: [workflows.id],
  }),
}));

export const businessContextRelations = relations(businessContext, ({ one }) => ({
  organization: one(organizations, {
    fields: [businessContext.orgId],
    references: [organizations.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(organizations, {
    fields: [notifications.orgId],
    references: [organizations.id],
  }),
  user: one(profiles, {
    fields: [notifications.userId],
    references: [profiles.id],
  }),
}));

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  organization: one(organizations, {
    fields: [embeddings.orgId],
    references: [organizations.id],
  }),
}));

export const dataConsentRelations = relations(dataConsent, ({ one }) => ({
  organization: one(organizations, {
    fields: [dataConsent.orgId],
    references: [organizations.id],
  }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// INFERRED TYPES
//
// Select types represent rows read from the database.
// Insert types represent the shape required to insert a new row.
// ═══════════════════════════════════════════════════════════════════════════

// Organizations
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

// Profiles
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

// Integrations
export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

// Integration OAuth States
export type IntegrationOauthState = typeof integrationOauthStates.$inferSelect;
export type NewIntegrationOauthState = typeof integrationOauthStates.$inferInsert;

// Sync Logs
export type SyncLog = typeof syncLogs.$inferSelect;
export type NewSyncLog = typeof syncLogs.$inferInsert;

// Customers
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// Jobs
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

// Invoices
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

// Estimates
export type Estimate = typeof estimates.$inferSelect;
export type NewEstimate = typeof estimates.$inferInsert;

// Parts
export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;

// Agent Configs
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;

// Agent Executions
export type AgentExecution = typeof agentExecutions.$inferSelect;
export type NewAgentExecution = typeof agentExecutions.$inferInsert;

// Conversations
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

// Messages
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

// Workflows
export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

// Workflow Executions
export type WorkflowExecution = typeof workflowExecutions.$inferSelect;
export type NewWorkflowExecution = typeof workflowExecutions.$inferInsert;

// Business Context
export type BusinessContext = typeof businessContext.$inferSelect;
export type NewBusinessContext = typeof businessContext.$inferInsert;

// Notifications
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// Embeddings
export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;

// Training Data
export type TrainingData = typeof trainingData.$inferSelect;
export type NewTrainingData = typeof trainingData.$inferInsert;

// Data Consent
export type DataConsent = typeof dataConsent.$inferSelect;
export type NewDataConsent = typeof dataConsent.$inferInsert;

// Training Runs
export type TrainingRun = typeof trainingRuns.$inferSelect;
export type NewTrainingRun = typeof trainingRuns.$inferInsert;
