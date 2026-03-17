/**
 * Agent Runtime Types
 *
 * These types define the agent system — how agents are configured,
 * triggered, executed, and chained together.
 *
 * See docs/06-agent-runtime.md and docs/07-agent-definitions.md for full details.
 */

// ============================================
// Agent Types & Categories
// ============================================

export type AgentType =
  | 'invoice'
  | 'estimate'
  | 'collections'
  | 'bookkeeping'
  | 'insights'
  | 'field-ops'
  | 'compliance'
  | 'inventory'
  | 'customer';

export type AgentCategory = 'money-admin' | 'field-ops' | 'customer-sales' | 'growth';

export const AGENT_TYPES: AgentType[] = [
  'invoice', 'estimate', 'collections', 'bookkeeping', 'insights',
  'field-ops', 'compliance', 'inventory', 'customer',
];

export const AGENT_CATEGORIES: Record<AgentType, AgentCategory> = {
  'invoice': 'money-admin',
  'estimate': 'money-admin',
  'collections': 'money-admin',
  'bookkeeping': 'money-admin',
  'insights': 'growth',
  'field-ops': 'field-ops',
  'compliance': 'field-ops',
  'inventory': 'field-ops',
  'customer': 'customer-sales',
};

// ============================================
// Agent Definition (declarative config)
// ============================================

export interface AgentTrigger {
  type: 'event' | 'chat' | 'schedule' | 'chain';
  event?: string;
  intent?: string;
  cron?: string;
  condition?: string;
}

export interface AgentInput {
  source: 'db' | 'context' | 'integration';
  table?: string;
  fields?: string[];
  relation?: string;
  key?: string;
}

export interface AgentStep {
  id: string;
  type: 'ai_reason' | 'lookup' | 'validate' | 'integrate' | 'notify' | 'autonomy_check';
  config: Record<string, unknown>;
}

export interface AgentOutput {
  type: 'db_record' | 'external_sync' | 'pdf' | 'notification' | 'email' | 'sms';
  table?: string;
  provider?: string;
  storage?: string;
}

export interface AutonomyRules {
  auto: string[];
  review: string[];
  escalate: string[];
  thresholds?: {
    amount_over?: number;
    confidence_below?: number;
  };
}

export interface ChainRule {
  event: string;
  targets: AgentType[];
}

export interface AgentDefinition {
  type: AgentType;
  name: string;
  category: AgentCategory;
  triggers: AgentTrigger[];
  inputs: AgentInput[];
  steps: AgentStep[];
  outputs: AgentOutput[];
  autonomy: AutonomyRules;
  chains: ChainRule[];
}

// ============================================
// Execution Types
// ============================================

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

export interface AgentAction {
  type: string;
  target: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface ExecutionContext {
  orgId: string;
  userId?: string;
  requestId?: string;
  triggerType: 'event' | 'chat' | 'schedule' | 'chain';
  triggerSource: string;
  inputData: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  outputData?: Record<string, unknown>;
  actionsTaken: AgentAction[];
  confidenceScore?: number;
  error?: string;
  durationMs: number;
  aiModelUsed?: string;
  aiTokensUsed?: number;
  aiCostCents?: number;
}

// ============================================
// Event Types
// ============================================

export interface AgentEvent {
  type: string;
  orgId: string;
  data: Record<string, unknown>;
  source?: string;
  timestamp: string;
}
