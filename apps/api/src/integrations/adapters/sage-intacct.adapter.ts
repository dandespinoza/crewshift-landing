/**
 * Sage Intacct Integration Adapter
 *
 * Native (Tier 1) adapter for Sage Intacct ERP/accounting.
 * Handles session-based XML auth, customer/invoice sync, and invoice creation.
 *
 * Sage Intacct API Reference:
 * - API: https://developer.intacct.com/web-services/
 *
 * Key details:
 * - XML-based API (not REST) — all requests are XML POST to a single endpoint
 * - Session-based auth via getAPISession function (returns sessionid)
 * - Uses readByQuery for paginated reads on object types (CUSTOMER, ARINVOICE, etc.)
 * - No webhook support
 * - Requires Sage Intacct subscription + developer license
 */

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

const API_ENDPOINT = 'https://api.intacct.com/ia/xml/xmlgw.phtml';
const DEFAULT_PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSenderId(): string {
  const id = process.env.SAGE_INTACCT_SENDER_ID ?? env.SAGE_INTACCT_SENDER_ID;
  if (!id) throw new Error('SAGE_INTACCT_SENDER_ID is not configured');
  return id;
}

function getSenderPassword(): string {
  const pw = process.env.SAGE_INTACCT_SENDER_PASSWORD ?? env.SAGE_INTACCT_SENDER_PASSWORD;
  if (!pw) throw new Error('SAGE_INTACCT_SENDER_PASSWORD is not configured');
  return pw;
}

function getCompanyId(): string {
  const id = process.env.SAGE_INTACCT_COMPANY_ID ?? env.SAGE_INTACCT_COMPANY_ID;
  if (!id) throw new Error('SAGE_INTACCT_COMPANY_ID is not configured');
  return id;
}

function getUserId(): string {
  const id = process.env.SAGE_INTACCT_USER_ID ?? env.SAGE_INTACCT_USER_ID;
  if (!id) throw new Error('SAGE_INTACCT_USER_ID is not configured');
  return id;
}

function getUserPassword(): string {
  const pw = process.env.SAGE_INTACCT_USER_PASSWORD ?? env.SAGE_INTACCT_USER_PASSWORD;
  if (!pw) throw new Error('SAGE_INTACCT_USER_PASSWORD is not configured');
  return pw;
}

/**
 * Build the XML request envelope for Sage Intacct.
 */
function buildXmlRequest(sessionId: string, content: string, controlId?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>${getSenderId()}</senderid>
    <password>${getSenderPassword()}</password>
    <controlid>${controlId ?? `req-${Date.now()}`}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>
      <sessionid>${sessionId}</sessionid>
    </authentication>
    <content>
      <function controlid="func-${Date.now()}">
        ${content}
      </function>
    </content>
  </operation>
</request>`;
}

/**
 * Build the XML request for session login.
 */
function buildLoginRequest(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>${getSenderId()}</senderid>
    <password>${getSenderPassword()}</password>
    <controlid>login-${Date.now()}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>
      <login>
        <userid>${getUserId()}</userid>
        <companyid>${getCompanyId()}</companyid>
        <password>${getUserPassword()}</password>
      </login>
    </authentication>
    <content>
      <function controlid="getSession">
        <getAPISession />
      </function>
    </content>
  </operation>
</request>`;
}

/**
 * Send an XML request to the Sage Intacct API.
 */
async function intacctRequest(xmlBody: string): Promise<string> {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
    },
    body: xmlBody,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, errorBody },
      'Sage Intacct API error',
    );
    throw new Error(`Sage Intacct API error: ${response.status} — ${errorBody}`);
  }

  return response.text();
}

/**
 * Simple XML tag value extractor. Extracts the text content of the first
 * occurrence of a given tag from an XML string.
 */
function extractXmlValue(xml: string, tag: string): string | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const startIdx = xml.indexOf(openTag);
  if (startIdx === -1) return null;
  const valueStart = startIdx + openTag.length;
  const endIdx = xml.indexOf(closeTag, valueStart);
  if (endIdx === -1) return null;
  return xml.slice(valueStart, endIdx).trim();
}

/**
 * Extract all occurrences of a repeating XML element.
 */
function extractXmlElements(xml: string, tag: string): string[] {
  const results: string[] = [];
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let searchFrom = 0;

  while (true) {
    const startIdx = xml.indexOf(openTag, searchFrom);
    if (startIdx === -1) break;
    const endIdx = xml.indexOf(closeTag, startIdx);
    if (endIdx === -1) break;
    results.push(xml.slice(startIdx + openTag.length, endIdx));
    searchFrom = endIdx + closeTag.length;
  }

  return results;
}

/**
 * Parse a simple XML element into a record of tag -> value pairs.
 * Handles only flat (non-nested) XML elements.
 */
function parseXmlToRecord(xmlElement: string): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const tagRegex = /<([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xmlElement)) !== null) {
    const [, tagName, value] = match;
    if (tagName) {
      record[tagName] = value?.trim() ?? '';
    }
  }

  return record;
}

/**
 * Get an API session ID from Sage Intacct.
 */
async function getSessionId(): Promise<string> {
  const loginXml = buildLoginRequest();
  const responseXml = await intacctRequest(loginXml);

  const sessionId = extractXmlValue(responseXml, 'sessionid');
  if (!sessionId) {
    const errMessage = extractXmlValue(responseXml, 'errormessage') ?? 'Unknown error';
    logger.error({ errMessage }, 'Sage Intacct session creation failed');
    throw new Error(`Sage Intacct session creation failed: ${errMessage}`);
  }

  return sessionId;
}

/**
 * Run a readByQuery and paginate through all results.
 */
async function queryAll(
  sessionId: string,
  objectType: string,
  fields: string,
  query?: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const queryClause = query ? `<query>${query}</query>` : '<query />';
    const content = `
      <readByQuery>
        <object>${objectType}</object>
        <fields>${fields}</fields>
        ${queryClause}
        <pagesize>${DEFAULT_PAGE_SIZE}</pagesize>
        <returnFormat>xml</returnFormat>
      </readByQuery>`;

    // readByQuery with offset uses readMore for subsequent pages
    let responseXml: string;

    if (offset === 0) {
      const xmlBody = buildXmlRequest(sessionId, content);
      responseXml = await intacctRequest(xmlBody);
    } else {
      // Use readMore with the resultId from the first response
      const readMoreContent = `
        <readMore>
          <resultId>${objectType}</resultId>
        </readMore>`;
      const xmlBody = buildXmlRequest(sessionId, readMoreContent);
      responseXml = await intacctRequest(xmlBody);
    }

    // Check for errors
    const errorMessage = extractXmlValue(responseXml, 'errormessage');
    if (errorMessage) {
      logger.error({ objectType, errorMessage }, 'Sage Intacct query error');
      break;
    }

    // Extract records from the XML data element
    const dataXml = extractXmlValue(responseXml, 'data') ?? '';
    const elements = extractXmlElements(dataXml, objectType.toLowerCase());

    if (elements.length === 0) {
      hasMore = false;
      break;
    }

    for (const element of elements) {
      results.push(parseXmlToRecord(element));
    }

    // Check numremaining to know if there are more results
    const numRemaining = extractXmlValue(responseXml, 'numremaining');
    if (numRemaining && parseInt(numRemaining, 10) > 0) {
      offset += elements.length;
    } else {
      hasMore = false;
    }
  }

  return results;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

class SageIntacctAdapter extends BaseAdapter {
  readonly provider = 'sage-intacct' as const;
  readonly tier = 'native' as const;

  // ── OAuth (session-based, not standard OAuth) ────────────────────────────

  getAuthUrl(_orgId: string, _redirectUri: string): string {
    throw new Error('Sage Intacct uses session-based XML authentication, not OAuth. Configure SAGE_INTACCT_* env variables instead.');
  }

  async handleCallback(_code: string, _orgId: string): Promise<TokenSet> {
    // Create a session and return it as the access_token
    const sessionId = await getSessionId();

    return {
      access_token: sessionId,
      // Sessions are temporary, typically valid for ~30 minutes
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  async refreshToken(_currentTokens: TokenSet): Promise<TokenSet> {
    // Create a new session
    const sessionId = await getSessionId();

    return {
      access_token: sessionId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  // ── Sync: Sage Intacct → CrewShift ────────────────────────────────────

  async syncCustomers(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const sessionId = accessToken || (await getSessionId());

    const customers = await queryAll(
      sessionId,
      'CUSTOMER',
      'CUSTOMERID,CUSTOMERNAME,CONTACTINFO.FIRSTNAME,CONTACTINFO.LASTNAME,CONTACTINFO.EMAIL1,CONTACTINFO.PHONE1,DISPLAYCONTACT.MAILADDRESS.ADDRESS1,DISPLAYCONTACT.MAILADDRESS.CITY,DISPLAYCONTACT.MAILADDRESS.STATE,DISPLAYCONTACT.MAILADDRESS.ZIP,STATUS,WHENCREATED,WHENMODIFIED',
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const cust of customers) {
      try {
        records.push({
          name: (cust.CUSTOMERNAME as string) ?? `${cust['CONTACTINFO.FIRSTNAME'] ?? ''} ${cust['CONTACTINFO.LASTNAME'] ?? ''}`.trim(),
          company_name: (cust.CUSTOMERNAME as string) ?? null,
          email: (cust['CONTACTINFO.EMAIL1'] as string) ?? null,
          phone: (cust['CONTACTINFO.PHONE1'] as string) ?? null,
          address: cust['DISPLAYCONTACT.MAILADDRESS.ADDRESS1']
            ? {
                street: (cust['DISPLAYCONTACT.MAILADDRESS.ADDRESS1'] as string) ?? '',
                city: (cust['DISPLAYCONTACT.MAILADDRESS.CITY'] as string) ?? '',
                state: (cust['DISPLAYCONTACT.MAILADDRESS.STATE'] as string) ?? '',
                zip: (cust['DISPLAYCONTACT.MAILADDRESS.ZIP'] as string) ?? '',
              }
            : null,
          external_ids: { 'sage-intacct': String(cust.CUSTOMERID) },
          source: 'sage-intacct',
          metadata: {
            si_customer_id: cust.CUSTOMERID,
            si_status: cust.STATUS,
            si_created: cust.WHENCREATED,
            si_modified: cust.WHENMODIFIED,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: cust, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: customers.length, created, errors: errors.length },
      'Sage Intacct customer sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  async syncInvoices(
    accessToken: string,
    _lastSyncAt?: string,
  ): Promise<SyncResult<Record<string, unknown>>> {
    const sessionId = accessToken || (await getSessionId());

    const invoices = await queryAll(
      sessionId,
      'ARINVOICE',
      'RECORDNO,RECORDID,CUSTOMERID,CUSTOMERNAME,TOTALDUE,TOTALPAID,TOTALENTERED,WHENDUE,WHENCREATED,WHENMODIFIED,STATE,DESCRIPTION',
    );

    const records: Record<string, unknown>[] = [];
    const errors: Array<{ item: unknown; error: string }> = [];
    let created = 0;
    const updated = 0;

    for (const inv of invoices) {
      try {
        const totalDue = parseFloat((inv.TOTALDUE as string) ?? '0');
        const totalEntered = parseFloat((inv.TOTALENTERED as string) ?? '0');
        const totalPaid = parseFloat((inv.TOTALPAID as string) ?? '0');

        records.push({
          invoice_number: (inv.RECORDID as string) ?? null,
          status: this.mapInvoiceStatus(inv),
          amount: totalEntered,
          balance_due: totalDue,
          due_date: (inv.WHENDUE as string) ?? null,
          issued_date: (inv.WHENCREATED as string) ?? null,
          customer_external_id: inv.CUSTOMERID ? String(inv.CUSTOMERID) : null,
          external_ids: { 'sage-intacct': String(inv.RECORDNO) },
          source: 'sage-intacct',
          metadata: {
            si_record_no: inv.RECORDNO,
            si_record_id: inv.RECORDID,
            si_customer_name: inv.CUSTOMERNAME,
            si_state: inv.STATE,
            si_total_paid: totalPaid,
            si_description: inv.DESCRIPTION,
            si_modified: inv.WHENMODIFIED,
          },
        });
        created++;
      } catch (err) {
        errors.push({ item: inv, error: (err as Error).message });
      }
    }

    logger.info(
      { provider: this.provider, total: invoices.length, created, errors: errors.length },
      'Sage Intacct invoice sync complete',
    );

    return { created, updated, skipped: 0, errors, records };
  }

  // ── Write-back: CrewShift → Sage Intacct ───────────────────────────────

  async createInvoice(
    accessToken: string,
    invoiceData: Record<string, unknown>,
  ): Promise<ExternalId> {
    const sessionId = accessToken || (await getSessionId());

    const lineItems = (invoiceData.line_items as Array<Record<string, unknown>>) ?? [];
    const linesXml = lineItems
      .map(
        (item) => `
      <lineitem>
        <glaccountno>${(item.gl_account as string) ?? '4000'}</glaccountno>
        <amount>${(item.total as number) ?? 0}</amount>
        <memo>${(item.description as string) ?? 'Service'}</memo>
      </lineitem>`,
      )
      .join('\n');

    const content = `
    <create_arinvoice>
      <customerid>${invoiceData.customer_external_id}</customerid>
      <datecreated>
        <year>${new Date().getFullYear()}</year>
        <month>${new Date().getMonth() + 1}</month>
        <day>${new Date().getDate()}</day>
      </datecreated>
      <termname>${(invoiceData.payment_term as string) ?? 'Net 30'}</termname>
      <invoiceitems>
        ${linesXml}
      </invoiceitems>
    </create_arinvoice>`;

    const xmlBody = buildXmlRequest(sessionId, content);
    const responseXml = await intacctRequest(xmlBody);

    const errorMessage = extractXmlValue(responseXml, 'errormessage');
    if (errorMessage) {
      throw new Error(`Sage Intacct create invoice failed: ${errorMessage}`);
    }

    const recordNo = extractXmlValue(responseXml, 'RECORDNO') ?? 'unknown';

    return {
      provider: this.provider,
      external_id: recordNo,
    };
  }

  // ── Webhooks (not supported) ─────────────────────────────────────────────

  // Sage Intacct does not support webhooks. The base class defaults apply:
  // verifyWebhook returns false, processWebhook throws.

  // ── Private Helpers ──────────────────────────────────────────────────────

  private mapInvoiceStatus(inv: Record<string, unknown>): string {
    const state = (inv.STATE as string)?.toLowerCase();
    if (state === 'posted' || state === 'paid') {
      const totalDue = parseFloat((inv.TOTALDUE as string) ?? '0');
      if (totalDue === 0) return 'paid';
      const totalEntered = parseFloat((inv.TOTALENTERED as string) ?? '0');
      if (totalDue < totalEntered) return 'partial';
    }
    if (state === 'draft') return 'draft';
    if (state === 'voided' || state === 'reversed') return 'void';

    const dueDate = inv.WHENDUE as string | undefined;
    if (dueDate && new Date(dueDate) < new Date()) return 'overdue';

    return 'sent';
  }
}

// ── Self-register ────────────────────────────────────────────────────────────

const adapter = new SageIntacctAdapter();
registerAdapter(adapter);
export default adapter;
