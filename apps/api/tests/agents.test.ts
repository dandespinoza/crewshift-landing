/**
 * Agent Runtime Tests
 *
 * Tests for the event bus, registry, autonomy checks, and chaining.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventBus, EVENTS } from '../src/agents/event-bus.js';
import { agentRegistry } from '../src/agents/registry.js';
import { checkAutonomy } from '../src/agents/review-queue.js';
import type { AgentDefinition, AgentEvent, AutonomyRules } from '../src/agents/types.js';

// ============================================
// Test Fixtures
// ============================================

const mockInvoiceAgent: AgentDefinition = {
  type: 'invoice',
  name: 'Invoice Agent',
  category: 'money-admin',
  triggers: [
    { type: 'event', event: 'job.completed', condition: 'job.total_amount > 0' },
    { type: 'chat', intent: 'create-invoice' },
  ],
  inputs: [
    { source: 'db', table: 'jobs', fields: ['*'], relation: 'trigger.job_id' },
  ],
  steps: [
    { id: 'gather', type: 'lookup', config: {} },
    { id: 'generate', type: 'ai_reason', config: { prompt_template: 'invoice' } },
    { id: 'validate', type: 'validate', config: {} },
  ],
  outputs: [
    { type: 'db_record', table: 'invoices' },
  ],
  autonomy: {
    auto: ['generate_pdf', 'sync_to_accounting'],
    review: ['create_invoice', 'send_to_customer'],
    escalate: ['create_invoice where confidence < 0.6'],
    thresholds: { amount_over: 500, confidence_below: 0.9 },
  },
  chains: [
    { event: 'invoice.created', targets: ['collections', 'bookkeeping'] },
  ],
};

// ============================================
// Event Bus Tests
// ============================================

describe('Event Bus', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  it('should emit and receive events', () => {
    const handler = vi.fn();
    eventBus.onEvent('job.completed', handler);

    const event: AgentEvent = {
      type: 'job.completed',
      orgId: 'org-123',
      data: { jobId: 'job-456' },
      timestamp: new Date().toISOString(),
    };

    eventBus.emitEvent(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should support wildcard listener', () => {
    const handler = vi.fn();
    eventBus.onAnyEvent(handler);

    eventBus.emitEvent({
      type: 'job.completed',
      orgId: 'org-123',
      data: {},
      timestamp: new Date().toISOString(),
    });

    eventBus.emitEvent({
      type: 'invoice.created',
      orgId: 'org-123',
      data: {},
      timestamp: new Date().toISOString(),
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should have standard event constants', () => {
    expect(EVENTS.JOB_COMPLETED).toBe('job.completed');
    expect(EVENTS.INVOICE_CREATED).toBe('invoice.created');
    expect(EVENTS.ESTIMATE_REQUESTED).toBe('estimate.requested');
  });
});

// ============================================
// Agent Registry Tests
// ============================================

describe('Agent Registry', () => {
  beforeEach(() => {
    // Reset registry by registering fresh
  });

  it('should register and retrieve agent definitions', () => {
    agentRegistry.register(mockInvoiceAgent);
    const retrieved = agentRegistry.get('invoice');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Invoice Agent');
  });

  it('should find agents matching an event', () => {
    agentRegistry.register(mockInvoiceAgent);

    const event: AgentEvent = {
      type: 'job.completed',
      orgId: 'org-123',
      data: {},
      timestamp: new Date().toISOString(),
    };

    const matches = agentRegistry.findMatchingAgents(event);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some(m => m.type === 'invoice')).toBe(true);
  });

  it('should find agents by chat intent', () => {
    agentRegistry.register(mockInvoiceAgent);

    const matches = agentRegistry.findByIntent('create-invoice');
    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('invoice');
  });

  it('should return empty for unmatched intent', () => {
    agentRegistry.register(mockInvoiceAgent);
    const matches = agentRegistry.findByIntent('nonexistent-intent');
    expect(matches.length).toBe(0);
  });
});

// ============================================
// Autonomy Check Tests
// ============================================

describe('Autonomy Checks', () => {
  const rules: AutonomyRules = {
    auto: ['generate_pdf', 'sync_to_accounting'],
    review: ['create_invoice', 'send_to_customer'],
    escalate: ['create_invoice where confidence < 0.6'],
    thresholds: { amount_over: 500, confidence_below: 0.9 },
  };

  it('should return AUTO for auto-matched actions', () => {
    const decision = checkAutonomy('invoice', rules, 'generate_pdf', {});
    expect(decision).toBe('auto');
  });

  it('should return REVIEW for review-matched actions', () => {
    const decision = checkAutonomy('invoice', rules, 'create_invoice', {
      amount: 300,
      confidence: 0.95,
    });
    expect(decision).toBe('review');
  });

  it('should return REVIEW when amount exceeds threshold', () => {
    const decision = checkAutonomy('invoice', rules, 'generate_pdf', {
      amount: 600,
    });
    expect(decision).toBe('review');
  });

  it('should return REVIEW when confidence below threshold', () => {
    const decision = checkAutonomy('invoice', rules, 'generate_pdf', {
      confidence: 0.8,
    });
    expect(decision).toBe('review');
  });

  it('should return ESCALATE for very low confidence', () => {
    const decision = checkAutonomy('invoice', rules, 'create_invoice', {
      confidence: 0.5,
    });
    expect(decision).toBe('escalate');
  });

  it('should return ESCALATE for very high amounts', () => {
    const decision = checkAutonomy('invoice', rules, 'create_invoice', {
      amount: 6000,
    });
    expect(decision).toBe('escalate');
  });
});
