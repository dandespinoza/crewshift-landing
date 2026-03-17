/**
 * Email Notification Service
 *
 * Sends transactional emails via Resend.
 * Used for: invoice delivery, collection follow-ups, digest emails, alerts.
 *
 * TODO Sprint 4: Implement full email templates and Resend integration
 */

import { logger } from '../utils/logger.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export async function sendEmail(options: EmailOptions): Promise<{ id: string }> {
  // TODO: Integrate with Resend API
  logger.info(
    { to: options.to, subject: options.subject },
    'Email send requested (stub)',
  );

  return { id: `mock-email-${Date.now()}` };
}

export async function sendInvoiceEmail(
  customerEmail: string,
  customerName: string,
  invoiceNumber: string,
  total: string,
  pdfUrl: string,
): Promise<{ id: string }> {
  return sendEmail({
    to: customerEmail,
    subject: `Invoice ${invoiceNumber} from CrewShift`,
    html: `<p>Hi ${customerName},</p><p>Your invoice ${invoiceNumber} for ${total} is attached.</p><p><a href="${pdfUrl}">View Invoice</a></p>`,
  });
}

export async function sendCollectionEmail(
  customerEmail: string,
  customerName: string,
  invoiceNumber: string,
  amountDue: string,
  daysPastDue: number,
): Promise<{ id: string }> {
  return sendEmail({
    to: customerEmail,
    subject: `Friendly reminder: Invoice ${invoiceNumber} is past due`,
    html: `<p>Hi ${customerName},</p><p>Invoice ${invoiceNumber} for ${amountDue} is ${daysPastDue} days past due. Please let us know if you have any questions.</p>`,
  });
}
