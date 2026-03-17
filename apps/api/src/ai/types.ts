/**
 * AI Service client types — mirrors Python AI service request/response models.
 * Used by the Node API to communicate with the Python AI service via HTTP.
 */

// ============================================
// Request Types
// ============================================

export interface ReasonRequest {
  prompt_template: string;
  variables: Record<string, unknown>;
  model_tier: 'fast' | 'capable' | 'powerful';
  system_prompt?: string;
  output_schema?: Record<string, unknown>;
  org_id: string;
  request_id?: string;
}

export interface ClassifyRequest {
  text: string;
  categories: string[];
  org_id: string;
  request_id?: string;
}

export interface ExtractRequest {
  text: string;
  schema: Record<string, unknown>;
  org_id: string;
  request_id?: string;
}

export interface TranscribeRequest {
  audio_url: string;
  language?: string;
  org_id: string;
  request_id?: string;
}

export interface VisionRequest {
  image_urls: string[];
  prompt: string;
  org_id: string;
  request_id?: string;
}

export interface EmbedRequest {
  texts: string[];
  model?: string;
  org_id: string;
}

export interface SearchRequest {
  query: string;
  org_id: string;
  source_types?: string[];
  limit?: number;
}

// ============================================
// Response Types
// ============================================

export interface ReasonResponse {
  content: string;
  structured_output?: Record<string, unknown>;
  model_used: string;
  tokens_used: number;
  cost_cents: number;
  latency_ms: number;
  provider: string;
}

export interface ClassifyResponse {
  intent: string;
  entities: Record<string, unknown>;
  confidence: number;
  model_used: string;
}

export interface ExtractResponse {
  extracted: Record<string, unknown>;
  confidence: number;
  model_used: string;
}

export interface TranscribeResponse {
  text: string;
  language: string;
  duration_seconds: number;
  model_used: string;
}

export interface VisionResponse {
  analysis: string;
  structured_output?: Record<string, unknown>;
  model_used: string;
}

export interface EmbedResponse {
  embeddings: number[][];
  model_used: string;
  dimensions: number;
}

export interface SearchResult {
  source_type: string;
  source_id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface AIHealthResponse {
  status: string;
  version: string;
  providers: Record<string, string>;
  timestamp: string;
}

/** Returned when the AI service is unavailable (circuit breaker open) */
export interface AIUnavailableResponse {
  status: 'ai_unavailable';
  message: string;
}
