/**
 * Agent Runtime Engine
 *
 * Orchestrates agent execution: receives triggers, gathers data,
 * calls AI service, validates output, checks autonomy rules,
 * executes actions, fires chain events, and logs everything.
 *
 * This is the core brain of CrewShift's agent system.
 *
 * TODO Sprint 2: Implement full execution pipeline
 *   1. Check idempotency key
 *   2. Load agent definition from registry
 *   3. Gather input data from DB + integrations
 *   4. Call Python AI service for reasoning
 *   5. Validate output against rules
 *   6. Check autonomy rules (auto/review/escalate)
 *   7. Execute actions (write to DB, sync to external)
 *   8. Fire chain events
 *   9. Log execution in agent_executions table
 */

import { logger } from '../utils/logger.js';
import { eventBus } from './event-bus.js';
import { agentRegistry } from './registry.js';
import type {
  AgentType,
  AgentEvent,
  ExecutionContext,
  ExecutionResult,
  ExecutionStatus,
} from './types.js';

/**
 * Execute an agent with the given context.
 * This is the main entry point for agent execution.
 */
export async function executeAgent(
  agentType: AgentType,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const definition = agentRegistry.get(agentType);

  if (!definition) {
    logger.error({ agentType }, 'Agent definition not found');
    return {
      status: 'failed',
      actionsTaken: [],
      error: `Agent definition not found: ${agentType}`,
      durationMs: Date.now() - startTime,
    };
  }

  logger.info(
    {
      agentType,
      orgId: context.orgId,
      triggerType: context.triggerType,
      triggerSource: context.triggerSource,
      requestId: context.requestId,
    },
    `Executing agent: ${definition.name}`,
  );

  try {
    // TODO Sprint 2: Full execution pipeline
    // For now, return a stub result
    const result: ExecutionResult = {
      status: 'completed' as ExecutionStatus,
      outputData: { stub: true, message: `${definition.name} execution stub` },
      actionsTaken: [],
      confidenceScore: 1.0,
      durationMs: Date.now() - startTime,
      aiModelUsed: 'mock',
      aiTokensUsed: 0,
      aiCostCents: 0,
    };

    logger.info(
      { agentType, status: result.status, durationMs: result.durationMs },
      `Agent execution complete: ${definition.name}`,
    );

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { agentType, error: err.message, stack: err.stack },
      `Agent execution failed: ${definition.name}`,
    );

    return {
      status: 'failed',
      actionsTaken: [],
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Initialize the agent runtime.
 * Sets up event listeners that dispatch matching agents when events fire.
 */
export function initializeRuntime(): void {
  // Listen for all events and dispatch to matching agents
  eventBus.onAnyEvent(async (event: AgentEvent) => {
    const matchingAgents = agentRegistry.findMatchingAgents(event);

    for (const agent of matchingAgents) {
      // TODO Sprint 2: Enqueue via BullMQ instead of direct execution
      logger.info(
        { agentType: agent.type, eventType: event.type, orgId: event.orgId },
        `Dispatching agent ${agent.name} for event ${event.type}`,
      );
    }
  });

  logger.info(
    { registeredAgents: agentRegistry.size },
    'Agent runtime initialized',
  );
}

/**
 * Shutdown the agent runtime gracefully.
 */
export function shutdownRuntime(): void {
  eventBus.removeAllListeners();
  logger.info('Agent runtime shut down');
}
