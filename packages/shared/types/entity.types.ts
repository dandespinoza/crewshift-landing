// ─────────────────────────────────────────────────────────────────────────────
// @crewshift/shared - Unified Data-Model Types
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared value objects ────────────────────────────────────────────────────

/** Physical / mailing address. */
export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** A single billable line item on a job, invoice, or estimate. */
export interface LineItem {
  /** Human-readable description of the line item. */
  description: string;
  /** Quantity of items or units. */
  quantity: number;
  /** Price per unit in dollars. */
  unit_price: number;
  /** Computed total (quantity * unit_price). */
  total: number;
}

/** A material / part consumed on a job. */
export interface Material {
  /** Name of the part or material. */
  part_name: string;
  /** Quantity used. */
  quantity: number;
  /** Cost per unit in dollars. */
  unit_cost: number;
}

// ── Core entities ───────────────────────────────────────────────────────────

/**
 * Organization (tenant).
 * Every other entity in the system belongs to exactly one organization.
 */
export interface Organization {
  /** UUID primary key. */
  id: string;
  /** Display name of the organization. */
  name: string;
  /** The trade / vertical the org operates in (e.g. "plumbing", "hvac"). */
  trade_type: string;
  /** Approximate company size bucket. */
  size: string;
  /** Subscription / pricing tier. */
  tier: string;
  /** Org-level feature flags and preferences. */
  settings: Record<string, unknown>;
  /** Current onboarding wizard status. */
  onboarding_status: string;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-updated timestamp. */
  updated_at: string;
}

/**
 * A user profile belonging to an organization.
 * Linked 1-to-1 with a Supabase Auth user.
 */
export interface Profile {
  /** UUID primary key (matches Supabase auth.users.id). */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** Full display name. */
  full_name: string;
  /** Role within the organization. */
  role: 'owner' | 'admin' | 'member' | 'tech';
  /** Phone number (E.164 preferred). */
  phone: string;
  /** URL to the user's avatar image. */
  avatar_url: string;
}

/**
 * Customer / client record.
 * Customers belong to an org and may be synced from external systems.
 */
export interface Customer {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** Map of provider -> external id for synced records. */
  external_ids: Record<string, string>;
  /** Customer display name (person or company). */
  name: string;
  /** Primary email address. */
  email: string;
  /** Primary phone number. */
  phone: string;
  /** Service / billing address. */
  address: Address;
  /** Freeform tags for segmentation. */
  tags: string[];
  /** Internal notes about this customer. */
  notes: string;
  /** AI-derived payment reliability score (0-100). */
  payment_score: number;
  /** Total revenue from this customer in dollars. */
  lifetime_value: number;
  /** Arbitrary extra data. */
  metadata: Record<string, unknown>;
}

/** Possible statuses for a {@link Job}. */
export type JobStatus =
  | 'pending'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/**
 * Job / work-order.
 * Represents a single unit of work performed for a customer.
 */
export interface Job {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** UUID of the associated customer. */
  customer_id: string;
  /** Map of provider -> external id for synced records. */
  external_ids: Record<string, string>;
  /** Current job lifecycle status. */
  status: JobStatus;
  /** Job type / category (e.g. "repair", "installation"). */
  type: string;
  /** Detailed description of the work to be performed. */
  description: string;
  /** ISO 8601 scheduled start time. */
  scheduled_start: string;
  /** ISO 8601 scheduled end time. */
  scheduled_end: string;
  /** ISO 8601 actual start time (set when work begins). */
  actual_start: string;
  /** ISO 8601 actual end time (set when work completes). */
  actual_end: string;
  /** UUID of the technician assigned to this job. */
  assigned_tech_id: string;
  /** Job-site address. */
  address: Address;
  /** Billable line items. */
  line_items: LineItem[];
  /** Materials consumed during the job. */
  materials: Material[];
  /** Total labor hours logged. */
  labor_hours: number;
  /** Total invoiced amount in dollars. */
  total_amount: number;
  /** Profit margin as a decimal (e.g. 0.35 = 35%). */
  margin: number;
  /** Internal notes. */
  notes: string;
  /** URLs to job-site photos. */
  photos: string[];
  /** Arbitrary extra data. */
  metadata: Record<string, unknown>;
}

/** Possible statuses for an {@link Invoice}. */
export type InvoiceStatus =
  | 'draft'
  | 'review'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void';

/**
 * Invoice generated for a completed (or in-progress) job.
 */
export interface Invoice {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** UUID of the related job. */
  job_id: string;
  /** UUID of the billed customer. */
  customer_id: string;
  /** Map of provider -> external id for synced records. */
  external_ids: Record<string, string>;
  /** Current invoice lifecycle status. */
  status: InvoiceStatus;
  /** Human-readable invoice number (e.g. "INV-0042"). */
  invoice_number: string;
  /** Billable line items. */
  line_items: LineItem[];
  /** Subtotal before tax in dollars. */
  subtotal: number;
  /** Tax rate as a decimal (e.g. 0.08 = 8%). */
  tax_rate: number;
  /** Computed tax amount in dollars. */
  tax_amount: number;
  /** Grand total in dollars. */
  total: number;
  /** ISO 8601 payment due date. */
  due_date: string;
  /** ISO 8601 timestamp when the invoice was sent to the customer. */
  sent_at: string;
  /** ISO 8601 timestamp when payment was received. */
  paid_at: string;
  /** Payment method used (e.g. "credit_card", "ach", "check"). */
  payment_method: string;
  /** Identifier of the agent or user that generated this invoice. */
  generated_by: string;
  /** URL to the rendered PDF. */
  pdf_url: string;
  /** Internal notes. */
  notes: string;
  /** Arbitrary extra data. */
  metadata: Record<string, unknown>;
}

/** Possible statuses for an {@link Estimate}. */
export type EstimateStatus =
  | 'draft'
  | 'review'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired';

/** The kind of estimate document. */
export type EstimateType = 'estimate' | 'proposal' | 'change_order';

/**
 * Estimate / proposal sent to a prospective or existing customer.
 */
export interface Estimate {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** UUID of the associated customer. */
  customer_id: string;
  /** Map of provider -> external id for synced records. */
  external_ids: Record<string, string>;
  /** Current estimate lifecycle status. */
  status: EstimateStatus;
  /** Human-readable estimate number (e.g. "EST-0017"). */
  estimate_number: string;
  /** The kind of document this represents. */
  type: EstimateType;
  /** Billable line items. */
  line_items: LineItem[];
  /** Subtotal before tax in dollars. */
  subtotal: number;
  /** Tax amount in dollars. */
  tax_amount: number;
  /** Grand total in dollars. */
  total: number;
  /** ISO 8601 date after which the estimate expires. */
  valid_until: string;
  /** Detailed scope of work description. */
  scope_description: string;
  /** URLs to supporting photos. */
  photos: string[];
  /** AI-derived confidence score (0-1). */
  confidence_score: number;
  /** Identifier of the agent or user that generated this estimate. */
  generated_by: string;
  /** URL to the rendered PDF. */
  pdf_url: string;
  /** Internal notes. */
  notes: string;
  /** Arbitrary extra data. */
  metadata: Record<string, unknown>;
}

/**
 * Inventory part / material tracked by the organization.
 */
export interface Part {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** Display name of the part. */
  name: string;
  /** Stock-keeping unit code. */
  sku: string;
  /** Part category (e.g. "pipe-fitting", "electrical"). */
  category: string;
  /** Current quantity in stock. */
  quantity_on_hand: number;
  /** Quantity at which a reorder alert fires. */
  reorder_point: number;
  /** Cost per unit in dollars. */
  unit_cost: number;
  /** Preferred supplier name or identifier. */
  preferred_supplier: string;
  /** Structured data from the supplier (pricing, lead time, etc.). */
  supplier_data: Record<string, unknown>;
  /** Arbitrary extra data. */
  metadata: Record<string, unknown>;
}

/** Possible statuses for an {@link Integration}. */
export type IntegrationStatus =
  | 'pending'
  | 'connected'
  | 'error'
  | 'disconnected';

/**
 * Third-party integration connection for an organization.
 * Tracks OAuth tokens and sync state for providers like
 * ServiceTitan, Housecall Pro, QuickBooks, etc.
 */
export interface Integration {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** Integration provider key (e.g. "servicetitan", "quickbooks"). */
  provider: string;
  /** Current connection status. */
  status: IntegrationStatus;
  /** ISO 8601 timestamp when the OAuth token expires. */
  token_expires_at: string;
  /** The account ID on the external provider's side. */
  external_account_id: string;
  /** Arbitrary extra data (scopes, refresh tokens, etc.). */
  metadata: Record<string, unknown>;
  /** ISO 8601 timestamp of the last successful data sync. */
  last_sync_at: string;
}

/**
 * In-app or push notification sent to a user.
 */
export interface Notification {
  /** UUID primary key. */
  id: string;
  /** UUID of the parent organization. */
  org_id: string;
  /** UUID of the recipient user. */
  user_id: string;
  /** Notification type key (e.g. "invoice_ready", "review_needed"). */
  type: string;
  /** Short title / headline. */
  title: string;
  /** Notification body text. */
  body: string;
  /** Delivery channel (e.g. "in_app", "push", "email", "sms"). */
  channel: string;
  /** Whether the user has read / dismissed this notification. */
  read: boolean;
  /** Deep-link URL the user can follow to take action. */
  action_url: string;
  /** Arbitrary extra data. */
  metadata: Record<string, unknown>;
}
