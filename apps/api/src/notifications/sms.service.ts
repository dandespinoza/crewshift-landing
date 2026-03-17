/**
 * SMS Notification Service
 *
 * Sends SMS messages via Twilio.
 * Used for: appointment reminders, collection follow-ups, urgent alerts.
 *
 * TODO Sprint 4: Implement Twilio integration
 */

import { logger } from '../utils/logger.js';

export interface SMSOptions {
  to: string;
  body: string;
  from?: string;
}

export async function sendSMS(options: SMSOptions): Promise<{ sid: string }> {
  // TODO: Integrate with Twilio API
  logger.info(
    { to: options.to, bodyLength: options.body.length },
    'SMS send requested (stub)',
  );

  return { sid: `mock-sms-${Date.now()}` };
}

export async function sendAppointmentReminder(
  phone: string,
  customerName: string,
  scheduledTime: string,
  techName: string,
): Promise<{ sid: string }> {
  return sendSMS({
    to: phone,
    body: `Hi ${customerName}, your appointment is scheduled for ${scheduledTime}. ${techName} will be your technician. Reply CONFIRM to confirm.`,
  });
}
