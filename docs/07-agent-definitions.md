# 07 — Agent Definitions (All 9 Agents)

> Permanent reference for every pre-built agent in CrewShift. Each agent's full definition: triggers, inputs, steps, outputs, autonomy rules, chain rules, prompts, data reads/writes, and external syncs. The Invoice Agent is the canonical template; all others follow the same pattern.

---

## Table of Contents

1. [Agent Categories](#agent-categories)
2. [Invoice Agent](#1-invoice-agent) (canonical template)
3. [Estimate Agent](#2-estimate-agent)
4. [Collections Agent](#3-collections-agent)
5. [Bookkeeping Agent](#4-bookkeeping-agent)
6. [Insights Agent](#5-insights-agent)
7. [Field Ops Agent](#6-field-ops-agent)
8. [Compliance Agent](#7-compliance-agent)
9. [Inventory Agent](#8-inventory-agent)
10. [Customer Agent](#9-customer-agent)
11. [Default Autonomy Rules Summary](#default-autonomy-rules-summary)

---

## Agent Categories

| Category | Agents | Description |
|---|---|---|
| **money-admin** | Invoice, Estimate, Collections, Bookkeeping, Insights | Back-office financial operations |
| **field-ops** | Field Ops, Compliance, Inventory | Field operations and logistics |
| **customer-sales** | Customer | Customer-facing communication, reputation, sales |

All 9 agents are instances of the same `AgentDefinition` interface (see [06-agent-runtime.md](./06-agent-runtime.md)). They differ only in their configuration.

---

## 1. Invoice Agent

**Category:** money-admin
**Purpose:** Job completion data becomes professional invoices with line items, labor, materials, and tax. Sends to customers, tracks payment, syncs with QuickBooks/Xero.

### Full Definition

```typescript
// src/agents/definitions/invoice.agent.ts

import { AgentDefinition } from '../types';

export const invoiceAgent: AgentDefinition = {
  type: 'invoice',
  name: 'Invoice Agent',
  category: 'money-admin',

  triggers: [
    {
      type: 'event',
      event: 'job.completed',
      condition: 'job.total_amount > 0',
    },
    {
      type: 'chat',
      intent: 'create-invoice',
    },
    {
      type: 'chat',
      intent: 'generate-invoice',
    },
    {
      type: 'chain',
      event: 'estimate.accepted',
    },
  ],

  inputs: [
    { source: 'db', table: 'jobs', fields: ['*'], relation: 'trigger.job_id' },
    { source: 'db', table: 'customers', fields: ['*'], relation: 'job.customer_id' },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type'] },
    { source: 'context', key: 'pricing' },
    { source: 'context', key: 'invoice_preferences' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        description: 'Fetch job details, customer info, org settings, and past invoices for this customer',
        queries: [
          { table: 'jobs', relation: 'trigger.job_id', fields: ['*'] },
          { table: 'customers', relation: 'job.customer_id', fields: ['*'] },
          { table: 'organizations', relation: 'trigger.org_id', fields: ['settings', 'trade_type'] },
          { table: 'invoices', filter: { customer_id: 'job.customer_id' }, limit: 5, order: 'created_at DESC' },
          { table: 'business_context', filter: { category: 'pricing' } },
          { table: 'business_context', filter: { category: 'preference', key: 'invoice_preferences' } },
        ],
      },
    },
    {
      id: 'generate_invoice',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'invoice',
        model_tier: 'capable',
        output_schema: {
          line_items: [{
            description: 'string',
            quantity: 'number',
            unit_price: 'number',
            total: 'number',
          }],
          subtotal: 'number',
          tax_rate: 'number',
          tax_amount: 'number',
          total: 'number',
          notes: 'string',
          payment_terms: 'string',
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'line_items.length > 0',
          'subtotal === sum(line_items.total)',
          'total === subtotal + tax_amount',
          'total > 0',
          'total <= job.total_amount * 1.5',
          'tax_rate >= 0 && tax_rate <= 0.15',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'create_invoice',
      type: 'integrate',
      config: {
        action: 'create',
        target: 'invoices',
        sync_to: ['quickbooks', 'xero'],
      },
    },
    {
      id: 'generate_pdf',
      type: 'integrate',
      config: {
        action: 'generate_pdf',
        template: 'invoice',
        store: 's3',
      },
      optional: true,
    },
    {
      id: 'notify',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Invoice #{invoice_number} created',
        body: 'Invoice for {customer.name} — ${total}',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'db_record', table: 'invoices' },
    { type: 'external_sync', provider: 'quickbooks' },
    { type: 'pdf', storage: 's3' },
    { type: 'notification' },
  ],

  autonomy: {
    auto: [
      'create_invoice where total < 500 AND confidence > 0.9',
      'generate_pdf',
      'sync_to_quickbooks',
    ],
    review: [
      'create_invoice where total >= 500',
      'create_invoice where confidence < 0.9',
      'send_to_customer',
    ],
    escalate: [
      'create_invoice where confidence < 0.6',
      'create_invoice where total > 10000',
    ],
    thresholds: {
      amount_over: 500,
      confidence_below: 0.9,
      escalate_amount_over: 10000,
      escalate_confidence_below: 0.6,
    },
  },

  chains: [
    { event: 'invoice.created', targets: ['collections', 'bookkeeping'] },
    { event: 'invoice.sent', targets: ['customer'] },
  ],
};
```

### Prompt Used

The Invoice Agent uses the `invoice` prompt template from `apps/ai-service/app/prompts/invoice.py`. The prompt includes:

- System context: "You are an invoice generation agent for a {trade_type} business."
- Input: job details (line items, labor hours, materials, job type), customer info (name, address, payment history), org settings (tax rate, rounding preference, terms), past invoices for reference
- Instructions: generate accurate line items from job data, apply correct tax rate, use org-specific formatting preferences, include payment terms, match historical pricing patterns
- Output schema: enforced JSON structure matching the `output_schema` above

### Data Reads

| Source | Table/Key | What It Reads |
|---|---|---|
| DB | `jobs` | Full job record: line_items, materials, labor_hours, total_amount, description |
| DB | `customers` | Customer name, email, address, payment_score, lifetime_value |
| DB | `organizations` | trade_type, settings (tax_rate, invoice_prefix, payment_terms) |
| DB | `invoices` | Last 5 invoices for this customer (for pricing reference) |
| Business Context | `pricing` | Learned pricing patterns by job type |
| Business Context | `invoice_preferences` | Rounding rules, default terms, formatting |

### Data Writes

| Target | What It Writes |
|---|---|
| `invoices` table | Full invoice record: line_items, subtotal, tax, total, status='draft' or 'review', generated_by='agent' |
| QuickBooks/Xero | Creates matching invoice in accounting system (if connected) |
| S3/R2 | PDF of the invoice |
| `notifications` table | In-app notification that invoice was created |

### External Syncs

| Provider | Action | When |
|---|---|---|
| QuickBooks Online | Create invoice | After invoice created in CrewShift DB |
| Xero | Create invoice | After invoice created in CrewShift DB (if connected instead of QBO) |
| Stripe | Create payment link | If payment link is configured for this invoice |

---

## 2. Estimate Agent

**Category:** money-admin
**Purpose:** Photos + scope descriptions become detailed estimates with local pricing, materials, labor. Also handles change orders (mid-job scope/price adjustments) and formal proposals for larger/commercial jobs. Pulls from historical job data.

### Full Definition

```typescript
// src/agents/definitions/estimate.agent.ts

export const estimateAgent: AgentDefinition = {
  type: 'estimate',
  name: 'Estimate Agent',
  category: 'money-admin',

  triggers: [
    {
      type: 'event',
      event: 'estimate.requested',
    },
    {
      type: 'chat',
      intent: 'create-estimate',
    },
    {
      type: 'chat',
      intent: 'generate-estimate',
    },
    {
      type: 'chat',
      intent: 'create-change-order',
    },
    {
      type: 'chat',
      intent: 'create-proposal',
    },
  ],

  inputs: [
    { source: 'db', table: 'customers', fields: ['*'], relation: 'trigger.customer_id' },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type'] },
    { source: 'context', key: 'pricing' },
    { source: 'context', key: 'estimate_preferences' },
    { source: 'event_payload' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'customers', relation: 'trigger.customer_id', fields: ['*'] },
          { table: 'organizations', relation: 'trigger.org_id', fields: ['settings', 'trade_type'] },
          { table: 'estimates', filter: { customer_id: 'trigger.customer_id' }, limit: 5, order: 'created_at DESC' },
          { table: 'jobs', filter: { type: 'trigger.job_type' }, limit: 10, order: 'created_at DESC' },
          { table: 'business_context', filter: { category: 'pricing' } },
          { table: 'parts', filter: { category: 'trigger.trade_category' } },
        ],
      },
    },
    {
      id: 'analyze_photos',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/vision',
        prompt_template: 'estimate_vision',
        model_tier: 'vision',
        description: 'If photos provided, analyze them for materials, measurements, conditions',
      },
      optional: true,
      timeout: 45000,
    },
    {
      id: 'generate_estimate',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'estimate',
        model_tier: 'capable',
        output_schema: {
          type: 'string',
          line_items: [{
            description: 'string',
            quantity: 'number',
            unit_price: 'number',
            total: 'number',
            category: 'string',
          }],
          materials: [{
            name: 'string',
            quantity: 'number',
            unit_cost: 'number',
            total: 'number',
          }],
          labor_hours: 'number',
          labor_rate: 'number',
          subtotal: 'number',
          tax_amount: 'number',
          total: 'number',
          scope_description: 'string',
          notes: 'string',
          valid_until_days: 'number',
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'line_items.length > 0',
          'total > 0',
          'total === subtotal + tax_amount',
          'labor_hours >= 0',
          'valid_until_days >= 7',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'create_estimate',
      type: 'integrate',
      config: {
        action: 'create',
        target: 'estimates',
      },
    },
    {
      id: 'generate_pdf',
      type: 'integrate',
      config: {
        action: 'generate_pdf',
        template: 'estimate',
        store: 's3',
      },
      optional: true,
    },
    {
      id: 'notify',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Estimate #{estimate_number} created',
        body: 'Estimate for {customer.name} — ${total} ({type})',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'db_record', table: 'estimates' },
    { type: 'pdf', storage: 's3' },
    { type: 'notification' },
  ],

  autonomy: {
    auto: [
      'create_estimate where total < 1000 AND confidence > 0.85',
      'generate_pdf',
    ],
    review: [
      'create_estimate where total >= 1000',
      'create_estimate where confidence < 0.85',
      'create_estimate where type === "proposal"',
      'create_estimate where type === "change_order"',
      'send_to_customer',
    ],
    escalate: [
      'create_estimate where confidence < 0.6',
      'create_estimate where total > 25000',
    ],
    thresholds: {
      amount_over: 1000,
      confidence_below: 0.85,
      escalate_amount_over: 25000,
      escalate_confidence_below: 0.6,
    },
  },

  chains: [
    { event: 'estimate.generated', targets: ['customer'] },
  ],
};
```

### Prompt Used

The `estimate` prompt template includes:
- System: "You are an estimate generation agent for a {trade_type} business."
- Input: scope description (from user or extracted from photos), customer info, historical pricing for similar jobs, current parts pricing, trade-specific materials data, photo analysis results (if photos were provided)
- Instructions: generate detailed line items with materials and labor, use local/historical pricing data, include scope description, set validity period, calculate realistic labor hours, factor in complexity from photos
- For change orders: compare against original estimate, show delta
- For proposals: more formal language, include timeline, warranty info

### Data Reads

| Source | What It Reads |
|---|---|
| `customers` | Customer name, address, history |
| `organizations` | trade_type, settings (tax rate, labor rate) |
| `estimates` | Last 5 estimates for this customer |
| `jobs` | Last 10 similar jobs (for pricing reference) |
| Business Context: `pricing` | Learned pricing patterns by job type and region |
| `parts` | Current parts inventory and pricing |
| Photos (via /ai/vision) | Materials identified, measurements, conditions |

### Data Writes

| Target | What It Writes |
|---|---|
| `estimates` table | Full estimate record with line_items, materials, scope, confidence_score, generated_by='agent' |
| S3/R2 | PDF of the estimate |
| `notifications` | In-app notification |

---

## 3. Collections Agent

**Category:** money-admin
**Purpose:** Monitors outstanding invoices, sends escalating follow-ups with smart timing/tone, tracks preliminary notice deadlines and lien filing windows, flags accounts needing human attention, predicts cash flow risk.

### Full Definition

```typescript
// src/agents/definitions/collections.agent.ts

export const collectionsAgent: AgentDefinition = {
  type: 'collections',
  name: 'Collections Agent',
  category: 'money-admin',

  triggers: [
    {
      type: 'event',
      event: 'invoice.created',
    },
    {
      type: 'event',
      event: 'invoice.overdue',
    },
    {
      type: 'event',
      event: 'payment.received',
    },
    {
      type: 'chat',
      intent: 'check-collections',
    },
    {
      type: 'chat',
      intent: 'outstanding-invoices',
    },
    {
      type: 'chat',
      intent: 'send-reminder',
    },
    {
      type: 'schedule',
      cron: '0 9 * * *',
      condition: 'true',
    },
  ],

  inputs: [
    { source: 'db', table: 'invoices', fields: ['*'], relation: 'trigger.invoice_id' },
    { source: 'db', table: 'customers', fields: ['*'], relation: 'invoice.customer_id' },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type'] },
    { source: 'context', key: 'collections_preferences' },
    { source: 'context', key: 'customer_payment_patterns' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'invoices', filter: { status: ['sent', 'overdue'] }, order: 'due_date ASC' },
          { table: 'customers', relation: 'invoice.customer_id', fields: ['*'] },
          { table: 'agent_executions', filter: { agent_type: 'collections', status: 'completed' }, limit: 10 },
          { table: 'business_context', filter: { category: 'customer', key_prefix: 'payment_history' } },
        ],
      },
    },
    {
      id: 'assess_collection_strategy',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'collections',
        model_tier: 'capable',
        output_schema: {
          actions: [{
            invoice_id: 'string',
            action_type: 'string',
            message_tone: 'string',
            message_content: 'string',
            channel: 'string',
            urgency: 'string',
            lien_deadline: 'string|null',
            days_until_lien_deadline: 'number|null',
          }],
          cash_flow_risk: {
            total_outstanding: 'number',
            at_risk_amount: 'number',
            predicted_collection_rate: 'number',
          },
          accounts_needing_attention: [{
            customer_id: 'string',
            reason: 'string',
            recommended_action: 'string',
          }],
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'actions.length >= 0',
          'cash_flow_risk.total_outstanding >= 0',
          'cash_flow_risk.predicted_collection_rate >= 0 && cash_flow_risk.predicted_collection_rate <= 1',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'execute_follow_ups',
      type: 'integrate',
      config: {
        action: 'send_messages',
        target: 'notifications',
        channels: ['email', 'sms'],
      },
    },
    {
      id: 'update_invoice_status',
      type: 'integrate',
      config: {
        action: 'update',
        target: 'invoices',
      },
    },
    {
      id: 'notify',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Collections update',
        body: '{actions_count} follow-ups sent. ${total_outstanding} outstanding.',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'email' },
    { type: 'sms' },
    { type: 'notification' },
    { type: 'db_record', table: 'invoices' },
  ],

  autonomy: {
    auto: [
      'send_first_reminder where days_overdue <= 7',
      'update_invoice_status',
      'generate_collections_report',
    ],
    review: [
      'send_follow_up where days_overdue > 7',
      'send_final_notice',
      'flag_for_lien where days_until_deadline < 30',
    ],
    escalate: [
      'send_legal_notice',
      'flag_for_lien where days_until_deadline < 14',
      'customer_dispute',
    ],
    thresholds: {
      amount_over: 2000,
      confidence_below: 0.8,
    },
  },

  chains: [
    { event: 'collections.followup_sent', targets: ['customer'] },
    { event: 'collections.payment_predicted', targets: ['insights'] },
  ],
};
```

### Prompt Used

The `collections` prompt template includes:
- System: "You are a collections agent for a {trade_type} business. Your job is to recover outstanding payments while maintaining good customer relationships."
- Input: all outstanding invoices with aging, customer payment history and score, previous collection attempts (from agent_executions), lien filing deadlines per state, org preferences for tone and timing
- Instructions: assess each outstanding invoice, determine appropriate action (gentle reminder, firm follow-up, final notice, escalation), calculate lien deadlines based on state law, predict cash flow risk, flag accounts needing human attention
- Tone guidance: friendly for <7 days overdue, professional/firm for 7-30 days, serious for 30-60 days, final notice/legal for >60 days

### Data Reads

| Source | What It Reads |
|---|---|
| `invoices` | All outstanding invoices (status: sent, overdue) |
| `customers` | Payment score, contact info, payment history |
| `agent_executions` | Previous collection attempts and their outcomes |
| Business Context: `collections_preferences` | Tone, timing, escalation thresholds |
| Business Context: `customer_payment_patterns` | Historical payment behavior |
| Organization settings | State (for lien law), trade type |

### Data Writes

| Target | What It Writes |
|---|---|
| Email/SMS (via Twilio, Resend) | Follow-up messages to customers |
| `invoices` table | Status updates (sent -> overdue) |
| `notifications` | In-app alerts about collections status |
| `agent_executions` | Full log of what was sent and why |

---

## 4. Bookkeeping Agent

**Category:** money-admin
**Purpose:** Categorizes expenses, tracks revenue by tech/job type, prepares accounting data, flags anomalies. Tracks tech hours from GPS + job completion timestamps, calculates overtime, flags discrepancies, prepares payroll data.

### Full Definition

```typescript
// src/agents/definitions/bookkeeping.agent.ts

export const bookkeepingAgent: AgentDefinition = {
  type: 'bookkeeping',
  name: 'Bookkeeping Agent',
  category: 'money-admin',

  triggers: [
    {
      type: 'event',
      event: 'job.completed',
    },
    {
      type: 'event',
      event: 'invoice.created',
    },
    {
      type: 'event',
      event: 'invoice.paid',
    },
    {
      type: 'event',
      event: 'payment.received',
    },
    {
      type: 'chat',
      intent: 'categorize-expense',
    },
    {
      type: 'chat',
      intent: 'revenue-report',
    },
    {
      type: 'chat',
      intent: 'payroll-report',
    },
    {
      type: 'schedule',
      cron: '0 22 * * *',
    },
  ],

  inputs: [
    { source: 'db', table: 'jobs', fields: ['*'], relation: 'trigger.job_id' },
    { source: 'db', table: 'invoices', fields: ['*'], relation: 'trigger.invoice_id' },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type'] },
    { source: 'context', key: 'expense_categories' },
    { source: 'context', key: 'accounting_preferences' },
    { source: 'integration', provider: 'quickbooks' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'jobs', filter: { status: 'completed' }, limit: 50, order: 'completed_at DESC' },
          { table: 'invoices', filter: { status: ['paid', 'sent'] }, limit: 50 },
          { table: 'profiles', filter: { role: 'tech' } },
          { table: 'business_context', filter: { category: 'operational' } },
        ],
      },
    },
    {
      id: 'categorize_and_analyze',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'bookkeeping',
        model_tier: 'capable',
        output_schema: {
          expense_categorizations: [{
            source_id: 'string',
            category: 'string',
            subcategory: 'string',
            amount: 'number',
            account_code: 'string',
          }],
          revenue_summary: {
            total_revenue: 'number',
            by_tech: 'object',
            by_job_type: 'object',
            by_customer: 'object',
          },
          anomalies: [{
            type: 'string',
            description: 'string',
            severity: 'string',
            amount: 'number',
          }],
          payroll_data: [{
            tech_id: 'string',
            regular_hours: 'number',
            overtime_hours: 'number',
            discrepancies: 'string[]',
          }],
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'revenue_summary.total_revenue >= 0',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'sync_accounting',
      type: 'integrate',
      config: {
        action: 'sync_categorizations',
        target: 'quickbooks',
      },
      optional: true,
    },
    {
      id: 'notify_anomalies',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Bookkeeping update',
        body: '{categorization_count} transactions categorized. {anomaly_count} anomalies flagged.',
        condition: 'anomalies.length > 0',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'external_sync', provider: 'quickbooks' },
    { type: 'notification' },
    { type: 'db_record', table: 'business_context' },
  ],

  autonomy: {
    auto: [
      'categorize_expense where confidence > 0.9',
      'track_revenue',
      'calculate_tech_hours',
    ],
    review: [
      'categorize_expense where confidence < 0.9',
      'flag_anomaly',
      'prepare_payroll_data',
    ],
    escalate: [
      'anomaly where severity === "high"',
      'payroll_discrepancy where hours_difference > 4',
    ],
    thresholds: {
      confidence_below: 0.9,
    },
  },

  chains: [
    { event: 'bookkeeping.categorized', targets: ['insights'] },
    { event: 'bookkeeping.anomaly_detected', targets: ['insights'] },
  ],
};
```

### Prompt Used

The `bookkeeping` prompt template includes:
- System: "You are a bookkeeping agent for a {trade_type} business."
- Input: completed jobs with line items and materials costs, invoices and payments, tech work hours (from job timestamps), QuickBooks chart of accounts (if connected), historical categorizations
- Instructions: categorize each expense to the correct account, calculate revenue by tech/job type/customer, detect anomalies (unusual costs, duplicate charges, margin outliers), calculate tech hours and overtime, prepare payroll data

### Data Reads

| Source | What It Reads |
|---|---|
| `jobs` | Completed jobs: costs, materials, labor |
| `invoices` | Paid/outstanding invoices |
| `profiles` | Tech team members |
| QuickBooks (if connected) | Chart of accounts, existing categorizations |
| Business Context | Expense category mappings, accounting preferences |

### Data Writes

| Target | What It Writes |
|---|---|
| QuickBooks | Expense categorizations, journal entries |
| `business_context` | Updated revenue/expense patterns |
| `notifications` | Anomaly alerts |

---

## 5. Insights Agent

**Category:** money-admin (growth)
**Purpose:** Proactively surfaces business intelligence. Analyzes margins across job types, suggests pricing adjustments, predicts busy/slow periods, generates reports. Does not wait to be asked.

### Full Definition

```typescript
// src/agents/definitions/insights.agent.ts

export const insightsAgent: AgentDefinition = {
  type: 'insights',
  name: 'Insights Agent',
  category: 'money-admin',

  triggers: [
    {
      type: 'chat',
      intent: 'business-report',
    },
    {
      type: 'chat',
      intent: 'how-did-we-do',
    },
    {
      type: 'chat',
      intent: 'pricing-analysis',
    },
    {
      type: 'chat',
      intent: 'demand-forecast',
    },
    {
      type: 'schedule',
      cron: '0 7 * * 1',
    },
    {
      type: 'schedule',
      cron: '0 7 1 * *',
    },
    {
      type: 'event',
      event: 'bookkeeping.categorized',
    },
  ],

  inputs: [
    { source: 'db', table: 'jobs', fields: ['*'] },
    { source: 'db', table: 'invoices', fields: ['*'] },
    { source: 'db', table: 'estimates', fields: ['*'] },
    { source: 'db', table: 'customers', fields: ['*'] },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type'] },
    { source: 'context', key: 'pricing' },
    { source: 'context', key: 'seasonal_patterns' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'jobs', filter: { created_at_gte: '30_days_ago' }, order: 'created_at DESC' },
          { table: 'invoices', filter: { created_at_gte: '30_days_ago' } },
          { table: 'estimates', filter: { created_at_gte: '90_days_ago' } },
          { table: 'customers', fields: ['id', 'name', 'lifetime_value', 'payment_score'] },
          { table: 'agent_executions', filter: { created_at_gte: '30_days_ago' } },
          { table: 'business_context', filter: { category: ['pricing', 'operational'] } },
        ],
      },
    },
    {
      id: 'generate_insights',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'insights',
        model_tier: 'complex',
        output_schema: {
          summary: 'string',
          kpis: {
            revenue: 'number',
            revenue_change_pct: 'number',
            avg_job_margin: 'number',
            margin_change_pct: 'number',
            jobs_completed: 'number',
            outstanding_ar: 'number',
            collection_rate: 'number',
            avg_ticket_size: 'number',
            estimate_win_rate: 'number',
            tech_utilization: 'number',
          },
          insights: [{
            category: 'string',
            title: 'string',
            description: 'string',
            impact: 'string',
            recommended_action: 'string',
            priority: 'string',
          }],
          pricing_recommendations: [{
            job_type: 'string',
            current_avg: 'number',
            recommended: 'number',
            reason: 'string',
          }],
          demand_forecast: {
            next_30_days: 'string',
            trend: 'string',
            staffing_recommendation: 'string',
          },
        },
      },
      timeout: 45000,
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'store_insights',
      type: 'integrate',
      config: {
        action: 'create',
        target: 'business_context',
      },
    },
    {
      id: 'notify',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Weekly Business Insights',
        body: '{summary}',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'db_record', table: 'business_context' },
    { type: 'notification' },
  ],

  autonomy: {
    auto: [
      'generate_weekly_report',
      'generate_monthly_report',
      'update_business_context',
    ],
    review: [
      'pricing_recommendation',
      'staffing_recommendation',
    ],
    escalate: [
      'revenue_drop_over_20_pct',
      'margin_anomaly',
    ],
    thresholds: {
      confidence_below: 0.7,
    },
  },

  chains: [
    { event: 'insights.report_generated', targets: ['customer'] },
  ],
};
```

### Prompt Used

The `insights` prompt template includes:
- System: "You are a business intelligence analyst for a {trade_type} business. You proactively surface insights and recommendations."
- Input: 30/60/90-day job data, invoice data, estimate win rates, customer acquisition, tech performance, seasonal historical data
- Instructions: calculate KPIs, compare to previous period, identify trends and anomalies, recommend pricing adjustments based on win rates and costs, forecast demand based on historical patterns and seasonality, suggest staffing changes
- Uses `complex` model tier (Claude Opus / GPT-5.2) for nuanced analysis

---

## 6. Field Ops Agent

**Category:** field-ops
**Purpose:** The field coordinator. Optimizes scheduling and dispatch based on tech location, skill, priority, customer history. Manages real-time changes, communicates to field teams, tracks job progress.

### Full Definition

```typescript
// src/agents/definitions/field-ops.agent.ts

export const fieldOpsAgent: AgentDefinition = {
  type: 'field-ops',
  name: 'Field Ops Agent',
  category: 'field-ops',

  triggers: [
    {
      type: 'event',
      event: 'job.scheduled',
    },
    {
      type: 'event',
      event: 'job.updated',
      condition: 'changes.includes("scheduled_start") || changes.includes("assigned_tech_id")',
    },
    {
      type: 'chat',
      intent: 'schedule-job',
    },
    {
      type: 'chat',
      intent: 'dispatch-tech',
    },
    {
      type: 'chat',
      intent: 'reschedule-job',
    },
    {
      type: 'chat',
      intent: 'check-schedule',
    },
    {
      type: 'schedule',
      cron: '0 6 * * *',
    },
  ],

  inputs: [
    { source: 'db', table: 'jobs', fields: ['*'] },
    { source: 'db', table: 'profiles', fields: ['*'] },
    { source: 'db', table: 'customers', fields: ['*'], relation: 'job.customer_id' },
    { source: 'db', table: 'organizations', fields: ['settings'] },
    { source: 'context', key: 'tech_skills' },
    { source: 'context', key: 'scheduling_preferences' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'jobs', filter: { status: ['pending', 'scheduled'], scheduled_start_gte: 'today' } },
          { table: 'profiles', filter: { role: 'tech' }, fields: ['id', 'full_name', 'phone', 'metadata'] },
          { table: 'customers', relation: 'job.customer_id' },
          { table: 'business_context', filter: { category: 'operational', key_prefix: 'tech_' } },
        ],
      },
    },
    {
      id: 'optimize_schedule',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'field_ops',
        model_tier: 'capable',
        output_schema: {
          schedule_actions: [{
            job_id: 'string',
            action: 'string',
            assigned_tech_id: 'string',
            scheduled_start: 'string',
            scheduled_end: 'string',
            reason: 'string',
          }],
          notifications: [{
            tech_id: 'string',
            message: 'string',
            channel: 'string',
          }],
          conflicts: [{
            type: 'string',
            description: 'string',
            resolution: 'string',
          }],
          daily_summary: {
            total_jobs: 'number',
            techs_scheduled: 'number',
            estimated_drive_time: 'number',
            notes: 'string',
          },
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'schedule_actions.every(a => a.assigned_tech_id)',
          'schedule_actions.every(a => a.scheduled_start)',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'update_jobs',
      type: 'integrate',
      config: {
        action: 'update_batch',
        target: 'jobs',
        sync_to: ['jobber', 'servicetitan'],
      },
    },
    {
      id: 'notify_techs',
      type: 'notify',
      config: {
        channel: 'sms',
        template: 'tech_schedule_update',
      },
      optional: true,
    },
    {
      id: 'notify_office',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Schedule optimized',
        body: '{daily_summary.total_jobs} jobs scheduled for {daily_summary.techs_scheduled} techs.',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'db_record', table: 'jobs' },
    { type: 'external_sync', provider: 'jobber' },
    { type: 'sms' },
    { type: 'notification' },
  ],

  autonomy: {
    auto: [
      'assign_tech where single_available_match',
      'send_schedule_notification',
      'generate_daily_summary',
    ],
    review: [
      'reassign_tech',
      'reschedule_job',
      'resolve_scheduling_conflict',
    ],
    escalate: [
      'no_tech_available',
      'customer_schedule_conflict',
      'emergency_dispatch',
    ],
    thresholds: {
      confidence_below: 0.8,
    },
  },

  chains: [
    { event: 'fieldops.job_assigned', targets: ['customer'] },
    { event: 'fieldops.schedule_optimized', targets: ['insights'] },
  ],
};
```

### Prompt Used

The `field_ops` prompt template includes:
- System: "You are a field operations coordinator for a {trade_type} business."
- Input: unscheduled/scheduled jobs, tech availability and skills, customer locations and preferences, historical routing data, time-of-day constraints
- Instructions: optimize daily schedule for minimum drive time and maximum job completion, match tech skills to job requirements, handle conflicts, consider customer preferences (e.g., "Johnson is never home on Mondays")

---

## 7. Compliance Agent

**Category:** field-ops
**Purpose:** Tracks vehicle maintenance schedules, registration renewals, insurance expirations, OSHA compliance, tech certifications, required safety training, regional code tracking, permit applications, inspection prep. Everything with a deadline or regulatory requirement.

### Full Definition

```typescript
// src/agents/definitions/compliance.agent.ts

export const complianceAgent: AgentDefinition = {
  type: 'compliance',
  name: 'Compliance Agent',
  category: 'field-ops',

  triggers: [
    {
      type: 'event',
      event: 'compliance.deadline',
    },
    {
      type: 'chat',
      intent: 'check-compliance',
    },
    {
      type: 'chat',
      intent: 'upcoming-deadlines',
    },
    {
      type: 'chat',
      intent: 'certification-status',
    },
    {
      type: 'schedule',
      cron: '0 8 * * 1',
    },
  ],

  inputs: [
    { source: 'db', table: 'profiles', fields: ['*'] },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type'] },
    { source: 'context', key: 'compliance_deadlines' },
    { source: 'context', key: 'certifications' },
    { source: 'context', key: 'vehicle_data' },
    { source: 'integration', provider: 'fleetio' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'profiles', filter: { role: 'tech' } },
          { table: 'business_context', filter: { category: ['compliance', 'certification', 'vehicle'] } },
          { integration: 'fleetio', action: 'get_vehicle_status' },
        ],
      },
    },
    {
      id: 'assess_compliance',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'compliance',
        model_tier: 'capable',
        output_schema: {
          upcoming_deadlines: [{
            entity_type: 'string',
            entity_id: 'string',
            entity_name: 'string',
            deadline_type: 'string',
            deadline_date: 'string',
            days_remaining: 'number',
            urgency: 'string',
            action_required: 'string',
          }],
          expired_items: [{
            entity_type: 'string',
            entity_id: 'string',
            entity_name: 'string',
            item: 'string',
            expired_date: 'string',
            risk: 'string',
          }],
          vehicle_status: [{
            vehicle_id: 'string',
            next_maintenance: 'string',
            registration_expiry: 'string',
            insurance_expiry: 'string',
            mileage: 'number',
          }],
          summary: 'string',
        },
      },
      timeout: 30000,
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'send_alerts',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Compliance Report',
        body: '{summary}',
      },
    },
    {
      id: 'send_urgent_alerts',
      type: 'notify',
      config: {
        channel: 'push',
        condition: 'expired_items.length > 0 || upcoming_deadlines.some(d => d.days_remaining < 7)',
        title: 'URGENT: Compliance items need attention',
        body: '{expired_count} expired, {urgent_count} due within 7 days',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'notification' },
    { type: 'db_record', table: 'business_context' },
  ],

  autonomy: {
    auto: [
      'generate_compliance_report',
      'send_30_day_reminder',
      'update_compliance_data',
    ],
    review: [
      'send_14_day_warning',
      'flag_expired_certification',
    ],
    escalate: [
      'expired_insurance',
      'expired_license',
      'osha_violation_risk',
    ],
    thresholds: {
      confidence_below: 0.85,
    },
  },

  chains: [
    { event: 'compliance.alert_sent', targets: ['insights'] },
  ],
};
```

### Prompt Used

- System: "You are a compliance and regulatory tracking agent for a {trade_type} business in {state}."
- Input: tech profiles with certification data, vehicle data from Fleetio, organizational compliance records, state-specific regulatory requirements
- Instructions: identify all upcoming deadlines within 90 days, flag expired items, prioritize by urgency, recommend specific actions, track OSHA compliance, calculate mileage for tax purposes

---

## 8. Inventory Agent

**Category:** field-ops
**Purpose:** Tracks parts from job data, updates stock, triggers reorder alerts, coordinates with suppliers, reconciles usage against orders. Compares pricing across suppliers, tracks lead times, manages vendor relationships, handles returns/credits.

### Full Definition

```typescript
// src/agents/definitions/inventory.agent.ts

export const inventoryAgent: AgentDefinition = {
  type: 'inventory',
  name: 'Inventory Agent',
  category: 'field-ops',

  triggers: [
    {
      type: 'event',
      event: 'job.completed',
    },
    {
      type: 'event',
      event: 'inventory.low_stock',
    },
    {
      type: 'event',
      event: 'inventory.used',
    },
    {
      type: 'chat',
      intent: 'check-inventory',
    },
    {
      type: 'chat',
      intent: 'order-parts',
    },
    {
      type: 'chat',
      intent: 'inventory-report',
    },
    {
      type: 'schedule',
      cron: '0 7 * * *',
    },
  ],

  inputs: [
    { source: 'db', table: 'parts', fields: ['*'] },
    { source: 'db', table: 'jobs', fields: ['materials'], relation: 'trigger.job_id' },
    { source: 'db', table: 'organizations', fields: ['settings'] },
    { source: 'context', key: 'supplier_data' },
    { source: 'context', key: 'usage_patterns' },
    { source: 'integration', provider: 'fishbowl' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'parts', fields: ['*'] },
          { table: 'jobs', filter: { status: 'completed', created_at_gte: '30_days_ago' }, fields: ['materials'] },
          { table: 'business_context', filter: { category: 'supplier' } },
          { integration: 'fishbowl', action: 'get_inventory_levels' },
        ],
      },
    },
    {
      id: 'analyze_inventory',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'inventory',
        model_tier: 'capable',
        output_schema: {
          stock_deductions: [{
            part_id: 'string',
            quantity_used: 'number',
            job_id: 'string',
          }],
          low_stock_alerts: [{
            part_id: 'string',
            part_name: 'string',
            current_quantity: 'number',
            reorder_point: 'number',
            recommended_order_quantity: 'number',
            preferred_supplier: 'string',
            estimated_cost: 'number',
            lead_time_days: 'number',
          }],
          price_comparisons: [{
            part_name: 'string',
            suppliers: [{
              name: 'string',
              price: 'number',
              lead_time: 'number',
            }],
            recommendation: 'string',
          }],
          usage_forecast: {
            next_30_days: [{
              part_name: 'string',
              predicted_usage: 'number',
            }],
          },
          reconciliation: {
            discrepancies: [{
              part_name: 'string',
              expected: 'number',
              actual: 'number',
              difference: 'number',
            }],
          },
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'stock_deductions.every(d => d.quantity_used >= 0)',
          'low_stock_alerts.every(a => a.recommended_order_quantity > 0)',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'update_stock',
      type: 'integrate',
      config: {
        action: 'update_batch',
        target: 'parts',
        sync_to: ['fishbowl'],
      },
    },
    {
      id: 'notify',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Inventory update',
        body: '{deduction_count} parts deducted. {alert_count} items at low stock.',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'db_record', table: 'parts' },
    { type: 'external_sync', provider: 'fishbowl' },
    { type: 'notification' },
  ],

  autonomy: {
    auto: [
      'deduct_parts_from_job',
      'update_stock_levels',
      'send_low_stock_alert',
    ],
    review: [
      'place_reorder where estimated_cost > 500',
      'supplier_switch_recommendation',
      'reconciliation_adjustment',
    ],
    escalate: [
      'stock_discrepancy where difference > 20_pct',
      'critical_stock_out',
      'place_reorder where estimated_cost > 5000',
    ],
    thresholds: {
      amount_over: 500,
      confidence_below: 0.85,
      escalate_amount_over: 5000,
    },
  },

  chains: [
    { event: 'inventory.updated', targets: ['insights'] },
    { event: 'inventory.reorder_needed', targets: ['customer'] },
  ],
};
```

### Prompt Used

- System: "You are an inventory management agent for a {trade_type} business."
- Input: current stock levels, job materials used, supplier pricing data, usage history over 30/60/90 days, lead times
- Instructions: deduct parts used on completed jobs, identify items at or below reorder point, recommend order quantities based on usage patterns, compare supplier pricing, forecast upcoming needs, flag discrepancies between expected and actual stock

---

## 9. Customer Agent

**Category:** customer-sales
**Purpose:** The entire customer-facing operation. Handles communication (confirmations, ETAs, completion summaries, follow-up scheduling), reputation management (review requests on Google/Yelp/Facebook, monitors reviews, drafts responses), service plans (warranties, maintenance agreements, renewals, warranty claims), and sales (lead scoring, pipeline management, inbound lead response, re-engagement of lost estimates and dormant customers).

### Full Definition

```typescript
// src/agents/definitions/customer.agent.ts

export const customerAgent: AgentDefinition = {
  type: 'customer',
  name: 'Customer Agent',
  category: 'customer-sales',

  triggers: [
    // Communication triggers
    {
      type: 'event',
      event: 'job.scheduled',
    },
    {
      type: 'event',
      event: 'job.completed',
    },
    {
      type: 'event',
      event: 'invoice.sent',
    },
    {
      type: 'event',
      event: 'invoice.paid',
    },
    {
      type: 'event',
      event: 'estimate.generated',
    },
    // Lead management triggers
    {
      type: 'event',
      event: 'customer.lead.inbound',
    },
    {
      type: 'event',
      event: 'customer.created',
    },
    // Review triggers
    {
      type: 'event',
      event: 'collections.followup_sent',
    },
    // Chat intents
    {
      type: 'chat',
      intent: 'customer-info',
    },
    {
      type: 'chat',
      intent: 'send-review-request',
    },
    {
      type: 'chat',
      intent: 'send-message-to-customer',
    },
    {
      type: 'chat',
      intent: 'check-leads',
    },
    {
      type: 'chat',
      intent: 'customer-follow-up',
    },
    // Scheduled triggers
    {
      type: 'schedule',
      cron: '0 10 * * *',
    },
    {
      type: 'schedule',
      cron: '0 9 * * 1',
    },
  ],

  inputs: [
    { source: 'db', table: 'customers', fields: ['*'], relation: 'trigger.customer_id' },
    { source: 'db', table: 'jobs', fields: ['*'], relation: 'customer.id' },
    { source: 'db', table: 'invoices', fields: ['*'], relation: 'customer.id' },
    { source: 'db', table: 'estimates', fields: ['*'], relation: 'customer.id' },
    { source: 'db', table: 'organizations', fields: ['settings', 'trade_type', 'name'] },
    { source: 'context', key: 'customer_preferences' },
    { source: 'context', key: 'communication_templates' },
    { source: 'context', key: 'review_platforms' },
    { source: 'context', key: 'service_plans' },
  ],

  steps: [
    {
      id: 'gather_data',
      type: 'lookup',
      config: {
        queries: [
          { table: 'customers', relation: 'trigger.customer_id', fields: ['*'] },
          { table: 'jobs', filter: { customer_id: 'trigger.customer_id' }, limit: 10, order: 'created_at DESC' },
          { table: 'invoices', filter: { customer_id: 'trigger.customer_id' }, limit: 5 },
          { table: 'estimates', filter: { customer_id: 'trigger.customer_id', status: ['sent', 'rejected'] }, limit: 5 },
          { table: 'business_context', filter: { category: ['customer', 'preference'] } },
          { table: 'conversations', filter: { related_customer_id: 'trigger.customer_id' }, limit: 3 },
        ],
      },
    },
    {
      id: 'determine_action',
      type: 'ai_reason',
      config: {
        endpoint: '/ai/reason',
        prompt_template: 'customer',
        model_tier: 'capable',
        output_schema: {
          action_type: 'string',
          messages: [{
            recipient: 'string',
            channel: 'string',
            subject: 'string',
            body: 'string',
            scheduled_send: 'string|null',
          }],
          lead_score: {
            score: 'number|null',
            factors: 'string[]',
          },
          review_request: {
            platform: 'string|null',
            message: 'string|null',
            delay_hours: 'number|null',
          },
          service_plan_actions: [{
            type: 'string',
            customer_id: 'string',
            plan_type: 'string',
            action: 'string',
          }],
          re_engagement: [{
            customer_id: 'string',
            reason: 'string',
            message: 'string',
            channel: 'string',
          }],
          follow_up_scheduled: {
            date: 'string|null',
            reason: 'string|null',
          },
        },
      },
      timeout: 30000,
    },
    {
      id: 'validate',
      type: 'validate',
      config: {
        rules: [
          'action_type !== ""',
          'messages.every(m => m.channel && m.body)',
        ],
      },
    },
    {
      id: 'check_autonomy',
      type: 'autonomy_check',
      config: {},
    },
    {
      id: 'send_communications',
      type: 'integrate',
      config: {
        action: 'send_messages',
        channels: ['email', 'sms'],
        providers: ['twilio', 'google'],
      },
    },
    {
      id: 'update_customer_data',
      type: 'integrate',
      config: {
        action: 'update',
        target: 'customers',
      },
    },
    {
      id: 'notify',
      type: 'notify',
      config: {
        channel: 'in_app',
        title: 'Customer Agent: {action_type}',
        body: '{message_count} messages sent to {customer_name}',
      },
      optional: true,
    },
  ],

  outputs: [
    { type: 'email' },
    { type: 'sms' },
    { type: 'notification' },
    { type: 'db_record', table: 'customers' },
  ],

  autonomy: {
    auto: [
      'send_appointment_confirmation',
      'send_eta_notification',
      'send_job_completion_summary',
      'send_payment_thank_you',
      'score_lead',
      'update_customer_tags',
    ],
    review: [
      'send_review_request',
      'send_estimate_follow_up',
      'respond_to_inbound_lead',
      'send_re_engagement_message',
      'draft_review_response',
      'send_service_plan_renewal',
    ],
    escalate: [
      'customer_complaint',
      'negative_review_response',
      'warranty_claim',
      'service_plan_cancellation',
    ],
    thresholds: {
      confidence_below: 0.85,
    },
  },

  chains: [
    { event: 'customer.message_sent', targets: ['insights'] },
    { event: 'customer.lead_scored', targets: ['insights'] },
    { event: 'customer.review_requested', targets: ['insights'] },
  ],
};
```

### Prompt Used

The `customer` prompt template is multi-modal depending on the trigger:
- **Job confirmation**: "Generate a friendly confirmation message for {customer_name} about their upcoming {job_type} appointment on {date}."
- **Review request**: "Generate a polite review request for {customer_name} who just had a {job_type} completed. Include links to {platforms}. Delay sending by {delay_hours} hours."
- **Lead response**: "Score this inbound lead and generate a response. Lead info: {lead_data}. Business context: {org_name} does {trade_type} in {location}."
- **Re-engagement**: "Identify dormant customers who haven't had service in 6+ months and generate personalized re-engagement messages."
- **Review response**: "Draft a response to this {rating}-star review: {review_text}. Maintain a professional, appreciative tone."

### Data Reads

| Source | What It Reads |
|---|---|
| `customers` | Full customer profile, tags, payment_score, lifetime_value |
| `jobs` | Customer's job history |
| `invoices` | Customer's invoice/payment history |
| `estimates` | Sent/rejected estimates (for follow-up) |
| Business Context | Communication preferences, review platforms, service plan templates |
| Google/Yelp (via integration) | Existing reviews for response drafting |

### Data Writes

| Target | What It Writes |
|---|---|
| Email (via Resend/Google) | Confirmations, review requests, follow-ups |
| SMS (via Twilio) | Appointment reminders, ETAs, completion messages |
| `customers` table | Updated tags, lead_score, notes |
| `notifications` | In-app notifications about customer actions |

---

## Default Autonomy Rules Summary

| Agent | Auto (no review) | Review (human approves) | Escalate (human required) |
|---|---|---|---|
| **Invoice** | <$500, >90% confidence, PDF gen, QBO sync | >= $500, <90% confidence, send to customer | <60% confidence, >$10,000 |
| **Estimate** | <$1,000, >85% confidence, PDF gen | >= $1,000, <85% confidence, proposals, change orders, send | <60% confidence, >$25,000 |
| **Collections** | First reminder (<7 days), status updates, reports | Follow-ups >7 days, final notices, lien flags <30 days | Legal notices, lien flags <14 days, disputes |
| **Bookkeeping** | Expense categorization >90% confidence, revenue tracking, hours calc | <90% confidence, anomaly flags, payroll data | High-severity anomalies, hours discrepancy >4 |
| **Insights** | Weekly/monthly reports, context updates | Pricing recommendations, staffing recommendations | >20% revenue drop, margin anomalies |
| **Field Ops** | Single-match tech assignment, schedule notifications, daily summary | Reassignment, rescheduling, conflict resolution | No tech available, customer conflict, emergency |
| **Compliance** | Compliance reports, 30-day reminders, data updates | 14-day warnings, expired certification flags | Expired insurance/license, OSHA risk |
| **Inventory** | Stock deductions, level updates, low-stock alerts | Reorders >$500, supplier switch, reconciliation | Discrepancy >20%, stock-out, reorders >$5,000 |
| **Customer** | Confirmations, ETAs, completion summaries, payment thanks, lead scoring | Review requests, lead responses, re-engagement, review responses, renewals | Complaints, negative reviews, warranty claims, cancellations |

**Key principle:** All agents start with conservative autonomy. The system tracks approval rates and suggests upgrading to auto when accuracy proves out (see [06-agent-runtime.md, Section 7](./06-agent-runtime.md#7-human-in-the-loop-review-queue)).

---

## Cross-References

- **Agent runtime engine (execution pipeline, event bus, registry):** See [06-agent-runtime.md](./06-agent-runtime.md)
- **Copilot (how chat triggers route to agents):** See [08-copilot.md](./08-copilot.md)
- **Integration layer (how agents sync to external systems):** See [09-integrations.md](./09-integrations.md)
- **AI service (prompt templates, model routing):** See [10-ai-service.md](./10-ai-service.md)
- **Database schema (all tables referenced by agents):** See [02-database-schema.md](./02-database-schema.md)
- **Queue system (BullMQ workers that process agent jobs):** See [14-queue-system.md](./14-queue-system.md)
