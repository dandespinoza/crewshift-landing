/**
 * Copilot Service
 *
 * Orchestrates the AI copilot pipeline:
 * 1. Classify user intent
 * 2. Route to appropriate agent(s) or DB query
 * 3. Aggregate results
 * 4. Generate natural language response
 *
 * See docs/08-copilot.md for full pipeline details.
 *
 * TODO Sprint 4: Full implementation with streaming SSE
 */

import { logger } from '../utils/logger.js';
import { aiClient } from '../ai/ai-client.js';
import { supabaseAdmin } from '../config/supabase.js';

// ============================================
// Types
// ============================================

export interface CopilotMessageInput {
  conversationId?: string;
  message: string;
  orgId: string;
  userId: string;
}

export interface CopilotResponse {
  message: string;
  conversation_id: string;
  agents_dispatched?: string[];
  execution_ids?: string[];
  actions_taken?: Array<{ type: string; description: string; result: unknown }>;
  follow_up_suggestions?: string[];
}

// ============================================
// Service Functions
// ============================================

/**
 * Process a copilot message.
 * This is the main entry point for the copilot pipeline.
 *
 * TODO Sprint 4: Implement full pipeline with SSE streaming
 */
export async function processMessage(input: CopilotMessageInput): Promise<CopilotResponse> {
  const { conversationId, message, orgId, userId } = input;

  logger.info({ orgId, userId, messageLength: message.length }, 'Processing copilot message');

  // 1. Get or create conversation
  let convId = conversationId;
  if (!convId) {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .insert({
        org_id: orgId,
        user_id: userId,
        title: message.substring(0, 100),
      })
      .select('id')
      .single();

    convId = conv?.id ?? '';
  }

  // 2. Save user message
  await supabaseAdmin.from('messages').insert({
    conversation_id: convId,
    org_id: orgId,
    role: 'user',
    content: message,
  });

  // 3. Classify intent (call AI service)
  let intent = 'general-question';
  let confidence = 0.5;

  if (aiClient.isAvailable()) {
    try {
      const classification = await aiClient.classify({
        text: message,
        categories: [
          'create-invoice', 'generate-invoice',
          'create-estimate',
          'check-collections', 'outstanding-invoices',
          'schedule-job', 'dispatch-tech',
          'business-report', 'how-did-we-do',
          'check-inventory', 'order-parts',
          'customer-info', 'send-review-request',
          'create-workflow',
          'query',
          'general-question',
        ],
        org_id: orgId,
      });
      intent = classification.intent;
      confidence = classification.confidence;
    } catch (error) {
      logger.warn({ error }, 'Intent classification failed, using default');
    }
  }

  // 4. TODO Sprint 4: Route to agents based on intent
  // For now, return a stub response
  const responseMessage = `I understood your message as "${intent}" (confidence: ${(confidence * 100).toFixed(0)}%). ` +
    `Full agent dispatch will be available in Sprint 4. For now, you can use the CRUD API endpoints directly.`;

  // 5. Save assistant message
  await supabaseAdmin.from('messages').insert({
    conversation_id: convId,
    org_id: orgId,
    role: 'assistant',
    content: responseMessage,
    intent,
  });

  return {
    message: responseMessage,
    conversation_id: convId ?? '',
    agents_dispatched: [],
    execution_ids: [],
    actions_taken: [],
    follow_up_suggestions: [
      'What invoices are outstanding?',
      'Show me today\'s schedule',
      'How was last month?',
    ],
  };
}

/**
 * List conversations for a user.
 */
export async function listConversations(orgId: string, userId: string, limit = 25) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, summary, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ error }, 'Failed to list conversations');
    return [];
  }

  return data ?? [];
}

/**
 * Get conversation messages.
 */
export async function getConversationMessages(
  orgId: string,
  conversationId: string,
  limit = 50,
) {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, intent, agents_dispatched, execution_ids, created_at')
    .eq('org_id', orgId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error({ error }, 'Failed to get conversation messages');
    return [];
  }

  return data ?? [];
}
