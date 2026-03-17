// ─────────────────────────────────────────────────────────────────────────────
// @crewshift/shared - Public Type Barrel
// Re-exports every type so consumers can import from a single entry point:
//   import type { Job, AgentDefinition, ReasonRequest } from '@crewshift/shared';
// ─────────────────────────────────────────────────────────────────────────────

export type {
  // Value objects
  Address,
  LineItem,
  Material,
  // Core entities
  Organization,
  Profile,
  Customer,
  Job,
  JobStatus,
  Invoice,
  InvoiceStatus,
  Estimate,
  EstimateStatus,
  EstimateType,
  Part,
  Integration,
  IntegrationStatus,
  Notification,
} from './entity.types.js';

export type {
  // Agent enumerations
  AgentType,
  AgentCategory,
  // Agent definition building blocks
  AgentTrigger,
  AgentInput,
  AgentStep,
  AgentOutput,
  AutonomyRules,
  ChainRule,
  AgentDefinition,
  // Per-org configuration
  AgentConfig,
  // Execution tracking
  AgentExecutionStatus,
  AgentExecution,
  ReviewQueueItem,
} from './agent.types.js';

export type {
  // Reasoning
  ReasonRequest,
  ReasonResponse,
  // Classification
  ClassifyRequest,
  ClassifyResponse,
  // Extraction
  ExtractRequest,
  ExtractResponse,
  // Transcription
  TranscribeRequest,
  TranscribeResponse,
  // Vision
  VisionRequest,
  VisionResponse,
  // Embeddings
  EmbedRequest,
  EmbedResponse,
  // Semantic search
  SearchResult,
  SearchRequest,
  SearchResponse,
} from './ai.types.js';
