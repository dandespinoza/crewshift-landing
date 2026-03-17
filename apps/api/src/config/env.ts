import { z } from 'zod';

const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // ── Supabase ──────────────────────────────────────────────────────────
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  // ── Database ──────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),

  // ── Redis ─────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1),

  // ── AI Service ────────────────────────────────────────────────────────
  AI_SERVICE_URL: z.string().url(),

  // ── Encryption ────────────────────────────────────────────────────────
  ENCRYPTION_KEY: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // ── S3 / Object Storage ───────────────────────────────────────────────
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // ── Email ─────────────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),

  // ── QuickBooks ────────────────────────────────────────────────────────
  QUICKBOOKS_CLIENT_ID: z.string().optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional(),

  // ── Xero ────────────────────────────────────────────────────────────
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  XERO_WEBHOOK_KEY: z.string().optional(),

  // ── FreshBooks ──────────────────────────────────────────────────────
  FRESHBOOKS_CLIENT_ID: z.string().optional(),
  FRESHBOOKS_CLIENT_SECRET: z.string().optional(),

  // ── Wave ────────────────────────────────────────────────────────────
  WAVE_CLIENT_ID: z.string().optional(),
  WAVE_CLIENT_SECRET: z.string().optional(),

  // ── MYOB ────────────────────────────────────────────────────────────
  MYOB_CLIENT_ID: z.string().optional(),
  MYOB_CLIENT_SECRET: z.string().optional(),

  // ── Zoho Books ──────────────────────────────────────────────────────
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),

  // ── Stripe ────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ── PayPal ─────────────────────────────────────────────────────────────
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),

  // ── Braintree ──────────────────────────────────────────────────────────
  BRAINTREE_MERCHANT_ID: z.string().optional(),
  BRAINTREE_PUBLIC_KEY: z.string().optional(),
  BRAINTREE_PRIVATE_KEY: z.string().optional(),

  // ── Helcim ─────────────────────────────────────────────────────────────
  HELCIM_API_TOKEN: z.string().optional(),

  // ── Stax (Fattmerchant) ────────────────────────────────────────────────
  STAX_API_KEY: z.string().optional(),

  // ── Authorize.Net ──────────────────────────────────────────────────────
  AUTHORIZE_NET_LOGIN_ID: z.string().optional(),
  AUTHORIZE_NET_TRANSACTION_KEY: z.string().optional(),
  AUTHORIZE_NET_SIGNATURE_KEY: z.string().optional(),

  // ── GoCardless ─────────────────────────────────────────────────────────
  GOCARDLESS_CLIENT_ID: z.string().optional(),
  GOCARDLESS_CLIENT_SECRET: z.string().optional(),
  GOCARDLESS_WEBHOOK_SECRET: z.string().optional(),

  // ── Google OAuth ──────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ── Twilio ────────────────────────────────────────────────────────────
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ── SignalWire ───────────────────────────────────────────────────────
  SIGNALWIRE_PROJECT_ID: z.string().optional(),
  SIGNALWIRE_TOKEN: z.string().optional(),
  SIGNALWIRE_SPACE: z.string().optional(),

  // ── Vonage ─────────────────────────────────────────────────────────
  VONAGE_API_KEY: z.string().optional(),
  VONAGE_API_SECRET: z.string().optional(),
  VONAGE_APPLICATION_ID: z.string().optional(),
  VONAGE_PRIVATE_KEY: z.string().optional(),

  // ── SendGrid ───────────────────────────────────────────────────────
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_WEBHOOK_VERIFICATION_KEY: z.string().optional(),

  // ── Postmark ───────────────────────────────────────────────────────
  POSTMARK_SERVER_TOKEN: z.string().optional(),

  // ── Mailchimp ──────────────────────────────────────────────────────
  MAILCHIMP_CLIENT_ID: z.string().optional(),
  MAILCHIMP_CLIENT_SECRET: z.string().optional(),

  // ── Slack ──────────────────────────────────────────────────────────
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // ── Jobber ─────────────────────────────────────────────────────────
  JOBBER_CLIENT_ID: z.string().optional(),
  JOBBER_CLIENT_SECRET: z.string().optional(),

  // ── ServiceTitan ───────────────────────────────────────────────────
  SERVICETITAN_CLIENT_ID: z.string().optional(),
  SERVICETITAN_CLIENT_SECRET: z.string().optional(),
  SERVICETITAN_APP_KEY: z.string().optional(),

  // ── HousecallPro ──────────────────────────────────────────────────
  HOUSECALLPRO_CLIENT_ID: z.string().optional(),
  HOUSECALLPRO_CLIENT_SECRET: z.string().optional(),

  // ── Plaid ──────────────────────────────────────────────────────────
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(['sandbox', 'development', 'production']).optional(),

  // ── Fleetio ────────────────────────────────────────────────────────
  FLEETIO_API_KEY: z.string().optional(),
  FLEETIO_ACCOUNT_TOKEN: z.string().optional(),

  // ── Fishbowl ───────────────────────────────────────────────────────
  FISHBOWL_HOST: z.string().optional(),
  FISHBOWL_PORT: z.coerce.number().int().optional(),

  // ── Calendly ───────────────────────────────────────────────────────
  CALENDLY_CLIENT_ID: z.string().optional(),
  CALENDLY_CLIENT_SECRET: z.string().optional(),
  CALENDLY_WEBHOOK_SECRET: z.string().optional(),

  // ── Acuity Scheduling ─────────────────────────────────────────────
  ACUITY_USER_ID: z.string().optional(),
  ACUITY_API_KEY: z.string().optional(),

  // ── Route4Me ──────────────────────────────────────────────────────
  ROUTE4ME_API_KEY: z.string().optional(),

  // ── OptimoRoute ───────────────────────────────────────────────────
  OPTIMOROUTE_API_KEY: z.string().optional(),

  // ── Samsara ───────────────────────────────────────────────────────
  SAMSARA_CLIENT_ID: z.string().optional(),
  SAMSARA_CLIENT_SECRET: z.string().optional(),
  SAMSARA_WEBHOOK_SECRET: z.string().optional(),

  // ── GPS Trackit ───────────────────────────────────────────────────
  GPS_TRACKIT_API_KEY: z.string().optional(),

  // ── ServiceM8 ──────────────────────────────────────────────────
  SERVICEM8_CLIENT_ID: z.string().optional(),
  SERVICEM8_CLIENT_SECRET: z.string().optional(),

  // ── simPRO ─────────────────────────────────────────────────────
  SIMPRO_CLIENT_ID: z.string().optional(),
  SIMPRO_CLIENT_SECRET: z.string().optional(),

  // ── Zuper ──────────────────────────────────────────────────────
  ZUPER_API_KEY: z.string().optional(),

  // ── Fergus ─────────────────────────────────────────────────────
  FERGUS_API_KEY: z.string().optional(),

  // ── Procore ────────────────────────────────────────────────────
  PROCORE_CLIENT_ID: z.string().optional(),
  PROCORE_CLIENT_SECRET: z.string().optional(),

  // ── AccuLynx ───────────────────────────────────────────────────
  ACCULYNX_API_KEY: z.string().optional(),

  // ── JobNimbus ──────────────────────────────────────────────────
  JOBNIMBUS_API_KEY: z.string().optional(),

  // ── Podium ──────────────────────────────────────────────────────
  PODIUM_CLIENT_ID: z.string().optional(),
  PODIUM_CLIENT_SECRET: z.string().optional(),

  // ── NiceJob ─────────────────────────────────────────────────────
  NICEJOB_CLIENT_ID: z.string().optional(),
  NICEJOB_CLIENT_SECRET: z.string().optional(),

  // ── Hatch ───────────────────────────────────────────────────────
  HATCH_API_KEY: z.string().optional(),

  // ── FieldEdge ───────────────────────────────────────────────────
  FIELDEDGE_API_KEY: z.string().optional(),
  FIELDEDGE_SUBSCRIPTION_KEY: z.string().optional(),

  // ── Verizon Connect ─────────────────────────────────────────────
  VERIZON_CONNECT_USERNAME: z.string().optional(),
  VERIZON_CONNECT_PASSWORD: z.string().optional(),

  // ── Leap ────────────────────────────────────────────────────────
  LEAP_API_TOKEN: z.string().optional(),

  // ── Ferguson ────────────────────────────────────────────────────
  FERGUSON_API_KEY: z.string().optional(),

  // ── Bluebeam ────────────────────────────────────────────────────
  BLUEBEAM_CLIENT_ID: z.string().optional(),
  BLUEBEAM_CLIENT_SECRET: z.string().optional(),

  // ── Accela ──────────────────────────────────────────────────────
  ACCELA_CLIENT_ID: z.string().optional(),
  ACCELA_CLIENT_SECRET: z.string().optional(),
  ACCELA_AGENCY: z.string().optional(),

  // ── OSHA ──────────────────────────────────────────────────────────
  OSHA_API_TOKEN: z.string().optional(),

  // ── SafetyCulture ───────────────────────────────────────────────
  SAFETYCULTURE_API_TOKEN: z.string().optional(),

  // ── SurveyMonkey ────────────────────────────────────────────────
  SURVEYMONKEY_CLIENT_ID: z.string().optional(),
  SURVEYMONKEY_CLIENT_SECRET: z.string().optional(),

  // ── Typeform ────────────────────────────────────────────────────
  TYPEFORM_CLIENT_ID: z.string().optional(),
  TYPEFORM_CLIENT_SECRET: z.string().optional(),

  // ── Trello ──────────────────────────────────────────────────────
  TRELLO_API_KEY: z.string().optional(),
  TRELLO_API_SECRET: z.string().optional(),

  // ── Service Fusion ────────────────────────────────────────────────
  SERVICE_FUSION_API_KEY: z.string().optional(),

  // ── Workiz ────────────────────────────────────────────────────────
  WORKIZ_API_TOKEN: z.string().optional(),

  // ── Kickserv ──────────────────────────────────────────────────────
  KICKSERV_ACCOUNT: z.string().optional(),
  KICKSERV_API_TOKEN: z.string().optional(),

  // ── FieldPulse ────────────────────────────────────────────────────
  FIELDPULSE_API_KEY: z.string().optional(),

  // ── inFlow Inventory ──────────────────────────────────────────────
  INFLOW_API_KEY: z.string().optional(),

  // ── Sortly ────────────────────────────────────────────────────────
  SORTLY_CLIENT_ID: z.string().optional(),
  SORTLY_CLIENT_SECRET: z.string().optional(),

  // ── Proposify ─────────────────────────────────────────────────────
  PROPOSIFY_CLIENT_ID: z.string().optional(),
  PROPOSIFY_CLIENT_SECRET: z.string().optional(),

  // ── Sage Intacct ──────────────────────────────────────────────────
  SAGE_INTACCT_SENDER_ID: z.string().optional(),
  SAGE_INTACCT_SENDER_PASSWORD: z.string().optional(),
  SAGE_INTACCT_COMPANY_ID: z.string().optional(),
  SAGE_INTACCT_USER_ID: z.string().optional(),
  SAGE_INTACCT_USER_PASSWORD: z.string().optional(),

  // ── Salesforce ────────────────────────────────────────────────────
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),

  // ── Dynamics 365 ──────────────────────────────────────────────────
  DYNAMICS_CLIENT_ID: z.string().optional(),
  DYNAMICS_CLIENT_SECRET: z.string().optional(),
  DYNAMICS_TENANT_ID: z.string().optional(),

  // ── Square ──────────────────────────────────────────────────────────
  SQUARE_CLIENT_ID: z.string().optional(),
  SQUARE_CLIENT_SECRET: z.string().optional(),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),

  // ── Clover ─────────────────────────────────────────────────────────
  CLOVER_CLIENT_ID: z.string().optional(),
  CLOVER_CLIENT_SECRET: z.string().optional(),

  // ── RingCentral ────────────────────────────────────────────────────
  RINGCENTRAL_CLIENT_ID: z.string().optional(),
  RINGCENTRAL_CLIENT_SECRET: z.string().optional(),

  // ── Microsoft Teams ────────────────────────────────────────────────
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // ── Constant Contact ──────────────────────────────────────────────
  CONSTANT_CONTACT_CLIENT_ID: z.string().optional(),
  CONSTANT_CONTACT_CLIENT_SECRET: z.string().optional(),

  // ── PandaDoc ──────────────────────────────────────────────────────
  PANDADOC_CLIENT_ID: z.string().optional(),
  PANDADOC_CLIENT_SECRET: z.string().optional(),

  // ── DocuSign ──────────────────────────────────────────────────────
  DOCUSIGN_CLIENT_ID: z.string().optional(),
  DOCUSIGN_CLIENT_SECRET: z.string().optional(),

  // ── CompanyCam ────────────────────────────────────────────────────
  COMPANYCAM_CLIENT_ID: z.string().optional(),
  COMPANYCAM_CLIENT_SECRET: z.string().optional(),

  // ── HOVER ─────────────────────────────────────────────────────────
  HOVER_CLIENT_ID: z.string().optional(),
  HOVER_CLIENT_SECRET: z.string().optional(),

  // ── EagleView ─────────────────────────────────────────────────────
  EAGLEVIEW_CLIENT_ID: z.string().optional(),
  EAGLEVIEW_CLIENT_SECRET: z.string().optional(),

  // ── Birdeye ───────────────────────────────────────────────────────
  BIRDEYE_API_KEY: z.string().optional(),
  BIRDEYE_BUSINESS_ID: z.string().optional(),

  // ── STACK CT ──────────────────────────────────────────────────────
  STACK_CLIENT_ID: z.string().optional(),
  STACK_CLIENT_SECRET: z.string().optional(),

  // ── Notion ────────────────────────────────────────────────────────
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),

  // ── monday.com ────────────────────────────────────────────────────
  MONDAY_CLIENT_ID: z.string().optional(),
  MONDAY_CLIENT_SECRET: z.string().optional(),

  // ── Asana ─────────────────────────────────────────────────────────
  ASANA_CLIENT_ID: z.string().optional(),
  ASANA_CLIENT_SECRET: z.string().optional(),

  // ── OpenGov ───────────────────────────────────────────────────────
  OPENGOV_CLIENT_ID: z.string().optional(),
  OPENGOV_CLIENT_SECRET: z.string().optional(),

  // ── WePay ────────────────────────────────────────────────────────────
  WEPAY_CLIENT_ID: z.string().optional(),
  WEPAY_CLIENT_SECRET: z.string().optional(),
  WEPAY_ACCOUNT_ID: z.string().optional(),

  // ── Melio ───────────────────────────────────────────────────────────
  MELIO_CLIENT_ID: z.string().optional(),
  MELIO_CLIENT_SECRET: z.string().optional(),

  // ── Fundbox ─────────────────────────────────────────────────────────
  FUNDBOX_CLIENT_ID: z.string().optional(),
  FUNDBOX_CLIENT_SECRET: z.string().optional(),

  // ── Bench ───────────────────────────────────────────────────────────
  BENCH_API_KEY: z.string().optional(),

  // ── Worldpay ────────────────────────────────────────────────────────
  WORLDPAY_MERCHANT_CODE: z.string().optional(),
  WORLDPAY_XML_PASSWORD: z.string().optional(),

  // ── Dispatch ────────────────────────────────────────────────────────
  DISPATCH_CLIENT_ID: z.string().optional(),
  DISPATCH_CLIENT_SECRET: z.string().optional(),

  // ── Next Insurance ──────────────────────────────────────────────────
  NEXT_INSURANCE_API_KEY: z.string().optional(),

  // ── Thimble ─────────────────────────────────────────────────────────
  THIMBLE_API_KEY: z.string().optional(),

  // ── Simply Business ─────────────────────────────────────────────────
  SIMPLY_BUSINESS_CLIENT_ID: z.string().optional(),
  SIMPLY_BUSINESS_CLIENT_SECRET: z.string().optional(),

  // ── BuildOps ────────────────────────────────────────────────────────
  BUILDOPS_CLIENT_ID: z.string().optional(),
  BUILDOPS_CLIENT_SECRET: z.string().optional(),

  // ── Tyler EnerGov ───────────────────────────────────────────────────
  TYLER_CLIENT_ID: z.string().optional(),
  TYLER_CLIENT_SECRET: z.string().optional(),

  // ── QuickBooks Desktop ──────────────────────────────────────────────
  QUICKBOOKS_DESKTOP_CONDUCTOR_KEY: z.string().optional(),

  // ── SAP FSM ─────────────────────────────────────────────────────────
  SAP_FSM_CLIENT_ID: z.string().optional(),
  SAP_FSM_CLIENT_SECRET: z.string().optional(),
  SAP_FSM_CLUSTER: z.string().optional(),
  SAP_FSM_ACCOUNT_ID: z.string().optional(),
  SAP_FSM_COMPANY_ID: z.string().optional(),

  // ── RSMeans ─────────────────────────────────────────────────────────
  RSMEANS_API_KEY: z.string().optional(),

  // ── Clear Estimates ─────────────────────────────────────────────────
  CLEAR_ESTIMATES_API_KEY: z.string().optional(),

  // ── GorillaDesk ─────────────────────────────────────────────────────
  GORILLADESK_EMAIL: z.string().optional(),
  GORILLADESK_PASSWORD: z.string().optional(),

  // ── ZipBooks ────────────────────────────────────────────────────────
  ZIPBOOKS_API_TOKEN: z.string().optional(),

  // ── SOS Inventory ───────────────────────────────────────────────────
  SOS_INVENTORY_API_KEY: z.string().optional(),

  // ── Liberty Mutual Surety ───────────────────────────────────────────
  LIBERTY_MUTUAL_API_KEY: z.string().optional(),

  // ── Merchants Bonding ───────────────────────────────────────────────
  MERCHANTS_BONDING_API_KEY: z.string().optional(),

  // ── Interplay Learning ──────────────────────────────────────────────
  INTERPLAY_API_KEY: z.string().optional(),

  // ── Loc8 ────────────────────────────────────────────────────────────
  LOC8_API_KEY: z.string().optional(),

  // ── Frontend URLs ──────────────────────────────────────────────────
  FRONTEND_URL: z.string().url().optional(),
  ADMIN_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌  Invalid environment variables:', formatted);
    throw new Error('Invalid environment variables — see console output above');
  }

  return result.data;
}

export const env: Env = validateEnv();
