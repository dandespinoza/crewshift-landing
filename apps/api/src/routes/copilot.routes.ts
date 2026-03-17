import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate, paginationSchema, uuidSchema } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  message: z.string().min(1).max(10000),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function copilotRoutes(app: FastifyInstance): Promise<void> {
  // POST /message — Send message to copilot
  // NOTE: In future this will return an SSE stream. For now returns a JSON response.
  app.post('/message', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(sendMessageSchema, request.body);

    try {
      let conversationId = body.conversation_id;

      // If no conversation_id, create a new conversation
      if (!conversationId) {
        const { data: conversation, error: createError } = await supabaseAdmin
          .from('copilot_conversations')
          .insert({
            org_id: request.orgId,
            user_id: request.userId,
            title: body.message.slice(0, 100), // Use first 100 chars as title
          })
          .select('id')
          .single();

        if (createError || !conversation) {
          throw new AppError(500, 'CONVERSATION_CREATE_FAILED', 'Failed to create conversation');
        }

        conversationId = conversation.id;
      }

      // Store the user's message
      const { error: userMsgError } = await supabaseAdmin
        .from('copilot_messages')
        .insert({
          conversation_id: conversationId,
          role: 'user',
          content: body.message,
        });

      if (userMsgError) {
        request.log.warn({ userMsgError }, 'Failed to store user message');
      }

      // TODO: Call AI service for actual response. For now return a stub.
      const assistantResponse =
        'I understand your request. The AI copilot is being set up and will be fully functional soon. ' +
        'In the meantime, you can use the dashboard to manage your jobs, invoices, and team.';

      // Store assistant response
      const { error: assistantMsgError } = await supabaseAdmin
        .from('copilot_messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: assistantResponse,
        });

      if (assistantMsgError) {
        request.log.warn({ assistantMsgError }, 'Failed to store assistant message');
      }

      return reply.send(
        success({
          conversation_id: conversationId,
          message: {
            role: 'assistant',
            content: assistantResponse,
          },
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to process copilot message');
      throw new AppError(500, 'COPILOT_MESSAGE_FAILED', 'Failed to process message');
    }
  });

  // GET /conversations — List user's conversations (paginated)
  app.get('/conversations', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = validate(paginationSchema, request.query);

    try {
      let qb = supabaseAdmin
        .from('copilot_conversations')
        .select('id, title, created_at, updated_at', { count: 'exact' })
        .eq('user_id', request.userId)
        .eq('org_id', request.orgId!)
        .order(query.sort, { ascending: query.order === 'asc' })
        .limit(query.limit);

      if (query.cursor) {
        qb = qb.gt('id', query.cursor);
      }

      const { data: conversations, error: listError, count } = await qb;

      if (listError) {
        throw new AppError(500, 'CONVERSATIONS_FETCH_FAILED', listError.message);
      }

      const rows = conversations ?? [];
      return reply.send(
        success(rows, {
          limit: query.limit,
          has_more: rows.length === query.limit,
          next_cursor: rows.length > 0 ? rows[rows.length - 1].id : undefined,
          total: count ?? undefined,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to list conversations');
      throw new AppError(500, 'CONVERSATIONS_FETCH_FAILED', 'Failed to list conversations');
    }
  });

  // GET /conversations/:id — Get conversation messages
  app.get<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = validate(uuidSchema, request.params.id);

      try {
        // Verify the conversation belongs to the user
        const { data: conversation, error: convError } = await supabaseAdmin
          .from('copilot_conversations')
          .select('id, title, created_at')
          .eq('id', id)
          .eq('user_id', request.userId)
          .eq('org_id', request.orgId!)
          .single();

        if (convError || !conversation) {
          throw new NotFoundError('Conversation not found');
        }

        // Fetch messages for this conversation
        const { data: messages, error: msgError } = await supabaseAdmin
          .from('copilot_messages')
          .select('id, role, content, created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true });

        if (msgError) {
          throw new AppError(500, 'MESSAGES_FETCH_FAILED', msgError.message);
        }

        return reply.send(
          success({
            conversation,
            messages: messages ?? [],
          }),
        );
      } catch (err) {
        if (err instanceof AppError) throw err;
        request.log.error({ err }, 'Failed to fetch conversation');
        throw new AppError(500, 'CONVERSATION_FETCH_FAILED', 'Failed to fetch conversation');
      }
    },
  );
}
