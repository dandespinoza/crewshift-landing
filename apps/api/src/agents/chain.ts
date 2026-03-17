/**
 * Agent Chaining
 *
 * When an agent completes, it may trigger other agents via chain rules.
 * For example: job.completed → Invoice Agent → invoice.created → Collections Agent + Bookkeeping Agent
 *
 * Chain rules are defined in each agent's definition.
 * This module reads those rules and emits the appropriate events.
 *
 * TODO Sprint 2: Implement full chaining logic
 */

import { logger } from '../utils/logger.js';
import { eventBus } from './event-bus.js';
import { agentRegistry } from './registry.js';
import type { AgentType, AgentEvent, ExecutionResult } from './types.js';

/**
 * After an agent executes successfully, fire any chain events
 * defined in the agent's definition.
 */
export function processChains(
  agentType: AgentType,
  orgId: string,
  result: ExecutionResult,
): void {
  const definition = agentRegistry.get(agentType);
  if (!definition) return;

  for (const chain of definition.chains) {
    logger.info(
      {
        sourceAgent: agentType,
        chainEvent: chain.event,
        targets: chain.targets,
        orgId,
      },
      `Firing chain event: ${chain.event}`,
    );

    const event: AgentEvent = {
      type: chain.event,
      orgId,
      data: result.outputData ?? {},
      source: `chain:${agentType}`,
      timestamp: new Date().toISOString(),
    };

    eventBus.emitEvent(event);
  }
}
