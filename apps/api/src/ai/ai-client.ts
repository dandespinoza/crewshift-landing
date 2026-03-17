/**
 * AI Service Client
 *
 * HTTP client for the Python AI service with circuit breaker pattern.
 * All LLM/ML inference flows through this client.
 *
 * Uses the 'opossum' circuit breaker library for resilience:
 * - If the AI service is down, the circuit opens and returns a fallback
 * - CRUD operations continue to work even when AI is unavailable
 * - Circuit resets after 30 seconds and tries again
 */

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type {
  ReasonRequest,
  ReasonResponse,
  ClassifyRequest,
  ClassifyResponse,
  ExtractRequest,
  ExtractResponse,
  TranscribeRequest,
  TranscribeResponse,
  VisionRequest,
  VisionResponse,
  EmbedRequest,
  EmbedResponse,
  SearchRequest,
  SearchResponse,
  AIHealthResponse,
} from './types.js';

// ============================================
// Circuit Breaker Configuration
// ============================================

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  halfOpenAttempts: number;
}

const CIRCUIT_CONFIG = {
  failureThreshold: 5,        // Open circuit after 5 consecutive failures
  resetTimeout: 30_000,       // Try again after 30 seconds
  requestTimeout: 30_000,     // 30s timeout per request
  halfOpenMaxAttempts: 2,     // Allow 2 test requests in half-open state
};

const circuitState: CircuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
  halfOpenAttempts: 0,
};

function checkCircuit(): boolean {
  if (!circuitState.isOpen) return true;

  const elapsed = Date.now() - circuitState.lastFailure;
  if (elapsed > CIRCUIT_CONFIG.resetTimeout) {
    // Half-open: allow a test request
    if (circuitState.halfOpenAttempts < CIRCUIT_CONFIG.halfOpenMaxAttempts) {
      circuitState.halfOpenAttempts++;
      return true;
    }
  }

  return false;
}

function recordSuccess(): void {
  circuitState.failures = 0;
  circuitState.isOpen = false;
  circuitState.halfOpenAttempts = 0;
}

function recordFailure(): void {
  circuitState.failures++;
  circuitState.lastFailure = Date.now();
  circuitState.halfOpenAttempts = 0;

  if (circuitState.failures >= CIRCUIT_CONFIG.failureThreshold) {
    circuitState.isOpen = true;
    logger.warn({ failures: circuitState.failures }, 'AI service circuit breaker OPEN');
  }
}

// ============================================
// HTTP Client
// ============================================

async function callAIService<T>(
  path: string,
  body: Record<string, unknown>,
  requestId?: string,
): Promise<T> {
  if (!checkCircuit()) {
    throw new Error('AI service circuit breaker is open');
  }

  const url = `${env.AI_SERVICE_URL}${path}`;
  const startTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CIRCUIT_CONFIG.requestTimeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(requestId ? { 'X-Request-ID': requestId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ path, status: response.status, latency, error: errorBody }, 'AI service error');
      recordFailure();
      throw new Error(`AI service returned ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as T;
    recordSuccess();

    logger.info({ path, latency }, 'AI service call succeeded');
    return data;
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      logger.error({ path, timeout: CIRCUIT_CONFIG.requestTimeout }, 'AI service request timed out');
      recordFailure();
      throw new Error('AI service request timed out');
    }

    recordFailure();
    throw error;
  }
}

// ============================================
// Public API
// ============================================

export const aiClient = {
  /** Full LLM reasoning — agent execution, content generation */
  async reason(request: ReasonRequest): Promise<ReasonResponse> {
    return callAIService<ReasonResponse>('/ai/reason', request as unknown as Record<string, unknown>, request.request_id);
  },

  /** Intent classification — copilot message routing */
  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    return callAIService<ClassifyResponse>('/ai/classify', request as unknown as Record<string, unknown>, request.request_id);
  },

  /** Entity extraction from text */
  async extract(request: ExtractRequest): Promise<ExtractResponse> {
    return callAIService<ExtractResponse>('/ai/extract', request as unknown as Record<string, unknown>, request.request_id);
  },

  /** Speech-to-text transcription */
  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    return callAIService<TranscribeResponse>('/ai/transcribe', request as unknown as Record<string, unknown>, request.request_id);
  },

  /** Image analysis / OCR */
  async vision(request: VisionRequest): Promise<VisionResponse> {
    return callAIService<VisionResponse>('/ai/vision', request as unknown as Record<string, unknown>, request.request_id);
  },

  /** Generate embeddings */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return callAIService<EmbedResponse>('/ai/embed', request as unknown as Record<string, unknown>);
  },

  /** Semantic search over embeddings */
  async search(request: SearchRequest): Promise<SearchResponse> {
    return callAIService<SearchResponse>('/ai/search', request as unknown as Record<string, unknown>);
  },

  /** Health check */
  async health(): Promise<AIHealthResponse> {
    const url = `${env.AI_SERVICE_URL}/ai/health`;
    const response = await fetch(url);
    return (await response.json()) as AIHealthResponse;
  },

  /** Check if the AI service circuit breaker is open */
  isAvailable(): boolean {
    return checkCircuit();
  },

  /** Get circuit breaker state (for monitoring) */
  getCircuitState() {
    return { ...circuitState };
  },
};
