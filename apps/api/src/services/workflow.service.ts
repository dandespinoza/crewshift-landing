/**
 * Workflow Service
 *
 * Business logic for custom workflow management.
 * Workflows are user-defined automations composed of agent steps,
 * conditions, delays, notifications, and webhooks.
 *
 * See docs/11-workflow-engine.md for full workflow engine details.
 *
 * TODO Sprint 4: Full workflow execution engine
 */

import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

// ============================================
// Types
// ============================================

export interface WorkflowStep {
  id: string;
  type: 'agent' | 'condition' | 'delay' | 'notify' | 'webhook';
  config: Record<string, unknown>;
  next?: string;
}

export interface WorkflowTrigger {
  type: 'event' | 'schedule' | 'manual';
  event?: string;
  cron?: string;
  conditions?: Record<string, unknown>;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  orgId: string;
  createdBy: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  trigger?: WorkflowTrigger;
  steps?: WorkflowStep[];
  enabled?: boolean;
}

// ============================================
// Service Functions
// ============================================

/**
 * List workflows for an organization.
 */
export async function listWorkflows(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('workflows')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error }, 'Failed to list workflows');
    return [];
  }

  return data ?? [];
}

/**
 * Create a new workflow.
 */
export async function createWorkflow(input: CreateWorkflowInput) {
  // Validate steps have unique IDs
  const stepIds = input.steps.map(s => s.id);
  if (new Set(stepIds).size !== stepIds.length) {
    throw new ValidationError('Workflow steps must have unique IDs');
  }

  const { data, error } = await supabaseAdmin
    .from('workflows')
    .insert({
      org_id: input.orgId,
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      steps: input.steps,
      enabled: true,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error || !data) {
    throw new ValidationError('Failed to create workflow', error);
  }

  logger.info({ orgId: input.orgId, workflowId: data.id, name: input.name }, 'Workflow created');
  return data;
}

/**
 * Update a workflow.
 */
export async function updateWorkflow(orgId: string, workflowId: string, input: UpdateWorkflowInput) {
  const { data, error } = await supabaseAdmin
    .from('workflows')
    .update(input)
    .eq('id', workflowId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error || !data) {
    throw new NotFoundError('Workflow not found');
  }

  logger.info({ orgId, workflowId }, 'Workflow updated');
  return data;
}

/**
 * Delete a workflow.
 */
export async function deleteWorkflow(orgId: string, workflowId: string) {
  const { error } = await supabaseAdmin
    .from('workflows')
    .delete()
    .eq('id', workflowId)
    .eq('org_id', orgId);

  if (error) {
    throw new NotFoundError('Workflow not found');
  }

  logger.info({ orgId, workflowId }, 'Workflow deleted');
}

/**
 * Execute a workflow (trigger manually or from event).
 * TODO Sprint 4: Full execution engine with step runner, conditions, delays
 */
export async function executeWorkflow(orgId: string, workflowId: string, triggerData?: Record<string, unknown>) {
  // Create execution record
  const { data: execution, error } = await supabaseAdmin
    .from('workflow_executions')
    .insert({
      org_id: orgId,
      workflow_id: workflowId,
      trigger_data: triggerData ?? {},
      status: 'running',
    })
    .select()
    .single();

  if (error || !execution) {
    throw new ValidationError('Failed to start workflow execution', error);
  }

  logger.info({ orgId, workflowId, executionId: execution.id }, 'Workflow execution started (stub)');

  // TODO Sprint 4: Step runner
  // For now, immediately mark as completed
  await supabaseAdmin
    .from('workflow_executions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', execution.id);

  return execution;
}
