# 15 — Notification System

> **Related Docs:** [14-queue-system.md](./14-queue-system.md) (BullMQ queues & workers), [13-realtime.md](./13-realtime.md) (Supabase Realtime & SSE), [06-agent-runtime.md](./06-agent-runtime.md) (agent execution pipeline), [09-integrations.md](./09-integrations.md) (Twilio adapter)

---

## Overview

CrewShift's notification system delivers timely, actionable information to contractors through four channels: in-app, email, SMS, and push. Every agent action, review request, alert, and periodic digest flows through a unified notification pipeline backed by BullMQ. The system is designed around the principle that contractors are busy people on job sites — notifications must be concise, prioritized, and delivered through the channel the user actually checks.

---

## Notification Channels

### Channel Definitions

| Channel | Transport | Latency | Use When |
|---------|-----------|---------|----------|
| `in_app` | Supabase Realtime INSERT on `notifications` table | < 1 second | Always. Every notification creates an in-app record. This is the canonical notification store. |
| `email` | Resend (primary) / SendGrid (fallback) | 1-30 seconds | Digest delivery, review-needed items, invoice/estimate PDFs, weekly summaries. Anything the user should see even if they haven't opened CrewShift today. |
| `sms` | Twilio | 1-5 seconds | Urgent alerts (overdue invoices, compliance deadlines, low-confidence agent outputs), time-sensitive review requests for high-value items. Only when user has opted in. |
| `push` | Web Push via Service Worker (future Phase 2) | 1-3 seconds | Real-time alerts when the browser is closed but notification permission is granted. Mirrors the most urgent `in_app` notifications. |

### Channel Selection Logic

The notification worker determines which channels to use based on:

1. **Notification type** — each type has default channels
2. **User preferences** — per-user overrides stored in `profiles.settings.notification_preferences`
3. **Urgency** — escalations and alerts may force SMS even if user normally prefers email
4. **Opt-in status** — SMS and push require explicit opt-in; never sent without consent

```typescript
// src/notifications/channel-resolver.ts

interface ChannelResolution {
  channels: NotificationChannel[];
  reason: string; // for audit log
}

type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push';

function resolveChannels(
  notificationType: NotificationType,
  userPreferences: NotificationPreferences,
  urgency: 'low' | 'medium' | 'high' | 'critical'
): ChannelResolution {
  // in_app is ALWAYS included — it's the canonical record
  const channels: NotificationChannel[] = ['in_app'];

  // Check user preferences for this notification type
  const typePrefs = userPreferences[notificationType];

  if (typePrefs?.email !== false) {
    // Email is on by default for most types (user can disable)
    channels.push('email');
  }

  if (typePrefs?.sms === true && userPreferences.sms_opted_in) {
    // SMS only if explicitly opted in AND enabled for this type
    channels.push('sms');
  }

  if (typePrefs?.push === true && userPreferences.push_opted_in) {
    channels.push('push');
  }

  // Critical urgency forces SMS if user has opted in to SMS at all
  if (urgency === 'critical' && userPreferences.sms_opted_in) {
    if (!channels.includes('sms')) {
      channels.push('sms');
    }
  }

  return {
    channels,
    reason: `type=${notificationType}, urgency=${urgency}, prefs=${JSON.stringify(typePrefs)}`,
  };
}
```

---

## Notification Types

### Type Definitions

| Type | Trigger | Default Channels | Urgency | Description |
|------|---------|-----------------|---------|-------------|
| `agent_action` | Agent execution completes (status = `completed`) | `in_app` | low | Informational — "Invoice #1247 created for Henderson — $1,840" |
| `review_needed` | Agent execution enters `awaiting_review` status | `in_app`, `email` | medium | Action required — "Invoice #1248 needs review — $8,500 (above auto-approve threshold)" |
| `alert` | Compliance deadline, overdue invoice, low stock, agent failure, low-confidence output | `in_app`, `email`, `sms` | high | Urgent — "OSHA-10 certification for Mike expires in 7 days" |
| `digest` | Scheduled job (daily at 8am, weekly on Monday 9am) | `in_app`, `email` | low | Summary — "Daily digest: 12 agent actions, 3 pending reviews, 2 alerts" |

### What Triggers Each Type

```typescript
// Type: agent_action
// Triggered by: agent.worker.ts after successful execution
// Examples:
//   - Invoice Agent created invoice #1247
//   - Estimate Agent generated estimate for new customer
//   - Collections Agent sent follow-up #2 to overdue account
//   - Bookkeeping Agent categorized 15 expenses
//   - Customer Agent sent review request to Henderson
//   - Inventory Agent placed reorder for copper pipe

// Type: review_needed
// Triggered by: agent.worker.ts when autonomy check returns 'review'
// Examples:
//   - Invoice over $500 awaiting approval
//   - Estimate for new customer (no history) needs review
//   - Collections Agent wants to send final notice (escalation)
//   - Low-confidence output (< 0.85) from any agent

// Type: alert
// Triggered by: scheduled.worker.ts or agent.worker.ts on failure/concern
// Examples:
//   - Invoice overdue by 30+ days
//   - Compliance deadline within 7 days
//   - Parts below reorder point
//   - Agent execution failed after 3 retries
//   - Integration sync error (QuickBooks disconnected)
//   - Approaching monthly tier limit (80% usage)

// Type: digest
// Triggered by: scheduled.worker.ts (daily-digest, weekly-digest cron jobs)
// Examples:
//   - Daily: agent activity summary, pending reviews, alerts, insights
//   - Weekly: revenue, jobs, margins, outstanding, business summary
```

---

## Notifications Table Schema

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES profiles(id),       -- NULL = org-wide (all members see it)
  type TEXT NOT NULL,                          -- 'agent_action', 'review_needed', 'alert', 'digest'
  title TEXT NOT NULL,                         -- Short: "Invoice #1247 created"
  body TEXT,                                   -- Longer detail (optional)
  channel TEXT NOT NULL,                       -- 'in_app', 'email', 'sms', 'push'
  read BOOLEAN DEFAULT false,                  -- Has user dismissed/acknowledged?
  action_url TEXT,                             -- Deep link: "/invoices/uuid-here" or "/agents/review-queue"
  metadata JSONB DEFAULT '{}',                 -- Flexible: { agent_type, execution_id, entity_id, entity_type, urgency }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, read, created_at DESC)
  WHERE read = false;

CREATE INDEX idx_notifications_org_created
  ON notifications(org_id, created_at DESC);

CREATE INDEX idx_notifications_type
  ON notifications(org_id, type, created_at DESC);
```

### How Records Are Created

Every notification originates from one of two sources:

1. **Agent execution pipeline** — the `notify` step in an agent definition inserts a row into `notifications` and enqueues a BullMQ job for external delivery (email/SMS/push).
2. **Scheduled workers** — digest generation, overdue detection, compliance checks create notifications directly.

Both paths use the same `NotificationService`:

```typescript
// src/notifications/notification.service.ts

import { supabase } from '../config/supabase';
import { notificationQueue } from '../queue/queues';
import { resolveChannels } from './channel-resolver';

interface CreateNotificationInput {
  orgId: string;
  userId?: string;           // null = broadcast to all org members
  type: NotificationType;
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}

async function createNotification(input: CreateNotificationInput): Promise<void> {
  const { orgId, userId, type, title, body, actionUrl, metadata, urgency = 'low' } = input;

  // Determine target users
  const targetUsers = userId
    ? [userId]
    : await getOrgMemberIds(orgId); // broadcast to all members

  for (const targetUserId of targetUsers) {
    // 1. Load user's notification preferences
    const preferences = await getUserNotificationPreferences(targetUserId);

    // 2. Resolve which channels to use
    const { channels } = resolveChannels(type, preferences, urgency);

    // 3. Create in_app notification record (always)
    const { data: notification } = await supabase
      .from('notifications')
      .insert({
        org_id: orgId,
        user_id: targetUserId,
        type,
        title,
        body,
        channel: 'in_app', // the DB record is always the in_app channel
        read: false,
        action_url: actionUrl,
        metadata: {
          ...metadata,
          urgency,
          channels_sent: channels, // track which channels were used
        },
      })
      .select()
      .single();

    // 4. Enqueue external delivery jobs for non-in_app channels
    for (const channel of channels) {
      if (channel === 'in_app') continue; // already handled by DB insert

      await notificationQueue.add(`notification:${channel}`, {
        notificationId: notification.id,
        channel,
        orgId,
        userId: targetUserId,
        type,
        title,
        body,
        actionUrl,
        metadata,
      }, {
        attempts: 3,
        backoff: { type: 'fixed', delay: 1000 },
        priority: urgency === 'critical' ? 1 : urgency === 'high' ? 2 : 3,
      });
    }
  }
}

async function getUserNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', userId)
    .single();

  return profile?.settings?.notification_preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

async function getOrgMemberIds(orgId: string): Promise<string[]> {
  const { data: members } = await supabase
    .from('profiles')
    .select('id')
    .eq('org_id', orgId);

  return members?.map(m => m.id) ?? [];
}
```

### Supabase Realtime Delivery for In-App

When a row is inserted into the `notifications` table, Supabase Realtime automatically pushes the change to subscribed clients. The frontend listens on the org-scoped channel:

```typescript
// Frontend: notification subscription
supabase
  .channel(`org:${orgId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `org_id=eq.${orgId}`,
    },
    (payload) => {
      // payload.new = the new notification row
      addToNotificationBell(payload.new);
      if (payload.new.metadata?.urgency === 'critical') {
        showToast(payload.new.title, 'error');
      }
    }
  )
  .subscribe();
```

RLS ensures each user only sees notifications where `user_id` matches their JWT or `user_id IS NULL` (org-wide broadcasts).

---

## Email Service

### Provider Strategy

| Provider | Role | Why |
|----------|------|-----|
| **Resend** | Primary | Modern API, excellent DX, React Email templates, generous free tier (3K emails/mo), fast delivery. Best for transactional email. |
| **SendGrid** | Fallback | Industry standard, proven reliability, handles high volume. Falls back to SendGrid if Resend returns 5xx or times out. |

**Decision rationale:** Resend was chosen as primary because its API is simpler, it supports React Email templates natively (which aligns with the eventual React frontend), and its delivery speed is consistently faster than SendGrid for transactional email. SendGrid serves as fallback because it has decades of deliverability reputation and handles edge cases (bounces, spam filtering) that Resend is still building out.

### Email Service Implementation

```typescript
// src/notifications/email.service.ts

import { Resend } from 'resend';
import sgMail from '@sendgrid/mail';
import { logger } from '../utils/logger';

const resend = new Resend(env.RESEND_API_KEY);
sgMail.setApiKey(env.SENDGRID_API_KEY);

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;                // plain text fallback
  from?: string;                // defaults to noreply@crewshift.com
  replyTo?: string;             // defaults to support@crewshift.com
  tags?: { name: string; value: string }[];
}

async function sendEmail(payload: EmailPayload): Promise<{ provider: string; messageId: string }> {
  const {
    to,
    subject,
    html,
    text,
    from = 'CrewShift <noreply@crewshift.com>',
    replyTo = 'support@crewshift.com',
    tags = [],
  } = payload;

  // Try Resend first
  try {
    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      reply_to: replyTo,
      tags,
    });

    logger.info({ provider: 'resend', messageId: result.id, to }, 'Email sent');
    return { provider: 'resend', messageId: result.id };
  } catch (error) {
    logger.warn({ provider: 'resend', error: error.message, to }, 'Resend failed, falling back to SendGrid');
  }

  // Fallback to SendGrid
  try {
    const [result] = await sgMail.send({
      to,
      from: { email: 'noreply@crewshift.com', name: 'CrewShift' },
      replyTo,
      subject,
      html,
      text,
    });

    const messageId = result.headers['x-message-id'];
    logger.info({ provider: 'sendgrid', messageId, to }, 'Email sent via fallback');
    return { provider: 'sendgrid', messageId };
  } catch (error) {
    logger.error({ provider: 'sendgrid', error: error.message, to }, 'Both email providers failed');
    throw new Error(`Email delivery failed to ${to}: ${error.message}`);
  }
}
```

### Email Templates

Email templates are rendered server-side using Handlebars. Each notification type maps to a template:

```typescript
// src/notifications/email-templates.ts

import Handlebars from 'handlebars';

const TEMPLATES = {
  // Transactional templates
  agent_action: Handlebars.compile(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0;">
        <img src="https://app.crewshift.com/logo-white.png" alt="CrewShift" style="height: 28px;" />
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb;">
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">{{title}}</h2>
        <p style="margin: 0 0 16px; color: #6b7280; font-size: 14px;">{{body}}</p>
        {{#if actionUrl}}
          <a href="https://app.crewshift.com{{actionUrl}}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">View Details</a>
        {{/if}}
      </div>
      <div style="padding: 16px 24px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">You received this because an agent completed an action in your CrewShift account.</p>
      </div>
    </div>
  `),

  review_needed: Handlebars.compile(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0;">
        <img src="https://app.crewshift.com/logo-white.png" alt="CrewShift" style="height: 28px;" />
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb;">
        <div style="background: #fef3c7; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px;">
          <p style="margin: 0; color: #92400e; font-size: 14px; font-weight: 600;">Action Required</p>
        </div>
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">{{title}}</h2>
        <p style="margin: 0 0 16px; color: #6b7280; font-size: 14px;">{{body}}</p>
        <a href="https://app.crewshift.com{{actionUrl}}" style="display: inline-block; padding: 10px 20px; background: #f59e0b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">Review Now</a>
      </div>
      <div style="padding: 16px 24px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">This item is waiting for your approval before the agent can proceed.</p>
      </div>
    </div>
  `),

  alert: Handlebars.compile(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0;">
        <img src="https://app.crewshift.com/logo-white.png" alt="CrewShift" style="height: 28px;" />
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb;">
        <div style="background: #fee2e2; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px;">
          <p style="margin: 0; color: #991b1b; font-size: 14px; font-weight: 600;">Alert</p>
        </div>
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">{{title}}</h2>
        <p style="margin: 0 0 16px; color: #6b7280; font-size: 14px;">{{body}}</p>
        {{#if actionUrl}}
          <a href="https://app.crewshift.com{{actionUrl}}" style="display: inline-block; padding: 10px 20px; background: #dc2626; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">Take Action</a>
        {{/if}}
      </div>
      <div style="padding: 16px 24px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">This alert requires your attention. Manage alert preferences in Settings.</p>
      </div>
    </div>
  `),

  daily_digest: Handlebars.compile(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0;">
        <img src="https://app.crewshift.com/logo-white.png" alt="CrewShift" style="height: 28px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 8px 0 0;">Daily Digest - {{date}}</p>
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb;">
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #111827;">Your Daily Summary</h2>

        {{#if alerts.length}}
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #dc2626; margin: 0 0 8px;">Alerts ({{alerts.length}})</h3>
          {{#each alerts}}
          <div style="padding: 8px 12px; background: #fef2f2; border-radius: 4px; margin-bottom: 4px;">
            <p style="margin: 0; font-size: 13px; color: #111827;">{{this.title}}</p>
          </div>
          {{/each}}
        </div>
        {{/if}}

        {{#if pendingReviews.length}}
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #f59e0b; margin: 0 0 8px;">Pending Reviews ({{pendingReviews.length}})</h3>
          {{#each pendingReviews}}
          <div style="padding: 8px 12px; background: #fffbeb; border-radius: 4px; margin-bottom: 4px;">
            <p style="margin: 0; font-size: 13px; color: #111827;">{{this.title}}</p>
          </div>
          {{/each}}
        </div>
        {{/if}}

        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #111827; margin: 0 0 8px;">Agent Activity</h3>
          <table style="width: 100%; border-collapse: collapse;">
            {{#each agentSummary}}
            <tr>
              <td style="padding: 6px 0; font-size: 13px; color: #6b7280;">{{this.agentName}}</td>
              <td style="padding: 6px 0; font-size: 13px; color: #111827; text-align: right;">{{this.count}} actions</td>
            </tr>
            {{/each}}
          </table>
        </div>

        {{#if insights.length}}
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #2563eb; margin: 0 0 8px;">Insights</h3>
          {{#each insights}}
          <p style="margin: 0 0 8px; font-size: 13px; color: #374151;">{{this}}</p>
          {{/each}}
        </div>
        {{/if}}

        <a href="https://app.crewshift.com/dashboard" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">Open Dashboard</a>
      </div>
      <div style="padding: 16px 24px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">Manage digest preferences in <a href="https://app.crewshift.com/settings/notifications" style="color: #6b7280;">Settings</a>.</p>
      </div>
    </div>
  `),

  weekly_digest: Handlebars.compile(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0;">
        <img src="https://app.crewshift.com/logo-white.png" alt="CrewShift" style="height: 28px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 8px 0 0;">Weekly Business Summary - Week of {{weekStart}}</p>
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb;">
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #111827;">Weekly Business Summary</h2>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 12px; background: #f0fdf4; border-radius: 6px; text-align: center; width: 50%;">
              <p style="margin: 0; font-size: 24px; font-weight: 700; color: #166534;">{{revenue}}</p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Revenue</p>
            </td>
            <td style="width: 12px;"></td>
            <td style="padding: 12px; background: #eff6ff; border-radius: 6px; text-align: center; width: 50%;">
              <p style="margin: 0; font-size: 24px; font-weight: 700; color: #1e40af;">{{jobsCompleted}}</p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Jobs Completed</p>
            </td>
          </tr>
        </table>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 0; font-size: 13px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Avg Job Margin</td>
            <td style="padding: 8px 0; font-size: 13px; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6;">{{avgMargin}}%</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-size: 13px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Outstanding Invoices</td>
            <td style="padding: 8px 0; font-size: 13px; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6;">{{outstandingAmount}} ({{outstandingCount}})</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-size: 13px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Estimates Sent / Accepted</td>
            <td style="padding: 8px 0; font-size: 13px; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6;">{{estimatesSent}} / {{estimatesAccepted}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-size: 13px; color: #6b7280;">Agent Actions This Week</td>
            <td style="padding: 8px 0; font-size: 13px; color: #111827; text-align: right;">{{totalAgentActions}}</td>
          </tr>
        </table>

        {{#if weeklyInsights.length}}
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #2563eb; margin: 0 0 8px;">AI Insights</h3>
          {{#each weeklyInsights}}
          <p style="margin: 0 0 8px; font-size: 13px; color: #374151;">{{this}}</p>
          {{/each}}
        </div>
        {{/if}}

        <a href="https://app.crewshift.com/dashboard" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">View Full Dashboard</a>
      </div>
      <div style="padding: 16px 24px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">This weekly summary is generated by your Insights Agent.</p>
      </div>
    </div>
  `),
};

export function renderEmailTemplate(
  templateName: keyof typeof TEMPLATES,
  data: Record<string, any>
): string {
  const template = TEMPLATES[templateName];
  if (!template) throw new Error(`Unknown email template: ${templateName}`);
  return template(data);
}
```

### Transactional vs Digest Emails

| Category | When Sent | Examples | Send Immediately? |
|----------|-----------|---------|-------------------|
| **Transactional** | Real-time, triggered by an event | Review needed, alert, invoice PDF attached | Yes, via BullMQ notification worker |
| **Digest** | Scheduled (daily 8am, weekly Monday 9am) | Daily summary, weekly business report | No, batched and sent by scheduled worker |

**Decision rationale:** Transactional emails are sent immediately because they require action (review an invoice, respond to an alert). Digest emails are batched to avoid notification fatigue — contractors do not want 47 individual emails about routine agent actions. The digest aggregates everything into one useful summary.

---

## SMS Service

### Twilio Integration

```typescript
// src/notifications/sms.service.ts

import twilio from 'twilio';
import { logger } from '../utils/logger';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

const CREWSHIFT_SMS_NUMBER = env.TWILIO_PHONE_NUMBER; // e.g., +18005551234

interface SmsPayload {
  to: string;            // E.164 format: +15551234567
  body: string;          // Max 1600 chars (Twilio concatenation)
  orgId: string;         // for logging
  notificationId: string;
}

async function sendSms(payload: SmsPayload): Promise<{ sid: string }> {
  const { to, body, orgId, notificationId } = payload;

  // Validate phone number format
  if (!/^\+1\d{10}$/.test(to)) {
    throw new Error(`Invalid US phone number format: ${to}`);
  }

  try {
    const message = await client.messages.create({
      body,
      from: CREWSHIFT_SMS_NUMBER,
      to,
      statusCallback: `${env.API_URL}/api/webhooks/twilio/status`, // delivery tracking
    });

    logger.info({
      provider: 'twilio',
      sid: message.sid,
      to,
      orgId,
      notificationId,
    }, 'SMS sent');

    return { sid: message.sid };
  } catch (error) {
    logger.error({
      provider: 'twilio',
      error: error.message,
      code: error.code,
      to,
      orgId,
    }, 'SMS send failed');
    throw error;
  }
}
```

### SMS Templates

SMS messages must be concise. Each notification type has a short-form SMS template:

```typescript
// src/notifications/sms-templates.ts

const SMS_TEMPLATES = {
  review_needed: (data: any) =>
    `[CrewShift] Review needed: ${data.title}. Open app to approve/reject. ${data.shortUrl}`,

  alert: (data: any) =>
    `[CrewShift] ALERT: ${data.title}. ${data.body ? data.body.slice(0, 100) : ''} ${data.shortUrl}`,

  // Digest notifications are NOT sent via SMS — email + in_app only
  // agent_action notifications are NOT sent via SMS by default (too noisy)

  // Special alert subtypes
  overdue_invoice: (data: any) =>
    `[CrewShift] Invoice #${data.invoiceNumber} for ${data.customerName} is ${data.daysOverdue} days overdue ($${data.amount}). ${data.shortUrl}`,

  compliance_deadline: (data: any) =>
    `[CrewShift] ${data.itemName} expires in ${data.daysUntil} days. Take action now. ${data.shortUrl}`,

  tier_limit_warning: (data: any) =>
    `[CrewShift] You've used ${data.percentUsed}% of your monthly ${data.resource}. Upgrade to avoid interruption. ${data.shortUrl}`,
};

// Max SMS length: 160 chars for single segment, up to 1600 for concatenated
// Target: keep under 160 chars when possible (cost + reliability)
```

### Opt-In / Opt-Out

SMS requires explicit opt-in per TCPA regulations:

```typescript
// Opt-in flow:
// 1. User enters phone number in Settings
// 2. CrewShift sends verification SMS: "Reply YES to receive CrewShift alerts via SMS"
// 3. User replies YES
// 4. profiles.settings.notification_preferences.sms_opted_in = true
// 5. profiles.phone is verified

// Opt-out flow:
// 1. User replies STOP to any CrewShift SMS
// 2. Twilio automatically handles STOP (required by carriers)
// 3. Webhook /api/webhooks/twilio/status receives opt-out event
// 4. profiles.settings.notification_preferences.sms_opted_in = false
// 5. No further SMS sent until user re-opts in

// Alternatively, user can disable SMS in Settings UI → PATCH /api/profiles/me
```

### Rate Limits

| Limit | Value | Reason |
|-------|-------|--------|
| Per-user SMS per hour | 5 | Prevent notification storms from overwhelming a user |
| Per-user SMS per day | 20 | Daily cap to prevent cost overruns and user annoyance |
| Per-org SMS per day | 100 (Starter), 500 (Pro), 2000 (Business) | Tier-based org-level cap |
| Quiet hours | 9pm - 7am local time | No SMS during sleeping hours (except `critical` urgency) |

```typescript
// src/notifications/sms-rate-limiter.ts

async function checkSmsRateLimit(userId: string, orgId: string, urgency: string): Promise<boolean> {
  const hourKey = `sms:rate:${userId}:hour:${getCurrentHour()}`;
  const dayKey = `sms:rate:${userId}:day:${getCurrentDate()}`;
  const orgDayKey = `sms:rate:org:${orgId}:day:${getCurrentDate()}`;

  const [hourCount, dayCount, orgDayCount] = await Promise.all([
    redis.incr(hourKey),
    redis.incr(dayKey),
    redis.incr(orgDayKey),
  ]);

  // Set TTLs on first increment
  if (hourCount === 1) await redis.expire(hourKey, 3600);
  if (dayCount === 1) await redis.expire(dayKey, 86400);
  if (orgDayCount === 1) await redis.expire(orgDayKey, 86400);

  // Critical urgency bypasses user-level limits (but not org-level)
  if (urgency === 'critical') {
    return orgDayCount <= getOrgSmsLimit(orgId);
  }

  // Check quiet hours (except critical)
  if (isQuietHours(userId)) return false;

  const orgLimit = await getOrgSmsLimit(orgId);
  return hourCount <= 5 && dayCount <= 20 && orgDayCount <= orgLimit;
}
```

---

## Push Notifications

### Web Push via Service Worker (Phase 2)

Web Push is deferred to Phase 2. When implemented:

```typescript
// Future: src/notifications/push.service.ts

import webpush from 'web-push';

// VAPID keys generated once and stored in env vars
webpush.setVapidDetails(
  'mailto:support@crewshift.com',
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

async function sendPushNotification(
  subscription: PushSubscription,
  payload: { title: string; body: string; url: string; icon?: string }
): Promise<void> {
  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: { url: payload.url },
      icon: payload.icon ?? '/icons/crewshift-192.png',
      badge: '/icons/crewshift-badge.png',
    })
  );
}

// Push subscriptions stored per user:
// profiles.settings.push_subscriptions: PushSubscription[]
// Updated when user grants notification permission in browser
```

### In-App via Supabase Realtime (Immediate)

This is the **primary** real-time notification delivery for Phase 1. No additional infrastructure needed — Supabase Realtime is already used for dashboard updates.

**How it works:**
1. Backend inserts row into `notifications` table
2. Supabase Realtime detects the INSERT via PostgreSQL logical replication
3. Realtime pushes the new row to all clients subscribed to the `org:{orgId}` channel
4. Frontend receives the payload and updates the notification bell icon badge count
5. If the notification has `urgency: 'high'` or `urgency: 'critical'`, a toast appears

**Why this approach:** Zero additional infrastructure. Supabase Realtime is already provisioned for agent activity and dashboard updates. Notifications piggyback on the same WebSocket connection. Sub-second delivery with no polling.

---

## Daily Digest

### What is Included

The daily digest aggregates the previous 24 hours of activity into a single notification:

| Section | Source | Description |
|---------|--------|-------------|
| **Alerts** | `notifications` table WHERE `type = 'alert'` AND unread | Any unresolved alerts from the past 24h |
| **Pending Reviews** | `agent_executions` WHERE `status = 'awaiting_review'` | Items sitting in the review queue |
| **Agent Activity Summary** | `agent_executions` WHERE `created_at > NOW() - interval '24h'` | Count of actions per agent type |
| **Insights** | Generated by AI from the activity data | 2-3 sentences of proactive intelligence (e.g., "Invoice volume up 30% vs last week") |

### Generation Process

```typescript
// Triggered by: scheduled.worker.ts → 'daily-digest' cron at 8am daily

async function generateDailyDigest(orgId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 1. Gather data
  const [alerts, pendingReviews, executions] = await Promise.all([
    getUnreadAlerts(orgId, since),
    getPendingReviews(orgId),
    getRecentExecutions(orgId, since),
  ]);

  // 2. Summarize agent activity by type
  const agentSummary = summarizeByAgentType(executions);
  // e.g., [{ agentName: 'Invoice Agent', count: 8 }, { agentName: 'Customer Agent', count: 12 }]

  // 3. Generate AI insights (optional, skip if no meaningful activity)
  let insights: string[] = [];
  if (executions.length > 0) {
    const insightsResponse = await aiClient.reason({
      prompt: 'daily_digest_insights',
      context: { agentSummary, alerts, pendingReviews, orgId },
      modelTier: 'fast', // GPT-5 Nano — keep cost low
    });
    insights = insightsResponse.insights ?? [];
  }

  // 4. Create in-app notification
  await createNotification({
    orgId,
    type: 'digest',
    title: `Daily Digest: ${executions.length} agent actions, ${pendingReviews.length} pending reviews`,
    body: formatDigestBody({ alerts, pendingReviews, agentSummary, insights }),
    actionUrl: '/dashboard',
    metadata: {
      digestType: 'daily',
      alertCount: alerts.length,
      reviewCount: pendingReviews.length,
      executionCount: executions.length,
    },
  });

  // 5. Send digest email to org owner + admins
  const recipients = await getOrgOwnersAndAdmins(orgId);
  for (const recipient of recipients) {
    const preferences = await getUserNotificationPreferences(recipient.id);
    if (preferences.digest?.email !== false) {
      const html = renderEmailTemplate('daily_digest', {
        date: formatDate(new Date()),
        alerts,
        pendingReviews,
        agentSummary,
        insights,
      });

      await notificationQueue.add('notification:email', {
        to: recipient.email,
        subject: `CrewShift Daily Digest - ${formatDate(new Date())}`,
        html,
      });
    }
  }
}
```

---

## Weekly Digest

### What is Included

The weekly digest is a business-level summary generated by the Insights Agent:

| Section | Source | Description |
|---------|--------|-------------|
| **Revenue** | `invoices` WHERE `paid_at` in past 7 days | Total collected revenue |
| **Jobs Completed** | `jobs` WHERE `status = 'completed'` AND `actual_end` in past 7 days | Job count |
| **Average Margin** | Calculated from `jobs.margin` for completed jobs | Profitability indicator |
| **Outstanding Invoices** | `invoices` WHERE `status IN ('sent', 'overdue')` | Total amount + count |
| **Estimates Sent / Accepted** | `estimates` sent and accepted in past 7 days | Conversion metric |
| **Agent Actions** | `agent_executions` count for past 7 days | Total automation volume |
| **AI Insights** | Generated by Insights Agent | 3-5 sentences of business intelligence |

### Generation Process

```typescript
// Triggered by: scheduled.worker.ts → 'weekly-digest' cron at Monday 9am

async function generateWeeklyDigest(orgId: string): Promise<void> {
  const weekStart = getLastMonday();
  const weekEnd = new Date();

  // 1. Gather business metrics
  const metrics = await gatherWeeklyMetrics(orgId, weekStart, weekEnd);
  // Returns: { revenue, jobsCompleted, avgMargin, outstandingAmount,
  //            outstandingCount, estimatesSent, estimatesAccepted, totalAgentActions }

  // 2. Dispatch Insights Agent for weekly analysis
  const insightsResult = await agentRuntime.execute({
    agentType: 'insights',
    triggerType: 'schedule',
    triggerSource: 'weekly-digest',
    orgId,
    inputData: {
      metrics,
      period: 'weekly',
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
    },
  });

  const weeklyInsights = insightsResult.output_data?.insights ?? [];

  // 3. Create in-app notification
  await createNotification({
    orgId,
    type: 'digest',
    title: `Weekly Summary: $${formatCurrency(metrics.revenue)} revenue, ${metrics.jobsCompleted} jobs completed`,
    body: formatWeeklyBody(metrics, weeklyInsights),
    actionUrl: '/dashboard/insights',
    metadata: {
      digestType: 'weekly',
      ...metrics,
    },
  });

  // 4. Send email to owner + admins
  const recipients = await getOrgOwnersAndAdmins(orgId);
  for (const recipient of recipients) {
    const html = renderEmailTemplate('weekly_digest', {
      weekStart: formatDate(weekStart),
      revenue: `$${formatCurrency(metrics.revenue)}`,
      jobsCompleted: metrics.jobsCompleted,
      avgMargin: metrics.avgMargin.toFixed(1),
      outstandingAmount: `$${formatCurrency(metrics.outstandingAmount)}`,
      outstandingCount: metrics.outstandingCount,
      estimatesSent: metrics.estimatesSent,
      estimatesAccepted: metrics.estimatesAccepted,
      totalAgentActions: metrics.totalAgentActions,
      weeklyInsights,
    });

    await notificationQueue.add('notification:email', {
      to: recipient.email,
      subject: `CrewShift Weekly Summary - Week of ${formatDate(weekStart)}`,
      html,
    });
  }
}
```

---

## Notification Preferences

### Per-User Settings Schema

Notification preferences are stored in `profiles.settings.notification_preferences`:

```typescript
interface NotificationPreferences {
  // Global opt-ins
  sms_opted_in: boolean;              // false by default, requires verification
  push_opted_in: boolean;             // false by default, requires browser permission
  phone_verified: boolean;            // set to true after SMS verification

  // Per-type channel preferences
  agent_action: {
    email: boolean;                   // default: false (too noisy for email)
    sms: boolean;                     // default: false
    push: boolean;                    // default: false
    // in_app is always true and not configurable
  };
  review_needed: {
    email: boolean;                   // default: true
    sms: boolean;                     // default: false
    push: boolean;                    // default: true
  };
  alert: {
    email: boolean;                   // default: true
    sms: boolean;                     // default: true (if opted in)
    push: boolean;                    // default: true
  };
  digest: {
    email: boolean;                   // default: true
    sms: boolean;                     // default: false (digests are too long for SMS)
    push: boolean;                    // default: false
    daily: boolean;                   // default: true — receive daily digest?
    weekly: boolean;                  // default: true — receive weekly digest?
  };

  // Quiet hours
  quiet_hours: {
    enabled: boolean;                 // default: true
    start: string;                    // default: '21:00' (9pm)
    end: string;                      // default: '07:00' (7am)
    timezone: string;                 // default: org timezone or 'America/New_York'
  };
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  sms_opted_in: false,
  push_opted_in: false,
  phone_verified: false,
  agent_action: { email: false, sms: false, push: false },
  review_needed: { email: true, sms: false, push: true },
  alert: { email: true, sms: true, push: true },
  digest: { email: true, sms: false, push: false, daily: true, weekly: true },
  quiet_hours: {
    enabled: true,
    start: '21:00',
    end: '07:00',
    timezone: 'America/New_York',
  },
};
```

### Why Stored in profiles.settings (Not a Separate Table)

**Decision rationale:** Notification preferences are always loaded alongside the user profile (needed on every authenticated request to resolve channels). Storing them as JSONB in the existing `profiles.settings` column avoids an extra JOIN and keeps the schema simple. If preferences become complex enough to warrant their own table (e.g., per-agent notification rules), we can migrate later without breaking the API — the `NotificationPreferences` interface stays the same.

---

## BullMQ Notification Worker

### Worker Implementation

```typescript
// src/queue/workers/notification.worker.ts

import { Worker, Job } from 'bullmq';
import { sendEmail } from '../../notifications/email.service';
import { sendSms, checkSmsRateLimit } from '../../notifications/sms.service';
import { sendPushNotification } from '../../notifications/push.service';
import { renderEmailTemplate } from '../../notifications/email-templates';
import { SMS_TEMPLATES } from '../../notifications/sms-templates';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';

interface NotificationJobData {
  notificationId: string;
  channel: 'email' | 'sms' | 'push';
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
}

const notificationWorker = new Worker(
  'notifications',
  async (job: Job<NotificationJobData>) => {
    const { channel, orgId, userId, type, title, body, actionUrl, metadata } = job.data;

    const requestId = job.data.metadata?.request_id ?? job.id;

    logger.info({
      jobId: job.id,
      channel,
      type,
      orgId,
      userId,
      requestId,
    }, 'Processing notification job');

    switch (channel) {
      case 'email': {
        const user = await getUserProfile(userId);
        if (!user?.email) {
          logger.warn({ userId }, 'No email address for user, skipping email notification');
          return;
        }

        const html = renderEmailTemplate(type as any, {
          title,
          body,
          actionUrl,
          ...metadata,
        });

        await sendEmail({
          to: user.email,
          subject: formatEmailSubject(type, title),
          html,
          tags: [
            { name: 'type', value: type },
            { name: 'org_id', value: orgId },
          ],
        });
        break;
      }

      case 'sms': {
        const user = await getUserProfile(userId);
        if (!user?.phone) {
          logger.warn({ userId }, 'No phone number for user, skipping SMS notification');
          return;
        }

        // Check rate limits
        const urgency = metadata?.urgency ?? 'low';
        const allowed = await checkSmsRateLimit(userId, orgId, urgency);
        if (!allowed) {
          logger.warn({ userId, orgId }, 'SMS rate limit exceeded, skipping');
          return;
        }

        const templateFn = SMS_TEMPLATES[type] ?? SMS_TEMPLATES.alert;
        const smsBody = templateFn({
          title,
          body,
          shortUrl: `https://app.crewshift.com/n/${job.data.notificationId}`,
          ...metadata,
        });

        await sendSms({
          to: user.phone,
          body: smsBody,
          orgId,
          notificationId: job.data.notificationId,
        });
        break;
      }

      case 'push': {
        const user = await getUserProfile(userId);
        const subscriptions = user?.settings?.push_subscriptions ?? [];

        if (subscriptions.length === 0) {
          logger.warn({ userId }, 'No push subscriptions for user, skipping');
          return;
        }

        // Send to all registered devices
        await Promise.allSettled(
          subscriptions.map((sub: any) =>
            sendPushNotification(sub, {
              title,
              body: body ?? title,
              url: actionUrl ? `https://app.crewshift.com${actionUrl}` : 'https://app.crewshift.com/dashboard',
            })
          )
        );
        break;
      }

      default:
        logger.error({ channel }, 'Unknown notification channel');
    }
  },
  {
    connection: redis,
    concurrency: 10, // Process up to 10 notifications in parallel
    limiter: {
      max: 50,       // Max 50 jobs per 10 seconds
      duration: 10000,
    },
  }
);

// Error handling
notificationWorker.on('failed', (job, error) => {
  logger.error({
    jobId: job?.id,
    channel: job?.data?.channel,
    error: error.message,
    attempts: job?.attemptsMade,
  }, 'Notification job failed');
});

notificationWorker.on('completed', (job) => {
  logger.info({
    jobId: job.id,
    channel: job.data.channel,
    type: job.data.type,
  }, 'Notification job completed');
});

function formatEmailSubject(type: string, title: string): string {
  switch (type) {
    case 'review_needed': return `[Action Required] ${title}`;
    case 'alert': return `[Alert] ${title}`;
    case 'agent_action': return title;
    case 'digest': return title; // digest titles are already descriptive
    default: return `CrewShift: ${title}`;
  }
}
```

### Retry Configuration

```typescript
// From queue/queues.ts
const notificationQueueConfig = {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 1000 }, // 1s, 1s, 1s
    removeOnComplete: { age: 86400, count: 5000 },     // keep 24h or 5000 completed
    removeOnFail: { age: 604800 },                      // keep failed 7 days for debugging
  },
};
```

**Why fixed backoff for notifications:** Email and SMS providers are either up or down. Exponential backoff adds unnecessary delay for a service that recovers quickly. 1-second fixed delay with 3 attempts handles transient network blips without keeping the user waiting.

---

## Agent to Notification Flow

The complete flow from agent execution to notification delivery:

```
Agent Execution Completes
          |
          v
  agent.worker.ts
          |
          |-- 1. Records execution in agent_executions table
          |-- 2. Determines notification type based on execution result:
          |       - status = 'completed' → type = 'agent_action'
          |       - status = 'awaiting_review' → type = 'review_needed'
          |       - status = 'failed' → type = 'alert'
          |
          v
  NotificationService.createNotification()
          |
          |-- 3. Loads user notification preferences
          |-- 4. Resolves channels (in_app always + configured channels)
          |-- 5. INSERTs row into notifications table
          |       |
          |       +---> Supabase Realtime detects INSERT
          |               |
          |               +---> WebSocket push to frontend
          |                       |
          |                       +---> Bell icon badge updates
          |                       +---> Toast for high-urgency items
          |
          |-- 6. Enqueues BullMQ jobs for each external channel
          |
          v
  BullMQ 'notifications' queue
          |
    +-----+-----+-----+
    |           |           |
    v           v           v
  email       sms         push
  worker      worker      worker
    |           |           |
    v           v           v
  Resend/     Twilio      Web Push
  SendGrid                API
```

### Timing Expectations

| Step | Expected Latency |
|------|-----------------|
| Agent execution completes to DB insert | < 50ms |
| DB insert to Supabase Realtime push | < 500ms |
| Realtime push to frontend bell update | < 200ms |
| BullMQ enqueue to email sent | 1-5 seconds |
| BullMQ enqueue to SMS sent | 1-3 seconds |
| **Total: agent action to user sees notification** | **< 2 seconds (in-app)** |
| **Total: agent action to email received** | **< 30 seconds** |

---

## Example Notification Templates

### Invoice Created (agent_action)

```json
{
  "type": "agent_action",
  "title": "Invoice #1247 created for Henderson",
  "body": "Invoice Agent generated a $1,840.00 invoice for the Henderson HVAC installation job. Synced to QuickBooks.",
  "channel": "in_app",
  "action_url": "/invoices/abc-123-uuid",
  "metadata": {
    "agent_type": "invoice",
    "execution_id": "exec-uuid-here",
    "entity_id": "invoice-uuid-here",
    "entity_type": "invoice",
    "urgency": "low",
    "amount": 1840.00,
    "customer_name": "Henderson"
  }
}
```

### Review Needed (review_needed)

```json
{
  "type": "review_needed",
  "title": "Invoice #1248 needs review - $8,500.00",
  "body": "Invoice Agent created a draft for the Martinez commercial job. Amount exceeds auto-approve threshold ($500). Confidence: 0.87.",
  "channel": "in_app",
  "action_url": "/agents/review-queue",
  "metadata": {
    "agent_type": "invoice",
    "execution_id": "exec-uuid-here",
    "entity_id": "invoice-uuid-here",
    "entity_type": "invoice",
    "urgency": "medium",
    "amount": 8500.00,
    "confidence": 0.87,
    "reason": "amount_over_threshold"
  }
}
```

### Overdue Alert (alert)

```json
{
  "type": "alert",
  "title": "Invoice #1201 is 45 days overdue",
  "body": "Johnson Plumbing owes $3,200.00 — 45 days past due. Collections Agent has sent 3 follow-ups. Consider escalating to phone call or preliminary lien notice.",
  "channel": "in_app",
  "action_url": "/invoices/invoice-uuid?tab=collections",
  "metadata": {
    "agent_type": "collections",
    "entity_id": "invoice-uuid-here",
    "entity_type": "invoice",
    "urgency": "high",
    "amount": 3200.00,
    "days_overdue": 45,
    "followups_sent": 3,
    "customer_name": "Johnson Plumbing"
  }
}
```

### Weekly Digest (digest)

```json
{
  "type": "digest",
  "title": "Weekly Summary: $24,800 revenue, 18 jobs completed",
  "body": "Revenue up 12% vs last week. Average margin: 41%. Outstanding: $8,400 across 6 invoices. 3 estimates pending response. Insights Agent identified: copper pipe costs increased 8% — consider adjusting estimate templates.",
  "channel": "in_app",
  "action_url": "/dashboard/insights",
  "metadata": {
    "digestType": "weekly",
    "urgency": "low",
    "revenue": 24800,
    "jobsCompleted": 18,
    "avgMargin": 41.2,
    "outstandingAmount": 8400,
    "outstandingCount": 6,
    "estimatesPending": 3,
    "totalAgentActions": 127
  }
}
```

---

## API Routes

### GET /api/notifications

List notifications for the authenticated user.

```typescript
// Request
GET /api/notifications?limit=25&cursor=xxx&type=review_needed&read=false

// Query parameters
interface NotificationListParams {
  limit?: number;          // default 25, max 100
  cursor?: string;         // cursor-based pagination
  type?: NotificationType; // filter by type
  read?: boolean;          // filter by read status
}

// Response
{
  "data": [
    {
      "id": "uuid",
      "type": "review_needed",
      "title": "Invoice #1248 needs review",
      "body": "Amount exceeds auto-approve threshold.",
      "channel": "in_app",
      "read": false,
      "action_url": "/agents/review-queue",
      "metadata": { "agent_type": "invoice", "urgency": "medium" },
      "created_at": "2026-03-04T14:30:00Z"
    }
  ],
  "meta": {
    "limit": 25,
    "has_more": true,
    "next_cursor": "eyJ...",
    "unread_count": 7     // bonus: total unread for badge
  }
}
```

### PATCH /api/notifications/:id/read

Mark a single notification as read.

```typescript
// Request
PATCH /api/notifications/uuid-here/read

// No request body needed

// Response
{
  "data": {
    "id": "uuid-here",
    "read": true
  }
}
```

### POST /api/notifications/read-all

Mark all notifications as read for the authenticated user.

```typescript
// Request
POST /api/notifications/read-all

// Optional body to scope:
{
  "type": "agent_action"  // optional: only mark this type as read
}

// Response
{
  "data": {
    "updated_count": 23
  }
}
```

### Route Implementation

```typescript
// src/routes/notifications.routes.ts

import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware';

export async function notificationRoutes(app: FastifyInstance) {
  // All notification routes require auth
  app.addHook('preHandler', authMiddleware);

  app.get('/api/notifications', async (request, reply) => {
    const { limit = 25, cursor, type, read } = request.query as any;
    const userId = request.userId;

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));

    if (type) query = query.eq('type', type);
    if (read !== undefined) query = query.eq('read', read);
    if (cursor) query = query.lt('created_at', decodeCursor(cursor));

    const { data, error } = await query;
    if (error) throw error;

    // Get unread count
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    return reply.send({
      data,
      meta: {
        limit,
        has_more: data.length === limit,
        next_cursor: data.length > 0 ? encodeCursor(data[data.length - 1].created_at) : null,
        unread_count: unreadCount ?? 0,
      },
    });
  });

  app.patch('/api/notifications/:id/read', async (request, reply) => {
    const { id } = request.params as any;
    const userId = request.userId;

    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', userId) // RLS + explicit check
      .select()
      .single();

    if (error || !data) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });

    return reply.send({ data: { id: data.id, read: true } });
  });

  app.post('/api/notifications/read-all', async (request, reply) => {
    const userId = request.userId;
    const { type } = (request.body as any) ?? {};

    let query = supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (type) query = query.eq('type', type);

    const { data, error, count } = await query.select('id');

    if (error) throw error;

    return reply.send({ data: { updated_count: data?.length ?? 0 } });
  });
}
```

---

## Implementation Notes

1. **In-app is always the source of truth.** Every notification creates a DB row. External channels (email, SMS, push) are delivery mechanisms that reference the DB row. If email fails, the in-app notification still exists.

2. **Notification deduplication.** The `metadata.execution_id` field prevents duplicate notifications for the same agent execution. If a BullMQ job retries, the worker checks whether a notification for that execution already exists before creating another.

3. **Bulk notification batching.** When a scheduled job (like overdue detection) creates notifications for 50 orgs, it batches the `notifications` inserts and BullMQ enqueues to avoid overwhelming the database and queue.

4. **Email unsubscribe compliance.** Every email includes an unsubscribe link in the footer. Clicking it sets the user's preference for that notification type's email channel to `false`. This is required for CAN-SPAM compliance.

5. **SMS cost management.** Each SMS segment costs ~$0.0079 (Twilio US pricing). At scale (1,000 orgs, 5 SMS/org/day), monthly SMS cost is approximately $1,185. Rate limiting and smart channel selection keep this manageable.

6. **Future: notification grouping.** When an agent chain creates 4 notifications in rapid succession (job complete triggers invoice, inventory, customer, bookkeeping), the frontend could group these into a single expandable notification. This is a frontend concern, not a backend change — the backend always creates individual records.
