import { authorize, audit, check, hash, newId, now, type Context, type StateStore } from './contracts.ts';
import { assertSourceAccess, trustFingerprint } from './trust.ts';
import { ImportService, type MappingRecipe, type ImportFormat } from './ingest.ts';

export type HttpRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; maxBytes: number; timeoutMs: number; redirect: 'error' };
export type HttpResponse = { status: number; body: string | Uint8Array; url?: string; headers?: Record<string, string> };
export type BoundedHttp = (request: HttpRequest) => Promise<HttpResponse>;
export type CredentialBroker = (context: Context, scope: { connector: string; sourceId: string; organizationId: string; origin: string }) => Promise<string>;
export const CONNECTOR_LIMITS = Object.freeze({ maxPages: 20, maxRows: 2000, maxRequests: 250, pageBytes: 4 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, timeoutMs: 15000, totalTimeoutMs: 60000 });

/** One bounded request, with streamed size enforcement and no redirects or retries. */
export const boundedHttp: BoundedHttp = async request => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: controller.signal });
    check(!response.redirected && response.url === request.url, 'HTTP_REDIRECT_REFUSED', 'Redirected responses are refused.');
    const declared = response.headers.get('content-length');
    check(!declared || (/^\d+$/.test(declared) && Number(declared) <= request.maxBytes), 'HTTP_BYTE_LIMIT', 'The response exceeds the byte limit.');
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; check(size <= request.maxBytes, 'HTTP_BYTE_LIMIT', 'The response exceeds the byte limit.'); chunks.push(value); } }
      catch (error) { await reader.cancel().catch(() => {}); throw error; }
    }
    return { status: response.status, url: response.url, body: Buffer.concat(chunks), headers: { 'content-type': response.headers.get('content-type') ?? '' } };
  } finally { clearTimeout(timer); }
};

type Status = 'planned' | 'fixture-tested' | 'live-verified';
type Operation = { status: Status; implemented: boolean; evidence: string[]; limitation: string };
const systems: Array<[string, string, string]> = [
  ['tally-prime','TallyPrime','accounting'], ['tally-erp9','Tally.ERP 9','accounting'], ['zoho-books','Zoho Books','accounting'], ['vyapar','Vyapar','accounting'], ['mybillbook','myBillBook','accounting'], ['busy','BUSY','accounting'], ['marg','Marg ERP','accounting'], ['quickbooks','QuickBooks','accounting'], ['xero','Xero','accounting'], ['wave','Wave','accounting'], ['sage','Sage','accounting'], ['odoo','Odoo','erp'], ['erpnext','ERPNext','erp'], ['sap','SAP','enterprise'], ['oracle','Oracle Fusion','enterprise'], ['netsuite','NetSuite','enterprise'], ['dynamics','Dynamics 365','enterprise'],
  ['razorpay','Razorpay','payments'], ['cashfree','Cashfree','payments'], ['payu','PayU','payments'], ['stripe','Stripe','payments'], ['phonepe','PhonePe','payments'], ['paytm','Paytm','payments'],
  ['hdfc','HDFC Bank','banking'], ['icici','ICICI Bank','banking'], ['sbi','State Bank of India','banking'], ['axis','Axis Bank','banking'], ['kotak','Kotak Bank','banking'], ['idfc','IDFC FIRST Bank','banking'],
  ['gstn','GST portal / GSTR-2B','tax'], ['income-tax','Income tax portal','tax'],
  ['shopify','Shopify','commerce'], ['woocommerce','WooCommerce','commerce'], ['amazon','Amazon Seller','commerce'], ['flipkart','Flipkart Seller','commerce'], ['meesho','Meesho','commerce'], ['myntra','Myntra','commerce'],
  ['shiprocket','Shiprocket','logistics'], ['delhivery','Delhivery','logistics'], ['unicommerce','Unicommerce','logistics'], ['vinculum','Vinculum','logistics'],
  ['meta-ads','Meta Ads','advertising'], ['google-ads','Google Ads','advertising'], ['ga4','Google Analytics 4','analytics'],
  ['salesforce','Salesforce','crm'], ['hubspot','HubSpot','crm'], ['zoho-crm','Zoho CRM','crm'],
  ['google-sheets','Google Sheets','files'], ['excel','Microsoft Excel','files'], ['csv','Canonical CSV files','files'],
];
function operation(status: Status, implemented: boolean, limitation: string, evidence: string[] = []): Operation { return { status, implemented, limitation, evidence }; }
export const CONNECTOR_REGISTRY = Object.freeze(systems.map(([id, name, family]) => {
  const native = ['tally-prime','zoho-books'].includes(id), csv = id === 'csv';
  return { id, name, family, operations: {
    import: native || csv ? operation('fixture-tested', true, 'Requires a scoped mapping recipe and independent upstream report totals.', ['platform/tests/connectors.test.ts']) : operation('planned', false, 'Generic CSV machinery exists, but this system has no qualified system-specific recipe.'),
    read: native ? operation('fixture-tested', true, id === 'tally-prime' ? 'Loopback Day Book XML export; a real Tally installation and hidden-business qualification remain unverified.' : 'Explicit organization/region OAuth read; no real account or hidden-business qualification has been verified.', ['platform/tests/connectors.test.ts']) : operation('planned', false, 'No native read adapter is installed.'),
    write: operation('planned', false, 'No write operation is provided by this connector.'),
  }, liveVerified: false, qualification: native || csv ? 'fixture-tested' : 'planned', genericCsvImportAvailable: true };
}));

const ZOHO_ORIGINS = ['com','eu','in','com.au','jp','ca','com.cn','sa'].map(region => `https://www.zohoapis.${region}`);
export type SourceTotals = { rowCount: number; amountMinor: string; reportId: string; provenance: 'upstream-report'; company: string };
export type ConnectorFetch = { connector: string; sourceId: string; organizationId?: string; company?: string; endpoint?: string; sourceOwnTotals?: SourceTotals };
function xmlEscape(text: string) { return text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]!)); }
export function tallyExportRequest(company: string): string {
  check(typeof company === 'string' && company.trim().length > 0 && company.length <= 200 && !/[\u0000-\u001f]/.test(company), 'COMPANY_REQUIRED', 'Select the exact Tally company.');
  return `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
}
function tallyEndpoint(value = 'http://127.0.0.1:9000/'): string {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
  check(url.protocol === 'http:' && ['127.0.0.1','::1','localhost'].includes(host) && Number(url.port) >= 1024 && Number(url.port) <= 65535 && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'ENDPOINT_REFUSED', 'Tally must use an explicit loopback HTTP port with no path or credentials.');
  if (host === 'localhost') url.hostname = '127.0.0.1'; return url.href;
}
function zohoEndpoint(value?: string): string {
  check(typeof value === 'string' && value.length <= 200, 'REGION_REQUIRED', 'Select the official Zoho Books endpoint for your data center.');
  const url = new URL(value);
  check(ZOHO_ORIGINS.includes(url.origin) && /^\/books\/v3\/?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash, 'ENDPOINT_REFUSED', 'Use an official Zoho Books regional /books/v3 endpoint.');
  return `${url.origin}/books/v3`;
}
function textBody(response: HttpResponse, request: HttpRequest): string {
  check(response.status >= 200 && response.status < 300, response.status >= 300 && response.status < 400 ? 'HTTP_REDIRECT_REFUSED' : 'CONNECTOR_HTTP_ERROR', 'The source did not return a successful read response.');
  check(!response.url || response.url === request.url, 'HTTP_REDIRECT_REFUSED', 'Redirected responses are refused.');
  const bytes = typeof response.body === 'string' ? Buffer.from(response.body) : Buffer.from(response.body);
  check(bytes.length <= request.maxBytes, 'HTTP_BYTE_LIMIT', 'The source response exceeds its byte limit.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function safeJson(text: string): any {
  // Preserve numeric lexemes, including money and identifiers, before JavaScript rounding.
  const parse: any = JSON.parse;
  const value = parse(text, (_key: string, value: any, context: any) => typeof value === 'number' ? (context?.source ?? String(value)) : value);
  let nodes = 0;
  const visit = (node: any, depth = 0) => {
    check(depth <= 32 && ++nodes <= 100000, 'SOURCE_STRUCTURE_LIMIT', 'The source has excessive nesting or fields.');
    if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) { check(!['__proto__','prototype','constructor'].includes(key), 'UNSAFE_SOURCE', 'Reserved source keys are refused.'); visit(value, depth + 1); }
  };
  visit(value); return value;
}
function tallyRows(text: string): number {
  check(!/<!DOCTYPE|<!ENTITY/i.test(text), 'UNSAFE_XML', 'DTD and external entities are refused.');
  const stack: string[] = []; let cursor = 0, roots = 0, rows = 0;
  for (const match of text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g)) {
    const between = text.slice(cursor, match.index); check(!between.includes('<') && (stack.length > 0 || !between.trim()), 'TRUNCATED_SOURCE', 'The XML document is incomplete.'); cursor = match.index! + match[0].length;
    const token = match[0]; if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<![CDATA[')) continue;
    if (token.startsWith('</')) { check(stack.pop() === token.slice(2,-1).trim().toUpperCase(), 'TRUNCATED_SOURCE', 'The XML document is incomplete.'); continue; }
    const opening = /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*)?\s*\/?\s*>$/.exec(token); check(opening, 'UNSAFE_XML', 'The XML contains unsupported elements.');
    if (!stack.length) roots++;
    const name = opening[1].toUpperCase(); if (name === 'VOUCHER') rows++;
    check(name !== 'LINEERROR', 'CONNECTOR_SOURCE_ERROR', 'Tally reported an export error.');
    if (!token.endsWith('/>')) { stack.push(name); check(stack.length <= 64, 'SOURCE_STRUCTURE_LIMIT', 'The XML nesting limit was exceeded.'); }
  }
  check(roots === 1 && !stack.length && !text.slice(cursor).trim(), 'TRUNCATED_SOURCE', 'The XML document is incomplete.');
  return rows;
}
function checkTotals(value: SourceTotals | undefined, company: string, rows: number) {
  if (!value) return;
  check(value.provenance === 'upstream-report' && typeof value.reportId === 'string' && value.reportId.length > 0 && value.company === company && Number.isSafeInteger(value.rowCount) && value.rowCount >= 0 && /^-?\d+$/.test(value.amountMinor), 'INVALID_SOURCE_TOTALS', 'Source totals require a named upstream report for the selected company.');
  check(value.rowCount === rows, 'INCOMPLETE_SOURCE', 'The fetched row count does not match the upstream report.');
}

type Proposal = { id: string; connector: string; sourceId: string; company: string; edition: string; fields: string[]; evidence: { reportId: string; sha256: string }; bindings: Array<{ target: string; candidates: string[]; selected: string | null; ambiguous: boolean }>; status: 'proposed' | 'accepted' };
const ALIASES: Record<string,string[]> = { entityId:['id','invoice_id','GUID','MASTERID'], validFrom:['date','DATE'], amountMinor:['sub_total','subtotal','net_amount','amount'], currency:['currency','currency_code'], customerId:['customer_id','customerId'], invoiceId:['invoice_id','invoiceId'], status:['status'] };
export class ConnectorService {
  #store: StateStore;
  #http: BoundedHttp;
  #credentials?: CredentialBroker;
  constructor(store: StateStore, dependencies: { http?: BoundedHttp; credentialBroker?: CredentialBroker } = {}) { this.#store = store; this.#http = dependencies.http ?? boundedHttp; this.#credentials = dependencies.credentialBroker; }
  #access(context: Context, sourceId: string, fingerprint?: string) {
    authorize(this.#store, context, 'prepare'); assertSourceAccess(this.#store.read(), context, [sourceId]);
    if (fingerprint) check(trustFingerprint(this.#store.read(), context, [sourceId]) === fingerprint, 'AUTHORITY_CHANGED', 'Your source permission or trust policy changed during the read.');
  }
  catalogue(context: Context) { authorize(this.#store, context); return structuredClone(CONNECTOR_REGISTRY); }
  async fetch(context: Context, input: ConnectorFetch) {
    check(typeof input.sourceId === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(input.sourceId), 'SOURCE_REQUIRED', 'Choose a named source.');
    this.#access(context, input.sourceId);
    const fingerprint = trustFingerprint(this.#store.read(), context, [input.sourceId]);
    const deadline = Date.now() + CONNECTOR_LIMITS.totalTimeoutMs; let requests = 0, bytes = 0, rows = 0, pages = 0;
    const request = async (url: string, method: HttpRequest['method'], headers: Record<string,string>, body?: string) => {
      this.#access(context, input.sourceId, fingerprint);
      check(Date.now() < deadline, 'CONNECTOR_REQUEST_LIMIT', 'The source read exceeded its overall time budget.');
      check(++requests <= CONNECTOR_LIMITS.maxRequests && Date.now() < deadline, 'CONNECTOR_REQUEST_LIMIT', 'The bounded source read exceeded its request or time budget.');
      const request = { url, method, headers, body, maxBytes: Math.min(CONNECTOR_LIMITS.pageBytes, CONNECTOR_LIMITS.totalBytes - bytes), timeoutMs: Math.min(CONNECTOR_LIMITS.timeoutMs, Math.max(1, deadline - Date.now())), redirect: 'error' as const };
      let response: HttpResponse;
      try { response = await this.#http(request); } catch (error: any) { if (error?.code) throw error; check(false, 'CONNECTOR_NETWORK_ERROR', 'The source read failed. No automatic retry was sent.'); }
      this.#access(context, input.sourceId, fingerprint);
      check(Date.now() < deadline, 'CONNECTOR_REQUEST_LIMIT', 'The source read exceeded its overall time budget.');
      const text = textBody(response!, request); bytes += Buffer.byteLength(text);
      check(bytes <= CONNECTOR_LIMITS.totalBytes, 'HTTP_BYTE_LIMIT', 'The source exceeds its total byte budget.'); return text;
    };
    let format: ImportFormat, content: string, company: string, details = 0;
    if (input.connector === 'tally-prime') {
      company = input.company ?? ''; const endpoint = tallyEndpoint(input.endpoint);
      content = await request(endpoint, 'POST', { 'Content-Type':'text/xml; charset=utf-8', Accept:'application/xml,text/xml' }, tallyExportRequest(company));
      rows = tallyRows(content); pages = 1; format = 'tally-xml';
      check(rows <= CONNECTOR_LIMITS.maxRows, 'CONNECTOR_ROW_LIMIT', 'The Tally export exceeds the bounded row limit. Export a smaller register.');
    } else if (input.connector === 'zoho-books') {
      check(typeof input.organizationId === 'string' && /^\d{1,30}$/.test(input.organizationId), 'ORGANIZATION_REQUIRED', 'Choose the explicit Zoho organization ID.');
      const base = zohoEndpoint(input.endpoint); company = input.organizationId;
      check(this.#credentials, 'CREDENTIAL_REQUIRED', 'A trusted engine credential broker must provide the Zoho access token.');
      const token = await this.#credentials(context, { connector:input.connector, sourceId:input.sourceId, organizationId:input.organizationId, origin:new URL(base).origin });
      this.#access(context, input.sourceId, fingerprint);
      check(typeof token === 'string' && token.length > 0 && token.length <= 4096 && !/[\r\n]/.test(token), 'CREDENTIAL_REQUIRED', 'The credential broker did not return a usable token.');
      const headers = { Authorization:`Zoho-oauthtoken ${token}`, Accept:'application/json' };
      const invoices: any[] = [], seen = new Set<string>(); let expectedRows: number | null = null, complete = false;
      for (let page = 1; page <= CONNECTOR_LIMITS.maxPages; page++) {
        const url = new URL(`${base}/invoices`); url.searchParams.set('organization_id', input.organizationId); url.searchParams.set('page', String(page)); url.searchParams.set('per_page','200');
        const response = safeJson(await request(url.href,'GET',headers)); pages++;
        const cursor = response.page_context;
        check(Number(response.code) === 0 && Array.isArray(response.invoices) && cursor && Number(cursor.page) === page && typeof cursor.has_more_page === 'boolean', 'INVALID_ZOHO_PAGE', 'Zoho did not return a valid invoice page and page context.');
        check(response.invoices.length <= 200 && !(cursor.has_more_page && response.invoices.length === 0), 'INCOMPLETE_SOURCE', 'Zoho returned an empty or oversized continuing page.');
        const count = cursor.total_count ?? cursor.total;
        if (count !== undefined) { const n = Number(count); check(Number.isSafeInteger(n) && n >= 0 && (expectedRows === null || expectedRows === n), 'INCONSISTENT_SOURCE', 'Zoho changed its declared row count during pagination.'); expectedRows = n; }
        for (let invoice of response.invoices) {
          check(invoice && /^\d{1,40}$/.test(String(invoice.invoice_id)) && !seen.has(String(invoice.invoice_id)), 'DUPLICATE_SOURCE_ROW', 'A Zoho page repeated or omitted an invoice identity.');
          seen.add(String(invoice.invoice_id)); rows++;
          check(rows <= CONNECTOR_LIMITS.maxRows, 'CONNECTOR_ROW_LIMIT', 'The Zoho read exceeds the bounded row limit.');
          if (invoice.sub_total === undefined && invoice.subtotal === undefined) {
            const detail = new URL(`${base}/invoices/${invoice.invoice_id}`); detail.searchParams.set('organization_id', input.organizationId);
            const response = safeJson(await request(detail.href,'GET',headers)); details++;
            check(Number(response.code) === 0 && response.invoice && String(response.invoice.invoice_id) === String(invoice.invoice_id), 'INVALID_ZOHO_DETAIL', 'Zoho returned an inconsistent invoice detail.'); invoice = response.invoice;
          }
          const net = invoice.sub_total ?? invoice.subtotal;
          check(typeof net === 'string' && /^-?\d+(\.\d{1,2})?$/.test(net) && typeof invoice.date === 'string' && typeof invoice.currency_code === 'string', 'AMBIGUOUS_ZOHO_MONEY', 'Every invoice needs an exact net subtotal, date, and explicit currency. Gross totals cannot stand in for revenue.');
          invoices.push(invoice);
        }
        if (!cursor.has_more_page) { complete = true; break; }
      }
      check(complete, 'INCOMPLETE_SOURCE', 'Zoho still has more pages at the hard limit. No partial export was accepted.');
      check(expectedRows === null || expectedRows === rows, 'INCOMPLETE_SOURCE', 'The complete Zoho read does not match its declared row count.');
      content = JSON.stringify({ code:0, invoices, complete:true, page_context:{ page:pages, has_more_page:false }, organization_id:input.organizationId }); format = 'zoho-json';
    } else check(false, 'CONNECTOR_PLANNED', 'This system has no installed native read adapter. Use an explicitly scoped file recipe.');
    checkTotals(input.sourceOwnTotals, company!, rows);
    this.#access(context, input.sourceId, fingerprint);
    const receipt = { id:newId('connector-read'), at:now(), connector:input.connector, sourceId:input.sourceId, format:format!, pages, rows, bytes, requests, detailRequests:details, contentHash:hash(content!), qualification:'fixture-tested', liveVerified:false, upstreamTotals:input.sourceOwnTotals ? structuredClone(input.sourceOwnTotals) : null };
    await this.#store.update(state => { this.#access(context, input.sourceId, fingerprint); state.receipts.push(receipt); audit(state,'connector.read',{ receiptId:receipt.id, sourceId:input.sourceId, connector:input.connector, rows }); });
    return { format:format!, content:content!, sourceOwnTotals:input.sourceOwnTotals ? structuredClone(input.sourceOwnTotals) : undefined, coverage:{ qualification:'fixture-tested', liveVerified:false, complete:true, pages, rows, bytes, reconciliation:input.sourceOwnTotals ? 'row-count-checked-money-requires-mapping' : 'independent-source-totals-required', snapshotConsistency:'unverified', limitations:['Real installation qualification and hidden-business evidence have not been run.'] }, receipt };
  }
  /** Tests transformed amounts against independently supplied upstream totals using the existing data-only importer. */
  reconcile(context: Context, input: { sourceId:string; format:ImportFormat; content:string; recipe:MappingRecipe; sourceOwnTotals:SourceTotals }) {
    this.#access(context,input.sourceId);
    check(input.sourceOwnTotals?.provenance === 'upstream-report' && !!input.sourceOwnTotals.reportId, 'SOURCE_TOTALS_REQUIRED', 'Provide the independently captured upstream report totals.');
    check(input.sourceOwnTotals.company === input.recipe.scope.company, 'SOURCE_SCOPE_MISMATCH', 'The report totals and mapping recipe must describe the same company.');
    return new ImportService(this.#store).preview(context,{ sourceId:input.sourceId, format:input.format, content:input.content, recipe:input.recipe, expectedTotals:{ rowCount:input.sourceOwnTotals.rowCount, amountMinor:input.sourceOwnTotals.amountMinor } });
  }
  async proposeRecipe(context: Context, input: { connector:string; sourceId:string; company:string; edition:string; fields:string[]; evidence:{reportId:string;sha256:string} }): Promise<Proposal> {
    this.#access(context,input.sourceId);
    check(CONNECTOR_REGISTRY.some(item => item.id === input.connector) && typeof input.company === 'string' && input.company.length > 0 && typeof input.edition === 'string' && input.edition.length > 0, 'INVALID_RECIPE_SCOPE', 'Name the system edition and company for this recipe.');
    check(Array.isArray(input.fields) && input.fields.length <= 100 && new Set(input.fields).size === input.fields.length && input.fields.every(field => typeof field === 'string' && field.length > 0 && field.length <= 80 && !['__proto__','prototype','constructor'].includes(field)), 'INVALID_RECIPE_FIELDS', 'Recipe fields must be bounded, unique data names.');
    check(typeof input.evidence?.reportId === 'string' && input.evidence.reportId.length > 0 && input.evidence.reportId.length <= 200 && /^[a-f0-9]{64}$/.test(input.evidence.sha256), 'RECIPE_EVIDENCE_REQUIRED', 'A recipe needs its named source report and SHA-256 evidence.');
    const bindings = Object.entries(ALIASES).map(([target, aliases]) => { const candidates = input.fields.filter(field => aliases.includes(field)); return { target,candidates,selected:candidates.length === 1 ? candidates[0] : null, ambiguous:candidates.length !== 1 || (target === 'amountMinor' && candidates.includes('amount')) }; });
    const proposal: Proposal = { id:newId('recipe-proposal'), connector:input.connector, sourceId:input.sourceId, company:input.company, edition:input.edition, fields:[...input.fields], evidence:structuredClone(input.evidence), bindings, status:'proposed' };
    await this.#store.update(state => { this.#access(context,input.sourceId); state.learning.push({ ...proposal, category:'connector-recipe', at:now(), executable:false, qualification:'unqualified' }); audit(state,'connector.recipe.proposed',{ proposalId:proposal.id }); });
    return structuredClone(proposal);
  }
  async acceptRecipe(context: Context, input: { proposalId:string; resolutions:Record<string,{source:string;meaning:string}> }) {
    authorize(this.#store,context,'admin');
    return this.#store.update(state => {
      authorize(this.#store,context,'admin');
      const proposal = state.learning.find(item => item.id === input.proposalId && item.category === 'connector-recipe'); check(proposal && proposal.status === 'proposed', 'RECIPE_NOT_FOUND', 'Choose a pending recipe proposal.'); this.#access(context,proposal.sourceId);
      check(input.resolutions && typeof input.resolutions === 'object' && Object.keys(input.resolutions).every(target => Object.hasOwn(ALIASES,target)), 'INVALID_RECIPE_BINDING', 'Only named dictionary fields can be accepted.');
      const bindings = proposal.bindings.map((binding: any) => {
        const selected = input.resolutions[binding.target];
        if (!binding.ambiguous && !selected) return { target:binding.target, source:binding.selected, meaning:binding.target };
        if (!selected && !['entityId','validFrom','amountMinor','currency'].includes(binding.target)) return null;
        check(selected && proposal.fields.includes(selected.source) && typeof selected.meaning === 'string' && selected.meaning.length > 0 && selected.meaning.length <= 300, 'AMBIGUOUS_RECIPE', 'Resolve identity, date, net-money, and currency meaning before accepting this recipe.');
        return { target:binding.target, source:selected.source, meaning:selected.meaning };
      }).filter(Boolean);
      proposal.status = 'accepted'; proposal.bindings = bindings; proposal.acceptedAt = now(); proposal.acceptedBy = context.memberId;
      audit(state,'connector.recipe.accepted',{ proposalId:proposal.id }); return structuredClone(proposal);
    });
  }
}
