// ─────────────────────────────────────────────────────────────────────────────
// @crewshift/shared - Agent System Types
// ─────────────────────────────────────────────────────────────────────────────

// ── Enumerations ────────────────────────────────────────────────────────────

/** Canonical identifiers for every agent in the system. */
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

/** High-level grouping of agents by business domain. */
export type AgentCategory =
  | 'money-admin'
  | 'field-ops'
  | 'customer-sales'
  | 'growth';

// ── Agent definition building blocks ────────────────────────────────────────

/**
 * Describes what causes an agent to execute.
 * Agents can be triggered by database events, chat intents,
 * cron schedules, or chain calls from other agents.
 */
export interface AgentTrigger {
  /** The kind of trigger. */
  type: 'event' | 'chat' | 'schedule' | 'chain';
  /** Database event name (e.g. "job.completed"). Used when type is "event". */
  event?: string;
  /** NLP intent key (e.g. "generate_invoice"). Used when type is "chat". */
  intent?: string;
  /** Cron expression (e.g. "0 9 * * 1"). Used when type is "schedule". */
  cron?: string;
  /** Optional boolean expression that must be true for the trigger to fire. */
  condition?: string;
}

/**
 * Describes a single data source an agent reads during execution.
 */
export interface AgentInput {
  /** Where the data comes from. */
  source: 'db' | 'context' | 'integration';
  /** Database table name (when source is "db"). */
  table?: string;
  /** Column / field names to select. */
  fields?: string[];
  /** Related table to join (e.g. "customer"). */
  relation?: string;
  /** Context key to read from the trigger payload (when source is "context"). */
  key?: string;
}

/**
 * A single step in an agent's execution pipeline.
 * Steps run sequentially from first to last.
 */
export interface AgentStep {
  /** Unique identifier for this step within the pipeline. */
  id: string;
  /** The kind of work this step performs. */
  type:
    | 'ai_reason'
    | 'lookup'
    | 'validate'
    | 'integrate'
    | 'notify'
    | 'autonomy_check';
  /** Step-specific configuration payload. */
  config: Record<string, unknown>;
}

/**
 * Describes what an agent produces at the end of its pipeline.
 */
export interface AgentOutput {
  /** The kind of artifact produced. */
  type:
    | 'db_record'
    | 'external_sync'
    | 'pdf'
    | 'notification'
    | 'email'
    | 'sms';
  /** Target database table (when type is "db_record"). */
  table?: string;
  /** External provider key (when type is "external_sync"). */
  provider?: string;
  /** Storage bucket or path (when type is "pdf"). */
  storage?: string;
}

// ── Autonomy & chaining ─────────────────────────────────────────────────────

/**
 * Rules that govern how much latitude an agent has to act
 * without human review.
 */
export interface AutonomyRules {
  /** Actions the agent may take automatically. */
  auto: string[];
  /** Actions that require human review before execution. */
  review: string[];
  /** Actions that must be escalated to an admin / owner. */
  escalate: string[];
  /** Numeric thresholds that trigger review or escalation. */
  thresholds?: {
    /** Dollar amount above which review is required. */
    amount_over?: number;
    /** Confidence score below which review is required (0-1). */
    confidence_below?: number;
  };
}

/**
 * Defines how one agent can trigger downstream agents
 * after it finishes.
 */
export interface ChainRule {
  /** The event name this chain reacts to (e.g. "invoice.created"). */
  event: string;
  /** Agent types that should be triggered. */
  targets: AgentType[];
}

// ── Full agent definition ───────────────────────────────────────────────────

/**
 * Complete static definition of an agent.
 * This is the "blueprint" that describes what an agent does,
 * independent of any specific organization's configuration.
 */
export interface AgentDefinition {
  /** Unique agent type identifier. */
  type: AgentType;
  /** Human-readable agent name. */
  name: string;
  /** Business-domain category. */
  category: AgentCategory;
  /** Events, intents, or schedules that activate this agent. */
  triggers: AgentTrigger[];
  /** Data sources the agent reads. */
  inputs: AgentInput[];
  /** Ordered pipeline of execution steps. */
  steps: AgentStep[];
  /** Artifacts the agent produces. */
  outputs: AgentOutput[];
  /** Default autonomy rules (may be overridden per-org). */
  autonomy: AutonomyRules;
  /** Downstream agent chains fired after execution. */
  chains: ChainRule[];
}

// ── Per-org agent configuration ─────────────────────────────────────────────

/**
 * Organization-specific configuration for an agent.
 * Stored in the database and editable by admins.
 */
export interface AgentConfig {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** Which agent this config applies to. */
  agent_type: AgentType;
  /** Whether the agent is active for this org. */
  enabled: boolean;
  /** Org-level overrides for autonomy rules. */
  autonomy_rules: AutonomyRules;
  /** Additional org-specific settings (tax rate, templates, etc.). */
  settings: Record<string, unknown>;
}

// ── Execution tracking ──────────────────────────────────────────────────────

/** Possible statuses for an {@link AgentExecution}. */
export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

/**
 * A single recorded execution of an agent.
 * Provides full observability into what the agent did, how long it took,
 * how much it cost, and whether a human reviewed it.
 */
export interface AgentExecution {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** Which agent was executed. */
  agent_type: AgentType;
  /** What caused this execution to start. */
  trigger_type: string;
  /** Identifier of the specific trigger source (event id, chat message, etc.). */
  trigger_source: string;
  /** Current execution lifecycle status. */
  status: AgentExecutionStatus;
  /** Snapshot of the data fed into the agent. */
  input_data: Record<string, unknown>;
  /** Snapshot of the data produced by the agent. */
  output_data: Record<string, unknown>;
  /** List of discrete actions the agent performed. */
  actions_taken: string[];
  /** AI confidence score for the output (0-1). */
  confidence_score: number;
  /** UUID of the user who reviewed this execution (if applicable). */
  reviewed_by: string;
  /** ISO 8601 timestamp of when the review occurred. */
  reviewed_at: string;
  /** Error message if the execution failed. */
  error: string;
  /** Wall-clock duration of the execution in milliseconds. */
  duration_ms: number;
  /** The AI model used for reasoning (e.g. "gpt-4o", "claude-sonnet-4"). */
  ai_model_used: string;
  /** Total token count consumed by the AI model. */
  ai_tokens_used: number;
  /** Estimated cost in cents for the AI usage. */
  ai_cost_cents: number;
  /** ISO 8601 timestamp when the execution was created / queued. */
  created_at: string;
  /** ISO 8601 timestamp when the execution finished. */
  completed_at: string;
}

/**
 * An execution record enriched with organization details,
 * intended for the admin review queue UI.
 */
export interface ReviewQueueItem extends AgentExecution {
  /** Name of the organization (denormalized for display). */
  org_name: string;
  /** Trade type of the organization (denormalized for display). */
  org_trade_type: string;
}
