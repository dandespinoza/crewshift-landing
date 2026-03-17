/**
 * Agent Event Bus
 *
 * Simple in-process event emitter that triggers agent execution.
 * Events like 'job.completed', 'invoice.created', etc. are emitted here
 * and matched against agent trigger definitions.
 *
 * NOT Kafka — at this scale, an in-process EventEmitter is sufficient.
 * Events that need durability go through BullMQ jobs instead.
 *
 * See docs/06-agent-runtime.md for event → agent mapping.
 */

import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import type { AgentEvent } from './types.js';

class AgentEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // We may have many agent listeners
  }

  /**
   * Emit a typed agent event.
   * The registry listens for these and dispatches matching agents.
   */
  emitEvent(event: AgentEvent): void {
    logger.info(
      { eventType: event.type, orgId: event.orgId, source: event.source },
      `Event emitted: ${event.type}`,
    );
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard listener for logging/monitoring
  }

  /**
   * Subscribe to a specific event type.
   */
  onEvent(eventType: string, handler: (event: AgentEvent) => void | Promise<void>): void {
    this.on(eventType, handler);
  }

  /**
   * Subscribe to ALL events (for monitoring/logging).
   */
  onAnyEvent(handler: (event: AgentEvent) => void | Promise<void>): void {
    this.on('*', handler);
  }
}

/** Singleton event bus instance */
export const eventBus = new AgentEventBus();

// ============================================
// Standard Event Types
// ============================================

export const EVENTS = {
  // Job lifecycle
  JOB_CREATED: 'job.created',
  JOB_SCHEDULED: 'job.scheduled',
  JOB_STARTED: 'job.started',
  JOB_COMPLETED: 'job.completed',
  JOB_CANCELLED: 'job.cancelled',

  // Invoice lifecycle
  INVOICE_CREATED: 'invoice.created',
  INVOICE_SENT: 'invoice.sent',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_OVERDUE: 'invoice.overdue',

  // Estimate lifecycle
  ESTIMATE_CREATED: 'estimate.created',
  ESTIMATE_SENT: 'estimate.sent',
  ESTIMATE_ACCEPTED: 'estimate.accepted',
  ESTIMATE_REJECTED: 'estimate.rejected',
  ESTIMATE_REQUESTED: 'estimate.requested',

  // Customer events
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_LEAD_INBOUND: 'customer.lead.inbound',

  // Inventory events
  INVENTORY_LOW_STOCK: 'inventory.low_stock',

  // Compliance events
  COMPLIANCE_DEADLINE: 'compliance.deadline',

  // Copilot events
  COPILOT_MESSAGE: 'copilot.message',

  // Workflow events
  WORKFLOW_TRIGGER: 'workflow.trigger',

  // Integration events
  INTEGRATION_CONNECTED: 'integration.connected',
  INTEGRATION_SYNC_COMPLETE: 'integration.sync_complete',
  WEBHOOK_RECEIVED: 'webhook.received',
} as const;
