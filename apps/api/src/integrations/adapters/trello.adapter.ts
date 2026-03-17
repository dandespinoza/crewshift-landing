/**
 * Trello Integration Adapter
 *
 * Native (Tier 1) adapter for Trello.
 * Handles API Key + Token authentication, board/card syncing, and webhooks.
 *
 * Trello API Reference:
 * - REST API: https://developer.atlassian.com/cloud/trello/rest/
 * - Auth: https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/
 * - Webhooks: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
 *
 * Key details:
 * - Authentication via API Key + Token as query parameters (?key=...&token=...)
 * - Tokens can be set to never expire
 * - getAuthUrl returns a URL where the user grants access; token is returned in URL fragment
 * - Webhook verification: base64 HMAC-SHA1 of (callbackURL + body) with API secret
 * - Rate limits: 300 requests/10 seconds per key, 100 requests/10 seconds per token
 * - Env: TRELLO_API_KEY, TRELLO_API_SECRET
 */

import { createHmac } from 'node:crypto';
import {
  BaseAdapter,
  type TokenSet,
  type ExternalId,
  type SyncResult,
  type WebhookEvent,
} from '../adapter.interface.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { registerAdapter } from '../registry.js';

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.trello.com/1';
const AUTH_BASE = 'https://trello.com/1/authorize';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const apiKey = process.env.TRELLO_API_KEY ?? (env as Record<string, unknown>).TRELLO_API_KEY as string | undefined;
  if (!apiKey) throw new Error('TRELLO_API_KEY is not configured');
  return apiKey;
}

function getApiSecret(): string {
  const apiSecret = process.env.TRELLO_API_SECRET ?? (env as Record<string, unknown>).TRELLO_API_SECRET as string | undefined;
  if (!apiSecret) throw new Error('TRELLO_API_SECRET is not configured');
  return apiSecret;
}

/**
 * Make an authenticated request to the Trello API.
 * Authentication is provided via key + token query parameters.
 */
async function trelloFetch(
  path: string,
  apiKey: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${separator}key=${apiKey}&token=${apiToken}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, path, errorBody },
      'Trello API error',
    );
    throw new Error(`Trello API error: ${response.status} — ${errorBody}`);
  }

  return response;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class TrelloAdapter extends BaseAdapter {
  readonly provider = 'trello' as const;
  readonly tier = 'native' as const;

  // ── OAuth ─────────────────────────────────────────────────────────────

  /**
   * Generate the Trello authorization URL.
   *
   * Trello uses a direct authorization model where the user visits a URL,
   * grants access, and receives a token displayed on the page (or in the URL
   * fragment for client-side apps).
   *
   * The returned URL will present the user with a "Allow" button that,
   * when clicked, provides a token.
   */
  getAuthUrl(_orgId: string, redirectUri: string): string {
    const apiKey = getApiKey();

    const params = new URLSearchParams({
      expiration: 'never',
      name: 'CrewShift',
      scope: 'read,write',
      response_type: 'token',
      key: apiKey,
      return_url: redirectUri,
    });

    return `${AUTH_BASE}?${params.toString()}`;
  }

  /**
   * Handle the Trello authorization callback.
   *
   * Trello does not use a standard OAuth code exchange. Instead, the token
   * is returned directly in the URL fragment. The "code" parameter here is
   * actually the Trello API token that was captured client-side.
   */
  async handleCallback(code: string, _orgId: string): Promise<TokenSet> {
    // The "code" is actually the Trello token returned via URL fragment.
    // Verify the token works by making a simple API call.
    const apiKey = getApiKey();

    try {
      const response = await trelloFetch('/members/me', apiKey, code);
      const member = (await response.json()) as Record<string, unknown>;

      logger.info(
        { memberId: member.id, username: member.username },
        'Trello token verified successfully',
      );
    } catch (err) {
      throw new Error(`Trello token verification failed: ${(err as Error).message}`);
    }

    return {
      access_token: code, // The Trello token
      // Trello tokens with expiration=never do not expire
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    throw new Error("Trello tokens don't expire when issued with expiration=never — no refresh is needed.");
  }

  // ── Sync: Trello → CrewShift ──────────────────────────────────────────

  /**
   * Sync boards and cards from Trello.
   *
   * The accessToken parameter should contain the Trello API token.
   * Fetches all boards for the authenticated member, then all cards
   * on each board.
   */
  async syncJobs(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const apiKey = getApiKey();

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;

    try {
      // Step 1: Get all boards for the authenticated member
      const boardsResponse = await trelloFetch(
        '/members/me/boards?filter=open&fields=name,desc,url,dateLastActivity,idOrganization,shortUrl,closed',
        apiKey,
        accessToken,
      );
      const boards = (await boardsResponse.json()) as Record<string, unknown>[];

      for (const board of boards) {
        try {
          const boardId = board.id as string;

          // Step 2: Get all cards on the board
          const cardsResponse = await trelloFetch(
            `/boards/${boardId}/cards?fields=name,desc,due,dueComplete,idList,idBoard,labels,dateLastActivity,shortUrl,url,closed,pos,idMembers`,
            apiKey,
            accessToken,
          );
          const cards = (await cardsResponse.json()) as Record<string, unknown>[];

          // Step 3: Get lists for this board (to map idList to list names)
          let lists: Record<string, unknown>[] = [];
          try {
            const listsResponse = await trelloFetch(
              `/boards/${boardId}/lists?fields=name`,
              apiKey,
              accessToken,
            );
            lists = (await listsResponse.json()) as Record<string, unknown>[];
          } catch {
            // Non-critical; continue without list names
          }

          const listMap = new Map<string, string>();
          for (const list of lists) {
            listMap.set(list.id as string, list.name as string);
          }

          for (const card of cards) {
            try {
              const mapped = this.mapCard(card, board, listMap);
              records.push(mapped);
              created++;
            } catch (err) {
              errors.push({ item: card, error: (err as Error).message });
            }
          }
        } catch (err) {
          errors.push({ item: board, error: (err as Error).message });
        }
      }

      logger.info(
        { provider: this.provider, boards: boards.length, cards: records.length, created, errors: errors.length },
        'Trello sync complete',
      );
    } catch (err) {
      logger.error(
        { provider: this.provider, error: (err as Error).message },
        'Trello board list failed',
      );
      errors.push({ item: {}, error: (err as Error).message });
    }

    return { created, updated: 0, skipped: 0, errors, records };
  }

  // ── Webhooks ──────────────────────────────────────────────────────────

  /**
   * Verify a Trello webhook using HMAC-SHA1.
   *
   * Trello computes base64(HMAC-SHA1(apiSecret, callbackURL + body))
   * and sends it in the X-Trello-Webhook header.
   *
   * The payload Buffer should contain the concatenation of the callback URL
   * and the raw request body, assembled by the webhook middleware.
   */
  verifyWebhook(payload: Buffer, signature: string): boolean {
    let apiSecret: string;
    try {
      apiSecret = getApiSecret();
    } catch {
      logger.warn('No Trello API secret configured for webhook verification');
      return false;
    }

    const hash = createHmac('sha1', apiSecret)
      .update(payload)
      .digest('base64');

    return hash === signature;
  }

  /**
   * Parse a Trello webhook payload into a normalized WebhookEvent.
   *
   * Trello webhook payload structure:
   * {
   *   action: {
   *     type: "updateCard" | "createCard" | "addMemberToCard" | ...,
   *     data: {
   *       card: { id, name, ... },
   *       board: { id, name, ... },
   *       list: { id, name, ... },
   *       ...
   *     },
   *     date: "2024-01-01T00:00:00.000Z",
   *     memberCreator: { id, username, fullName }
   *   },
   *   model: {
   *     id: "board_or_card_id",
   *     name: "...",
   *     ...
   *   }
   * }
   */
  async processWebhook(payload: Record<string, unknown>): Promise<WebhookEvent> {
    const action = payload.action as Record<string, unknown> | undefined;
    const actionType = (action?.type as string) ?? 'unknown';
    const actionData = (action?.data as Record<string, unknown>) ?? {};
    const actionDate = (action?.date as string) ?? undefined;
    const model = payload.model as Record<string, unknown> | undefined;

    // Determine resource type and ID from the action data
    const card = actionData.card as Record<string, unknown> | undefined;
    const board = actionData.board as Record<string, unknown> | undefined;
    const list = actionData.list as Record<string, unknown> | undefined;

    let resourceType = 'board';
    let resourceId = model?.id as string | undefined;

    if (card) {
      resourceType = 'card';
      resourceId = card.id as string;
    } else if (list) {
      resourceType = 'list';
      resourceId = list.id as string;
    }

    return {
      provider: this.provider,
      event_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
      data: {
        action_type: actionType,
        card: card ?? null,
        board: board ?? null,
        list: list ?? null,
        member_creator: (action?.memberCreator as Record<string, unknown>) ?? null,
        model_id: (model?.id as string) ?? null,
        model_name: (model?.name as string) ?? null,
        raw: payload,
      },
      timestamp: actionDate ?? new Date().toISOString(),
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Map a Trello card to CrewShift's unified job format.
   */
  private mapCard(
    card: Record<string, unknown>,
    board: Record<string, unknown>,
    listMap: Map<string, string>,
  ): Record<string, unknown> {
    const cardId = (card.id as string) ?? 'unknown';
    const idList = card.idList as string | undefined;
    const labels = (card.labels as Array<Record<string, unknown>>) ?? [];

    return {
      external_id: cardId,
      name: (card.name as string) ?? null,
      description: (card.desc as string) ?? null,
      due: (card.due as string) ?? null,
      due_complete: (card.dueComplete as boolean) ?? false,
      list_id: idList ?? null,
      list_name: idList ? (listMap.get(idList) ?? null) : null,
      board_id: (card.idBoard as string) ?? (board.id as string) ?? null,
      board_name: (board.name as string) ?? null,
      labels: labels.map((l) => ({
        id: (l.id as string) ?? null,
        name: (l.name as string) ?? null,
        color: (l.color as string) ?? null,
      })),
      member_ids: (card.idMembers as string[]) ?? [],
      closed: (card.closed as boolean) ?? false,
      position: (card.pos as number) ?? null,
      url: (card.shortUrl as string) ?? (card.url as string) ?? null,
      date_last_activity: (card.dateLastActivity as string) ?? null,
      external_ids: { trello: cardId },
      source: 'trello',
      metadata: {
        board_url: (board.shortUrl as string) ?? (board.url as string) ?? null,
        board_org_id: (board.idOrganization as string) ?? null,
      },
    };
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new TrelloAdapter();
registerAdapter(adapter);
export default adapter;
