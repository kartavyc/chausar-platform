import { check } from '../../contracts.ts';
import { parseTallyXmlDocument, type TallyXmlNode } from './tally.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { checkPeriod, strictConfig } from '../google/common.ts';

/**
 * Tally registers over the Tally XML interface on this computer (TallyPrime / Tally.ERP 9 with the
 * XML server enabled, default port 9000). Every request is an Export with an inline TDL collection;
 * nothing is imported or altered in Tally. No credential exists: the endpoint is loopback only.
 *
 * Company. Tally can have several companies open at once. Without SVCURRENTCOMPANY an export reads
 * whichever company is active, so every register read names the company explicitly; use
 * tallyCompaniesSpec ('list-companies') to show the person the open companies and let them choose.
 *
 * Sign convention. In Tally XML a ledger entry's AMOUNT is negative for a debit and positive for a
 * credit, and ISDEEMEDPOSITIVE is Yes for a debit. Each posting becomes a record with the exact
 * AMOUNT text and side 'debit' or 'credit'; when ISDEEMEDPOSITIVE and the sign disagree the read is
 * refused. Recipes set the sign from the side: sales count credits positive, purchases debits.
 *
 * Totals. 'sales-register-total' / 'purchase-register-total' read the period opening and closing
 * balance of the Sales Accounts / Purchase Accounts group; the movement between them is declared as
 * the register total. That movement includes every voucher posting to the group (credit notes,
 * journals), while the register holds Sales / Purchase vouchers only, so a period with such entries
 * is refused as a mismatch rather than accepted; use the '.report' recipe then. A nil balance that
 * Tally exports as an empty field is refused, never read as zero.
 */
export type TallyRegister = 'sales' | 'purchase';
export type TallyRegisterConfig = {
  /** Loopback XML server, default http://127.0.0.1:9000/. */
  endpoint?: string;
  /** The exact company name as Tally shows it. */
  company: string;
  /** The company's base currency as the person confirms it (Tally XML amounts carry no ISO code). */
  baseCurrency: string;
  /** The sales (or purchase) ledgers whose postings make up the register, from tallyLedgersSpec. */
  ledgers: string[];
  /** Also read the group movement as the declared total. Default true. */
  declareTotal?: boolean;
};
export type TallyEndpointConfig = { endpoint?: string };
export type TallyLedgersConfig = { endpoint?: string; company: string };

/** Same rule as the core connector: explicit loopback HTTP port, no path, query or credentials. */
export function tallyRegisterEndpoint(value = 'http://127.0.0.1:9000/'): string {
  check(typeof value === 'string' && value.length <= 200, 'ENDPOINT_REFUSED', 'Tally must use an explicit loopback HTTP port with no path or credentials.');
  let url: URL;
  try { url = new URL(value); } catch { check(false, 'ENDPOINT_REFUSED', 'Tally must use an explicit loopback HTTP port with no path or credentials.'); throw new Error('unreachable'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  check(url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(host) && Number(url.port) >= 1024 && Number(url.port) <= 65535 && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'ENDPOINT_REFUSED', 'Tally must use an explicit loopback HTTP port with no path or credentials.');
  if (host === 'localhost') url.hostname = '127.0.0.1';
  return url.href;
}
const xmlEscape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const tallyDay = (day: string) => day.replaceAll('-', '');
const companyName = (value: unknown) => {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value), 'COMPANY_REQUIRED', 'Select the exact Tally company.');
  return value;
};
const ledgerName = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);

const REQUEST_IDS = { sales: 'ChausarSalesRegister', purchase: 'ChausarPurchaseRegister', total: 'ChausarGroupTotal', ledgers: 'ChausarLedgers', companies: 'ChausarCompanies' } as const;
const GROUPS: Record<TallyRegister, string> = { sales: 'Sales Accounts', purchase: 'Purchase Accounts' };
function envelope(id: string, variables: string, tdl: string): string {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${id}</ID></HEADER>`
    + `<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${variables}</STATICVARIABLES>`
    + `<TDL><TDLMESSAGE>${tdl}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}
const periodVariables = (company: string, period: { from: string; to: string }) =>
  `<SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">${tallyDay(period.from)}</SVFROMDATE><SVTODATE TYPE="Date">${tallyDay(period.to)}</SVTODATE>`;

/** Sales or Purchase vouchers in the period (cancelled and optional vouchers are kept, then excluded by the recipe). */
export function tallyRegisterRequestBody(register: TallyRegister, company: string, period: { from: string; to: string }): string {
  const id = REQUEST_IDS[register], test = register === 'sales' ? '$$IsSales:$VoucherTypeName' : '$$IsPurchase:$VoucherTypeName';
  return envelope(id, periodVariables(companyName(company), period),
    `<COLLECTION NAME="${id}" ISMODIFY="No"><TYPE>Voucher</TYPE>`
    + '<FETCH>Date, VoucherNumber, VoucherTypeName, PartyLedgerName, MasterId, IsCancelled, IsOptional, AllLedgerEntries.*, LedgerEntries.*, AllInventoryEntries.*</FETCH>'
    + `<FILTER>ChausarRegisterType</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="ChausarRegisterType">${test}</SYSTEM>`);
}
/** The Sales Accounts / Purchase Accounts group's opening and closing balance for the period. */
export function tallyRegisterTotalRequestBody(register: TallyRegister, company: string, period: { from: string; to: string }): string {
  return envelope(REQUEST_IDS.total, periodVariables(companyName(company), period),
    `<COLLECTION NAME="${REQUEST_IDS.total}" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>Name, OpeningBalance, ClosingBalance</FETCH>`
    + `<FILTER>ChausarTotalGroup</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="ChausarTotalGroup">$Name = "${GROUPS[register]}"</SYSTEM>`);
}
/** Ledger masters with their parent group, so the person can choose the register's ledgers. */
export function tallyLedgersRequestBody(company: string): string {
  return envelope(REQUEST_IDS.ledgers, `<SVCURRENTCOMPANY>${xmlEscape(companyName(company))}</SVCURRENTCOMPANY>`,
    `<COLLECTION NAME="${REQUEST_IDS.ledgers}" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name, Parent</FETCH></COLLECTION>`);
}
/** The companies open in Tally right now. Closed companies are not listed. */
export function tallyCompaniesRequestBody(): string {
  return envelope(REQUEST_IDS.companies, '', `<COLLECTION NAME="${REQUEST_IDS.companies}" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name, BooksFrom</FETCH></COLLECTION>`);
}
const post = (endpoint: string, body: string): ReadRequest => ({ method: 'POST', url: endpoint, headers: { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'application/xml, text/xml' }, body });

// ---------------------------------------------------------------- response parsing
const kids = (node: TallyXmlNode, ...names: string[]) => node.children.filter(child => names.includes(child.name));
function single(node: TallyXmlNode, name: string): TallyXmlNode | null {
  const found = kids(node, name); check(found.length <= 1, 'TALLY_XML_FIELD_AMBIGUOUS', 'A Tally field appears twice.'); return found[0] ?? null;
}
function field(node: TallyXmlNode, name: string): string | null {
  const found = single(node, name); if (!found) return null;
  check(found.children.length === 0, 'TALLY_XML_SCALAR_REQUIRED', 'A Tally field must be plain text.'); return found.text.trim();
}
function yesNo(node: TallyXmlNode, name: string): boolean | null {
  const value = field(node, name); if (value === null || value === '') return null;
  check(value === 'Yes' || value === 'No', 'TALLY_XML_LOGICAL_INVALID', 'A Tally Yes/No field holds something else.'); return value === 'Yes';
}
function hasNode(node: TallyXmlNode, name: string): boolean { return node.name === name || node.children.some(child => hasNode(child, name)); }
/** The collection's objects, after refusing DTDs (parser), LINEERROR and failed or foreign envelopes. */
export function tallyCollection(content: string, objectName: string): TallyXmlNode[] {
  const root = parseTallyXmlDocument(content);
  check(!hasNode(root, 'LINEERROR'), 'TALLY_SOURCE_ERROR', 'Tally reported an error for this request. Check the company name and that it is open.');
  check(root.name === 'ENVELOPE', 'TALLY_RESPONSE_UNSUPPORTED', 'Tally did not return an export envelope.');
  const header = single(root, 'HEADER');
  if (header) { const status = field(header, 'STATUS'); check(status === null || status === '1', 'TALLY_SOURCE_ERROR', 'Tally reported an error for this request. Check the company name and that it is open.'); }
  const body = single(root, 'BODY'); check(body, 'TALLY_RESPONSE_UNSUPPORTED', 'Tally did not return an export envelope.');
  const data = single(body!, 'DATA'); check(data && !data.text.trim(), 'TALLY_RESPONSE_UNSUPPORTED', 'Tally did not return an export envelope.');
  const collection = single(data!, 'COLLECTION'); check(collection, 'TALLY_RESPONSE_UNSUPPORTED', 'Tally did not return an export envelope.');
  check(collection!.children.every(child => child.name === objectName), 'TALLY_OBJECT_UNSUPPORTED', 'The export holds objects of another kind.');
  return collection!.children;
}
const DECIMAL = /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/;
function exactAmount(value: string | null, code: string): string {
  check(value !== null && DECIMAL.test(value), code, 'A Tally amount is missing or not a plain decimal (foreign-currency amounts are not supported).');
  return value!;
}
/** Exact decimal difference, by integer arithmetic on a common scale. */
function decimalDifference(a: string, b: string): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const scaled = (v: string) => { const negative = v.startsWith('-'), [whole, fraction = ''] = v.replace(/^-/, '').split('.'); const n = BigInt(whole + fraction.padEnd(scale, '0')); return negative ? -n : n; };
  const diff = scaled(a) - scaled(b), abs = (diff < 0n ? -diff : diff).toString().padStart(scale + 1, '0');
  return `${diff < 0n ? '-' : ''}${scale ? `${abs.slice(0, -scale)}.${abs.slice(-scale)}` : abs}`;
}
function voucherRecords(node: TallyXmlNode, config: TallyRegisterConfig, period: { from: string; to: string }): Record<string, string>[] {
  const date = field(node, 'DATE') ?? '', type = field(node, 'VOUCHERTYPENAME') ?? '', number = field(node, 'VOUCHERNUMBER') ?? '', masterId = field(node, 'MASTERID') ?? '';
  check(/^\d{8}$/.test(date), 'TALLY_DATE_UNSUPPORTED', 'A voucher date is not YYYYMMDD.');
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  check(iso >= period.from && iso <= period.to, 'TALLY_VOUCHER_OUTSIDE_PERIOD', 'Tally returned a voucher outside the chosen period.');
  check(masterId !== '' || number !== '', 'TALLY_VOUCHER_IDENTITY_REQUIRED', 'A voucher has neither a master id nor a number.');
  const voucherId = masterId ? `master:${masterId}` : `${date}|${type}|${number}`;
  const state = yesNo(node, 'ISCANCELLED') ? 'cancelled' : yesNo(node, 'ISOPTIONAL') ? 'optional' : 'active';
  const base = { voucherId, voucherNumber: number, date, voucherType: type, party: field(node, 'PARTYLEDGERNAME') ?? '', currency: config.baseCurrency, state };
  if (state !== 'active') return [{ ...base, ledger: '', amount: '', side: '' }];
  check(!(kids(node, 'LEDGERENTRIES.LIST').length && kids(node, 'ALLLEDGERENTRIES.LIST').length), 'TALLY_REPRESENTATION_AMBIGUOUS', 'A voucher carries two alternative posting lists.');
  const direct = kids(node, 'LEDGERENTRIES.LIST', 'ALLLEDGERENTRIES.LIST');
  const allocations = kids(node, 'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST').flatMap(item => kids(item, 'ACCOUNTINGALLOCATIONS.LIST'));
  const directNames = new Set(direct.map(item => field(item, 'LEDGERNAME')));
  check(!allocations.some(item => directNames.has(field(item, 'LEDGERNAME'))), 'TALLY_REPRESENTATION_AMBIGUOUS', 'A ledger appears both as a posting and as an item allocation.');
  const wanted = new Set(config.ledgers), out: Record<string, string>[] = [];
  for (const posting of [...direct, ...allocations]) {
    const ledger = field(posting, 'LEDGERNAME') ?? '';
    if (!wanted.has(ledger)) continue;
    const amount = exactAmount(field(posting, 'AMOUNT'), 'TALLY_AMOUNT_UNSUPPORTED'), debitFlag = yesNo(posting, 'ISDEEMEDPOSITIVE');
    const zero = /^-?0(?:\.0+)?$/.test(amount), negative = amount.startsWith('-') && !zero;
    if (debitFlag !== null && !zero) check(debitFlag === negative, 'TALLY_SIGN_CONTRADICTION', 'A Tally entry\'s debit flag and amount sign disagree.');
    const side = debitFlag !== null ? (debitFlag ? 'debit' : 'credit') : negative ? 'debit' : 'credit';
    out.push({ ...base, ledger, amount, side });
  }
  return out;
}

const isRequest = (request: ReadRequest, id: string) => (request.body ?? '').includes(`<ID>${id}</ID>`);
/** Register read: the vouchers, then (unless declareTotal is false) the group movement as the declared total. */
export function tallyRegisterSpec(register: TallyRegister): ApiReadSpec<TallyRegisterConfig> {
  return Object.freeze({
    system: 'tally', operation: `${register}-register`, version: '1', scopes: Object.freeze([]), auth: 'none',
    origins: config => [new URL(tallyRegisterEndpoint(config.endpoint)).origin],
    validate(config: TallyRegisterConfig) {
      strictConfig(config, ['endpoint', 'company', 'baseCurrency', 'ledgers', 'declareTotal'], ['company', 'baseCurrency', 'ledgers']);
      tallyRegisterEndpoint(config.endpoint); companyName(config.company);
      check(typeof config.baseCurrency === 'string' && /^[A-Z]{3}$/.test(config.baseCurrency), 'CONFIG_INVALID', 'State the company\'s base currency as a three-letter ISO code.');
      check(Array.isArray(config.ledgers) && config.ledgers.length > 0 && config.ledgers.length <= 200 && config.ledgers.every(ledgerName) && new Set(config.ledgers).size === config.ledgers.length, 'CONFIG_INVALID', 'Choose the register\'s ledgers by their exact names.');
      check(config.declareTotal === undefined || typeof config.declareTotal === 'boolean', 'CONFIG_INVALID', 'The total read is on or off.');
      return config;
    },
    first(config, period) {
      const chosen = checkPeriod(period, true)!;
      return post(tallyRegisterEndpoint(config.endpoint), tallyRegisterRequestBody(register, config.company, chosen));
    },
    parse(body, _response, config, request): ParsedPage {
      const period = periodOf(request);
      if (isRequest(request, REQUEST_IDS.total)) {
        const groups = tallyCollection(body, 'GROUP');
        check(groups.length === 1 && (field(groups[0], 'NAME') ?? groups[0].attributes.NAME) === GROUPS[register], 'TALLY_GROUP_TOTAL_UNAVAILABLE', 'Tally did not return the register\'s group total.');
        const opening = exactAmount(field(groups[0], 'OPENINGBALANCE'), 'TALLY_GROUP_BALANCE_MISSING'), closing = exactAmount(field(groups[0], 'CLOSINGBALANCE'), 'TALLY_GROUP_BALANCE_MISSING');
        // Credits are positive in Tally XML: sales movement is closing minus opening; purchases are debits.
        const movement = register === 'sales' ? decimalDifference(closing, opening) : decimalDifference(opening, closing);
        return { records: [], next: null, declared: { amount: movement, amountUnit: 'major', reference: `tally-${GROUPS[register].toLowerCase().replace(' ', '-')}-movement` } };
      }
      check(isRequest(request, REQUEST_IDS[register]), 'TALLY_REQUEST_UNKNOWN', 'The response does not answer a register request.');
      const records = tallyCollection(body, 'VOUCHER').flatMap(node => voucherRecords(node, config, period));
      const next = config.declareTotal === false || records.length === 0 ? null : post(request.url, tallyRegisterTotalRequestBody(register, config.company, period));
      return { records, next };
    },
  });
}
function periodOf(request: ReadRequest): { from: string; to: string } {
  const from = /<SVFROMDATE TYPE="Date">(\d{8})<\/SVFROMDATE>/.exec(request.body ?? ''), to = /<SVTODATE TYPE="Date">(\d{8})<\/SVTODATE>/.exec(request.body ?? '');
  check(from && to, 'TALLY_REQUEST_UNKNOWN', 'The response does not answer a register request.');
  const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return { from: iso(from![1]), to: iso(to![1]) };
}
export const tallySalesRegisterSpec = tallyRegisterSpec('sales');
export const tallyPurchaseRegisterSpec = tallyRegisterSpec('purchase');

/** Standalone 'sales-register-total' / 'purchase-register-total': only the group movement, as declared. */
export function tallyRegisterTotalSpec(register: TallyRegister): ApiReadSpec<TallyRegisterConfig> {
  const inner = tallyRegisterSpec(register);
  return Object.freeze({ ...inner, operation: `${register}-register-total`,
    first(config, period) { return post(tallyRegisterEndpoint(config.endpoint), tallyRegisterTotalRequestBody(register, config.company, checkPeriod(period, true)!)); } });
}

/** Ledger masters: { name, parent }. Setup data for choosing the register's ledgers; no recipe. */
export const tallyLedgersSpec: ApiReadSpec<TallyLedgersConfig> = Object.freeze({
  system: 'tally', operation: 'ledgers', version: '1', scopes: Object.freeze([]), auth: 'none',
  origins: config => [new URL(tallyRegisterEndpoint(config.endpoint)).origin],
  validate(config: TallyLedgersConfig) { strictConfig(config, ['endpoint', 'company'], ['company']); tallyRegisterEndpoint(config.endpoint); companyName(config.company); return config; },
  first: config => post(tallyRegisterEndpoint(config.endpoint), tallyLedgersRequestBody(config.company)),
  parse(body): ParsedPage {
    const records = tallyCollection(body, 'LEDGER').map(node => {
      const name = field(node, 'NAME') ?? node.attributes.NAME ?? '';
      check(ledgerName(name), 'TALLY_LEDGER_NAME_REQUIRED', 'A ledger has no name.');
      return { name, parent: field(node, 'PARENT') ?? '' };
    });
    return { records, next: null };
  },
});
/** 'list-companies': the companies open in Tally, { name, booksFrom }. */
export const tallyCompaniesSpec: ApiReadSpec<TallyEndpointConfig> = Object.freeze({
  system: 'tally', operation: 'list-companies', version: '1', scopes: Object.freeze([]), auth: 'none',
  origins: config => [new URL(tallyRegisterEndpoint(config.endpoint)).origin],
  validate(config: TallyEndpointConfig) { strictConfig(config, ['endpoint']); tallyRegisterEndpoint(config.endpoint); return config; },
  first: config => post(tallyRegisterEndpoint(config.endpoint), tallyCompaniesRequestBody()),
  parse(body): ParsedPage {
    const records = tallyCollection(body, 'COMPANY').map(node => {
      const name = field(node, 'NAME') ?? node.attributes.NAME ?? '';
      check(ledgerName(name), 'COMPANY_REQUIRED', 'A company has no name.');
      return { name, booksFrom: field(node, 'BOOKSFROM') ?? '' };
    });
    return { records, next: null };
  },
});
