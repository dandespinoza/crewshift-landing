/**
 * Human-in-the-Loop Review Queue
 *
 * When an agent's autonomy rules require human review,
 * the execution is placed in the review queue.
 *
 * Users can approve or reject pending executions.
 * Approved executions resume; rejected ones are cancelled.
 *
 * See docs/06-agent-runtime.md for autonomy rule details.
 *
 * TODO Sprint 2: Implement full review queue with DB persistence
 */

import { logger } from '../utils/logger.js';
import type { AgentType, ExecutionResult, AutonomyRules } from './types.js';

export type AutonomyDecision = 'auto' | 'review' | 'escalate';

/** Evaluate a simple comparison condition (e.g., `confidence < 0.6`). */
function evaluateCondition(actual: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case '<': return actual < threshold;
    case '<=': return actual <= threshold;
    case '>': return actual > threshold;
    case '>=': return actual >= threshold;
    case '==':
    case '===': return actual === threshold;
    default: return false;
  }
}

/**
 * Check autonomy rules to determine if an action should be
 * auto-executed, sent for review, or escalated.
 */
export function checkAutonomy(
  agentType: AgentType,
  rules: AutonomyRules,
  actionType: string,
  context: {
    amount?: number;
    confidence?: number;
  },
): AutonomyDecision {
  // Check escalation thresholds first (highest priority)
  if (rules.thresholds?.confidence_below && context.confidence !== undefined) {
    if (context.confidence < rules.thresholds.confidence_below * 0.7) {
      // Way below threshold → escalate
      logger.info({ agentType, actionType, confidence: context.confidence }, 'Autonomy: ESCALATE (low confidence)');
      return 'escalate';
    }
  }

  if (rules.thresholds?.amount_over && context.amount !== undefined) {
    if (context.amount > (rules.thresholds.amount_over * 10)) {
      // Way above threshold → escalate
      logger.info({ agentType, actionType, amount: context.amount }, 'Autonomy: ESCALATE (high amount)');
      return 'escalate';
    }
  }

  // Check explicit escalation rules
  for (const rule of rules.escalate) {
    if (rule.includes(actionType)) {
      // Check if the rule has a "where" condition
      const whereMatch = rule.match(/where\s+(\w+)\s*([<>]=?|===?)\s*([\d.]+)/);
      if (whereMatch) {
        const [, field, operator, valueStr] = whereMatch;
        const threshold = parseFloat(valueStr);
        const actual = (context as Record<string, number | undefined>)[field];
        if (actual === undefined || !evaluateCondition(actual, operator, threshold)) {
          continue; // Condition not met, skip this escalation rule
        }
      }
      logger.info({ agentType, actionType, rule }, 'Autonomy: ESCALATE (rule match)');
      return 'escalate';
    }
  }

  // Check review thresholds
  if (rules.thresholds?.confidence_below && context.confidence !== undefined) {
    if (context.confidence < rules.thresholds.confidence_below) {
      logger.info({ agentType, actionType, confidence: context.confidence }, 'Autonomy: REVIEW (below confidence threshold)');
      return 'review';
    }
  }

  if (rules.thresholds?.amount_over && context.amount !== undefined) {
    if (context.amount > rules.thresholds.amount_over) {
      logger.info({ agentType, actionType, amount: context.amount }, 'Autonomy: REVIEW (above amount threshold)');
      return 'review';
    }
  }

  // Check explicit review rules
  for (const rule of rules.review) {
    if (rule.includes(actionType)) {
      logger.info({ agentType, actionType, rule }, 'Autonomy: REVIEW (rule match)');
      return 'review';
    }
  }

  // Check auto rules
  for (const rule of rules.auto) {
    if (rule.includes(actionType)) {
      logger.info({ agentType, actionType }, 'Autonomy: AUTO');
      return 'auto';
    }
  }

  // Default to review if no rule matches
  logger.info({ agentType, actionType }, 'Autonomy: REVIEW (default)');
  return 'review';
}

/**
 * Submit an execution for human review.
 * TODO Sprint 2: Persist to DB, send notification
 */
export async function submitForReview(
  executionId: string,
  agentType: AgentType,
  orgId: string,
  _result: ExecutionResult,
): Promise<void> {
  logger.info(
    { executionId, agentType, orgId },
    'Execution submitted for review',
  );

  // TODO: Insert into agent_executions with status 'awaiting_review'
  // TODO: Create notification for org admins
}

/**
 * Approve a pending execution.
 * TODO Sprint 2: Resume execution, update status
 */
export async function approveExecution(
  executionId: string,
  reviewedBy: string,
): Promise<void> {
  logger.info({ executionId, reviewedBy }, 'Execution approved');

  // TODO: Update agent_executions status to 'approved'
  // TODO: Resume execution of remaining steps
}

/**
 * Reject a pending execution.
 * TODO Sprint 2: Cancel execution, update status
 */
export async function rejectExecution(
  executionId: string,
  reviewedBy: string,
  reason?: string,
): Promise<void> {
  logger.info({ executionId, reviewedBy, reason }, 'Execution rejected');

  // TODO: Update agent_executions status to 'rejected'
}
