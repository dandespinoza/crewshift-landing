// ── Job Payload Interfaces ────────────────────────────────────────────────────
//
// Each interface describes the `data` shape that gets enqueued into the
// corresponding BullMQ queue.  Workers type-narrow on these when processing.

/**
 * Triggers an autonomous agent execution pipeline.
 * Enqueued into the `agent-execution` queue.
 */
export interface AgentExecutionJob {
  orgId: string;
  agentType: string;
  triggerType: 'event' | 'chat' | 'schedule' | 'chain';
  triggerSource: string;
  inputData: Record<string, unknown>;
  idempotencyKey: string;
  requestId?: string;
}

/**
 * Synchronises data between CrewShift and an external integration.
 * Enqueued into the `integration-sync` queue.
 */
export interface IntegrationSyncJob {
  orgId: string;
  provider: string;
  syncType: 'full' | 'incremental' | 'webhook';
  payload?: Record<string, unknown>;
}

/**
 * Sends a notification through one of the supported channels.
 * Enqueued into the `notification` queue.
 */
export interface NotificationJob {
  orgId: string;
  userId?: string;
  type: 'agent_action' | 'review_needed' | 'alert' | 'digest';
  channel: 'in_app' | 'email' | 'sms' | 'push';
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Represents a scheduled / cron job dispatched by the scheduler.
 * Enqueued into the `scheduled` queue.
 */
export interface ScheduledJob {
  name: string;
  handler: string;
  orgId?: string; // some are per-org, some are global
}

/**
 * Generates a PDF document (invoice or estimate) via Puppeteer.
 * Enqueued into the `pdf-generation` queue.
 */
export interface PDFGenerationJob {
  orgId: string;
  template: 'invoice' | 'estimate';
  recordId: string;
  recordType: 'invoice' | 'estimate';
}

// ── Union Type ────────────────────────────────────────────────────────────────

/**
 * Discriminated union of every job payload in the system.
 * Useful for generic helpers or middleware that operate across queues.
 */
export type CrewShiftJob =
  | AgentExecutionJob
  | IntegrationSyncJob
  | NotificationJob
  | ScheduledJob
  | PDFGenerationJob;
