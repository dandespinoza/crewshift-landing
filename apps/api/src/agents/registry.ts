/**
 * Agent Registry
 *
 * Holds all agent definitions and matches events to agents.
 * When an event fires, the registry finds which agents should respond
 * and dispatches them to the execution queue.
 *
 * Agent definitions are loaded from the definitions/ directory.
 *
 * TODO Sprint 2: Load definitions, wire up execution dispatch
 */

import { logger } from '../utils/logger.js';
import type { AgentDefinition, AgentType, AgentEvent } from './types.js';

class AgentRegistry {
  private definitions: Map<AgentType, AgentDefinition> = new Map();

  /**
   * Register an agent definition.
   */
  register(definition: AgentDefinition): void {
    this.definitions.set(definition.type, definition);
    logger.info(
      { agentType: definition.type, name: definition.name, triggers: definition.triggers.length },
      `Agent registered: ${definition.name}`,
    );
  }

  /**
   * Get a specific agent definition.
   */
  get(type: AgentType): AgentDefinition | undefined {
    return this.definitions.get(type);
  }

  /**
   * Get all registered agent definitions.
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Find which agents should be triggered by a given event.
   * Matches event type against agent trigger definitions.
   */
  findMatchingAgents(event: AgentEvent): AgentDefinition[] {
    const matches: AgentDefinition[] = [];

    for (const definition of this.definitions.values()) {
      for (const trigger of definition.triggers) {
        if (trigger.type === 'event' && trigger.event === event.type) {
          // TODO Sprint 2: Evaluate trigger.condition against event data
          matches.push(definition);
          break; // Don't add the same agent twice
        }
      }
    }

    logger.info(
      { eventType: event.type, matchCount: matches.length, matches: matches.map(m => m.type) },
      `Event matched ${matches.length} agents`,
    );

    return matches;
  }

  /**
   * Find agents that respond to a specific chat intent.
   */
  findByIntent(intent: string): AgentDefinition[] {
    const matches: AgentDefinition[] = [];

    for (const definition of this.definitions.values()) {
      for (const trigger of definition.triggers) {
        if (trigger.type === 'chat' && trigger.intent === intent) {
          matches.push(definition);
          break;
        }
      }
    }

    return matches;
  }

  /**
   * Get the count of registered agents.
   */
  get size(): number {
    return this.definitions.size;
  }
}

/** Singleton registry instance */
export const agentRegistry = new AgentRegistry();
