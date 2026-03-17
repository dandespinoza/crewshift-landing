/**
 * Push Notification Service
 *
 * Sends push notifications to mobile/web clients.
 * In-app notifications are handled via Supabase Realtime (database INSERT triggers).
 *
 * TODO Sprint 4: Implement web push (Firebase Cloud Messaging or similar)
 */

import { logger } from '../utils/logger.js';

export interface PushOptions {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  actionUrl?: string;
}

export async function sendPush(options: PushOptions): Promise<{ id: string }> {
  // TODO: Integrate with FCM or web push
  logger.info(
    { userId: options.userId, title: options.title },
    'Push notification requested (stub)',
  );

  return { id: `mock-push-${Date.now()}` };
}
