/* ------------------------------------------------------------------ */
/*  Integration Types                                                   */
/* ------------------------------------------------------------------ */

export type AuthType = 'api_key' | 'oauth2' | 'basic_auth' | 'bearer_token' | 'jwt';

export type IntegrationCategory =
  | 'payments'
  | 'communication'
  | 'scheduling'
  | 'fleet'
  | 'accounting'
  | 'government'
  | 'fsm'
  | 'crm'
  | 'estimating'
  | 'measurement'
  | 'project_management'
  | 'inventory'
  | 'insurance'
  | 'surety'
  | 'training'
  | 'reputation'
  | 'proposals'
  | 'compliance'
  | 'specialty';

export type IntegrationTier = 1 | 2 | 3 | 4 | 5 | 6;

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'pending';

export interface IntegrationEntry {
  /** URL-safe slug used as the unique identifier */
  slug: string;
  /** Display name */
  name: string;
  /** Short description of the integration */
  description: string;
  /** Functional category */
  category: IntegrationCategory;
  /** Lucide icon name or path to custom icon */
  icon: string;
  /** Product website URL */
  website: string;
  /** Authentication method */
  authType: AuthType;
  /** Difficulty / access tier (1=free instant, 6=special/legacy) */
  tier: IntegrationTier;
  /** Link to API documentation */
  docsUrl: string;
  /** Base URL for API requests */
  apiBaseUrl: string;
  /** Whether the integration supports inbound webhooks */
  webhookSupport: boolean;
  /** Trade verticals this integration serves */
  trades: string[];
  /** Human-readable rate limit description */
  rateLimits: string;
  /** Additional notes (e.g. "GraphQL", "SOAP", "Partner program paused") */
  notes?: string;
}

export interface IntegrationConnection {
  integrationSlug: string;
  orgId: string;
  status: ConnectionStatus;
  connectedAt?: string;
  lastSyncAt?: string;
  config?: Record<string, unknown>;
}
