import { appendLearningDecision } from './learning.ts';
import type { DecisionInput, ImportDecisionIdentity } from './learning.ts';
import { authorize, audit, check, hash, newId, now, type Context, type StateStore } from './contracts.ts';
import { currentAccess, insertFacts, validDate, type FactInput } from './memory.ts';
import { OntologyService } from './ontology.ts';
import { isNoResend } from './trust.ts';
import { currencyMinorDigits, decimalMinor } from './currency.ts';

export type ImportFormat = 'csv' | 'tally-xml' | 'zoho-json' | 'gst-json' | 'bank-csv' | 'shopify-json' | 'xlsx';
export type Binding = { target: string; source?: string; constant?: string; type: 'string' | 'money' | 'date' | 'integer' | 'boolean'; nulls: 'reject' | 'omit' | 'zero'; values?: Record<string, string>; dateFormat?: 'ISO' | 'DMY' | 'YMD8'; moneyUnit?: 'major' | 'minor'; currency?: string; fx?: { numerator: string; denominator: string; rounding: 'exact' | 'half-up' } };
export type MappingRecipe = { version: 1; id: string; system: string; edition: string; scope: { company: string; branches: string[]; gstin?: string }; bindings: Binding[]; allowedKinds: string[]; allowedStatuses: string[]; onUnmapped: 'report' | 'reject'; ignoredFields?: string[]; tallyLedgerClasses?: Record<string, 'sales' | 'purchase' | 'bank' | 'tax' | 'other'>; bankLayout?: { idField: string; dateField: string; descriptionField: string; debitField: string; creditField: string; balanceField: string; dateFormat: 'ISO' | 'DMY' | 'YMD8'; openingMinor: string; closingMinor: string; currency: string } };
export type ImportInput = { sourceId: string; format: ImportFormat; content: string; recipe?: MappingRecipe; expectedTotals?: { rowCount: number; amountMinor: string }; installation?: { company: string; edition: string; gstin?: string } };
/** Encrypted State custody, not part of source-list or commit RPC results. */
export function importPublicRecord(record: any): any { const { retainedInput: ignored, ...publicRecord } = structuredClone(record); return publicRecord; }
export type ImportPreview = { accepted: boolean; errors: { row: number; code: string; message: string }[]; unmappedFields: string[]; facts: FactInput[]; totalsMinor: string; coverage: { sourceRows: number; importedRows: number; rejectedRows: number; expectedRows: number | null; reconciled: boolean }; sourceId: string; contentHash: string; recipeHash: string; format: ImportFormat; qualification: 'experimental'; question: string | null };

export function parseCsv(text: string): Record<string, string>[] {
  check(typeof text === 'string' && text.length <= 20_000_000, 'FILE_LIMIT', 'Import a CSV smaller than twenty megabytes.');
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, afterQuote = false;
  const endCell = () => { row.push(cell); cell = ''; afterQuote = false; };
  const endRow = () => { endCell(); if (row.some(c => c.length)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } } else cell += c; continue; }
    if (afterQuote && c !== ',' && c !== '\n' && c !== '\r') check(false, 'INVALID_CSV', 'Unexpected text after a quoted cell.');
    if (c === '"') { check(cell.length === 0 && !afterQuote, 'INVALID_CSV', 'Quotes must begin a cell.'); quoted = true; }
    else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cell += c;
  }
  check(!quoted, 'TRUNCATED_CSV', 'A quoted CSV cell was cut short.');
  if (cell.length || row.length || afterQuote) endRow();
  check(rows.length >= 1 && rows[0].length > 0, 'EMPTY_FILE', 'The CSV needs a header row.');
  const headers = rows.shift()!.map(h => h.trim());
  check(headers.every(h => h && !['__proto__', 'prototype', 'constructor'].includes(h)) && new Set(headers).size === headers.length, 'INVALID_HEADERS', 'CSV headers must be nonempty, unique data names.');
  return rows.map((r, index) => { check(r.length === headers.length, 'CSV_WIDTH', `CSV row ${index + 2} has a different column count.`); return Object.fromEntries(headers.map((h, i) => [h, r[i]])); });
}

export function parseIndianMoney(input: unknown, unit: 'major' | 'minor' = 'major', currency = 'INR'): string {
  check(typeof input === 'string' || (typeof input === 'number' && Number.isSafeInteger(input)), 'INVALID_AMOUNT', 'Money values must be decimal text or safe integers.');
  currencyMinorDigits(currency);
  let text = String(input).trim().replace(new RegExp(`^(?:${currency}${currency === 'INR' ? '|Rs\\.?|\\u20b9' : ''})\\s*`, 'i'), '').replaceAll(',', '');
  let credit = false;
  if (/\s+(Dr|Cr)$/i.test(text)) { credit = /Cr$/i.test(text); text = text.replace(/\s+(Dr|Cr)$/i, ''); }
  const pieces = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(crore|lakh|lac|thousand)\b/gi)];
  if (pieces.length) {
    check(pieces.map(p => p[0]).join(' ').replace(/\s+/g, '') === text.replace(/\s+/g, ''), 'INVALID_AMOUNT', 'Use numeric crore, lakh and thousand amounts with no ambiguous words.');
    const multipliers: Record<string, bigint> = { crore: 10_000_000n, lakh: 100_000n, lac: 100_000n, thousand: 1_000n };
    const n = pieces.reduce((sum, p) => sum + BigInt(decimalMinor(p[1], currency)) * multipliers[p[2].toLowerCase()], 0n);
    return String(credit ? -n : n);
  }
  check(unit === 'major' || /^-?\d+$/.test(text), 'INVALID_AMOUNT', 'Minor units must be whole integers.');
  const n = unit === 'minor' ? BigInt(text) : BigInt(decimalMinor(text, currency));
  return String(credit ? -n : n);
}
export function parseBankCsv(content: string, recipe: MappingRecipe): Record<string, unknown>[] {
  const layout = recipe.bankLayout; check(layout, 'BANK_LAYOUT_REQUIRED', 'Choose the bank export columns and opening and closing balances.');
  check(Object.keys(layout).every(k => ['idField', 'dateField', 'descriptionField', 'debitField', 'creditField', 'balanceField', 'dateFormat', 'openingMinor', 'closingMinor', 'currency'].includes(k)) && /^-?\d+$/.test(layout.openingMinor) && /^-?\d+$/.test(layout.closingMinor), 'INVALID_BANK_LAYOUT', 'The bank layout needs exact source balances and named data fields.');
  let balance = BigInt(layout.openingMinor); const rows = parseCsv(content);
  const normalized = rows.map((row, index) => {
    const debit = row[layout.debitField] ? BigInt(parseIndianMoney(row[layout.debitField], 'major', layout.currency)) : 0n; const credit = row[layout.creditField] ? BigInt(parseIndianMoney(row[layout.creditField], 'major', layout.currency)) : 0n;
    check(debit >= 0n && credit >= 0n && (debit === 0n || credit === 0n), 'AMBIGUOUS_BANK_MOVEMENT', 'Every bank row must have one nonnegative debit or credit.');
    const movement = credit - debit; balance += movement;
    check(row[layout.balanceField] !== undefined && balance === BigInt(parseIndianMoney(row[layout.balanceField], 'major', layout.currency)), 'BANK_BALANCE_MISMATCH', `Bank row ${index + 2} does not reconcile to its running balance.`);
    check(row[layout.idField], 'BANK_ID_REQUIRED', 'Every bank transaction needs a stable source reference; row positions cannot deduplicate exports.');
    return { id: row[layout.idField], kind: 'bank', date: parseDate(row[layout.dateField], layout.dateFormat), amount: String(movement), currency: layout.currency, customerId: '', invoiceId: '', orderId: '', dueDate: '', status: 'settled', description: row[layout.descriptionField] ?? '', branch: recipe.scope.branches[0] };
  });
  check(balance === BigInt(layout.closingMinor), 'BANK_CLOSING_MISMATCH', 'This export does not reconcile to the bank statement closing balance. It may be incomplete.');
  return normalized;
}
function parseDate(value: unknown, format: Binding['dateFormat']) {
  check(typeof value === 'string', 'INVALID_DATE', 'Dates must be text with an explicit format.');
  let date = value;
  if (format === 'DMY') { const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value); check(m, 'INVALID_DATE', 'Expected a day-first date.'); date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (format === 'YMD8') { check(/^\d{8}$/.test(value), 'INVALID_DATE', 'Expected YYYYMMDD.'); date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; }
  check(validDate(date), 'INVALID_DATE', 'This calendar date does not exist.'); return date;
}

type XmlNode = { name: string; text: string; children: XmlNode[] };
function parseXml(text: string): XmlNode {
  check(text.length <= 20_000_000 && !/<!DOCTYPE|<!ENTITY/i.test(text), 'UNSAFE_XML', 'DTD and external entities are refused.');
  const root: XmlNode = { name: '#root', text: '', children: [] }; const stack = [root]; let cursor = 0;
  const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[c]!));
  for (const m of text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g)) {
    stack.at(-1)!.text += decode(text.slice(cursor, m.index)); cursor = m.index! + m[0].length;
    const token = m[0]; if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { stack.at(-1)!.text += token.slice(9, -3); continue; }
    if (token.startsWith('</')) { const name = token.slice(2, -1).trim().toUpperCase(); check(stack.length > 1 && stack.at(-1)!.name === name, 'TRUNCATED_XML', 'XML tags do not close consistently.'); stack.pop(); continue; }
    const match = /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*)?\s*\/?\s*>$/.exec(token); check(match, 'INVALID_XML', 'Invalid XML element.');
    const node: XmlNode = { name: match[1].toUpperCase(), text: '', children: [] }; stack.at(-1)!.children.push(node);
    if (!token.endsWith('/>')) { stack.push(node); check(stack.length < 64, 'XML_DEPTH', 'XML nesting limit exceeded.'); }
  }
  stack.at(-1)!.text += decode(text.slice(cursor)); check(stack.length === 1 && root.children.length === 1, 'TRUNCATED_XML', 'The XML document was cut short or has multiple roots.'); return root;
}
function descendants(node: XmlNode, name: string): XmlNode[] { return node.children.flatMap(c => [...(c.name === name ? [c] : []), ...descendants(c, name)]); }
function childText(node: XmlNode, name: string) { return node.children.find(c => c.name === name)?.text.trim() ?? ''; }
export function parseTallyXml(text: string, recipe: MappingRecipe): Record<string, string>[] {
  const tree = parseXml(text); const vouchers = descendants(tree, 'VOUCHER');
  check(vouchers.length > 0, 'EMPTY_TALLY_EXPORT', 'No vouchers were found in the Tally export.');
  check(recipe.tallyLedgerClasses && Object.keys(recipe.tallyLedgerClasses).length > 0, 'UNCLASSIFIED_ACCOUNTS', 'Classify the Tally ledger accounts before importing financial totals.');
  return vouchers.map((v, index) => {
    const type = childText(v, 'VOUCHERTYPENAME'); const kinds: Record<string, string> = { Sales: 'invoice', Purchase: 'purchase', Receipt: 'payment', 'Credit Note': 'refund' }; const kind = kinds[type];
    check(kind, 'UNKNOWN_VOUCHER_TYPE', `Voucher ${index + 1} has an unsupported type. Export one known register at a time.`);
    const entries = [...v.children.filter(c => c.name === 'ALLLEDGERENTRIES.LIST' || c.name === 'LEDGERENTRIES.LIST')];
    check(entries.length > 0, 'MISSING_LEDGERS', 'A voucher without ledger entries cannot be reconciled.');
    let amount = 0n, tax = 0n;
    for (const entry of entries) {
      const ledger = childText(entry, 'LEDGERNAME'); const classification = recipe.tallyLedgerClasses![ledger];
      check(classification, 'UNCLASSIFIED_ACCOUNT', `Classify ledger ${ledger} before accepting the export.`);
      const value = BigInt(parseIndianMoney(childText(entry, 'AMOUNT'))); const abs = value < 0n ? -value : value;
      if (classification === 'tax') tax += abs;
      if ((kind === 'payment' && classification === 'bank') || (kind === 'purchase' && classification === 'purchase') || ((kind === 'invoice' || kind === 'refund') && classification === 'sales')) amount += abs;
    }
    check(amount > 0n, 'MISSING_REGISTER_VALUE', 'A classified register value is required; a party balance is not treated as revenue.');
    return { id: childText(v, 'GUID') || childText(v, 'MASTERID') || childText(v, 'VOUCHERNUMBER'), kind, date: childText(v, 'DATE'), amount: String(amount), tax: String(tax), currency: 'INR', customerId: childText(v, 'PARTYLEDGERNAME'), invoiceId: childText(v, 'VOUCHERNUMBER'), orderId: '', dueDate: '', status: childText(v, 'ISCANCELLED') === 'Yes' ? 'cancelled' : 'settled', description: childText(v, 'NARRATION'), branch: recipe.scope.branches[0] ?? 'main' };
  });
}
function safeJson(content: string): any {
  check(content.length <= 20_000_000, 'FILE_LIMIT', 'Export size limit exceeded.');
  // Preserve JSON number lexemes before JSON.parse can round decimal amounts or long ids.
  let preserved = '', inString = false, escaped = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inString) { preserved += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; preserved += c; continue; }
    if (c === '-' || /\d/.test(c)) { const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(content.slice(i)); check(m, 'INVALID_JSON_NUMBER', 'The JSON export contains an invalid numeric token.'); preserved += JSON.stringify(m[0]); i += m[0].length - 1; }
    else preserved += c;
  }
  const data = JSON.parse(preserved); const visit = (obj: any, depth = 0) => { check(depth < 32, 'JSON_DEPTH', 'JSON nesting limit exceeded.'); if (obj && typeof obj === 'object') for (const [key, value] of Object.entries(obj)) { check(!['__proto__', 'prototype', 'constructor'].includes(key), 'UNSAFE_JSON', 'Reserved object keys are refused.'); visit(value, depth + 1); } }; visit(data); return data;
}
export function parseZohoJson(content: string): Record<string, unknown>[] {
  const data = safeJson(content);
  check(data.page_context?.has_more_page !== true && data.complete !== false, 'INCOMPLETE_EXPORT', 'The Zoho export has more pages. Fetch all pages and report totals first.');
  const invoices = data.invoices ?? (Array.isArray(data) ? data : null); check(Array.isArray(invoices), 'INVALID_ZOHO_EXPORT', 'Expected a complete Zoho invoice export.');
  return invoices.map((r: any) => {
    check(r.invoice_id && r.date && (r.sub_total !== undefined || r.subtotal !== undefined), 'MISSING_ZOHO_NET', 'Zoho needs invoice id, date and subtotal; gross totals cannot substitute for net revenue.');
    check(typeof r.currency_code === 'string' && /^[A-Z]{3}$/.test(r.currency_code), 'MISSING_ZOHO_CURRENCY', 'Every Zoho invoice needs its explicit three-letter currency code.');
    return { id: String(r.invoice_id), kind: 'invoice', date: r.date, amount: r.sub_total ?? r.subtotal, currency: r.currency_code, customerId: String(r.customer_id ?? ''), invoiceId: String(r.invoice_id), orderId: String(r.reference_number ?? ''), dueDate: r.due_date ?? '', status: r.status ?? '', description: r.notes ?? '', branch: String(r.branch_id ?? 'main') };
  });
}
export function parseShopifyJson(content: string): Record<string, unknown>[] {
  const data = safeJson(content); check(data.complete !== false && !data.next_page, 'INCOMPLETE_EXPORT', 'Fetch all Shopify pages and report totals first.');
  const orders = data.orders ?? (Array.isArray(data) ? data : null); check(Array.isArray(orders), 'INVALID_SHOPIFY_EXPORT', 'Expected a complete Shopify order export.');
  return orders.map((r: any) => {
    check(r && typeof r === 'object' && !Array.isArray(r) && (!Object.hasOwn(r, '__typename') || ['Order', 'DraftOrder'].includes(r.__typename)), 'SHOPIFY_OBJECT_PROFILE_REQUIRED', 'The order profile cannot interpret other or ambiguous Shopify object types.');
    for (const identity of [r.id, r.admin_graphql_api_id]) check(typeof identity !== 'string' || !identity.startsWith('gid://') || /^gid:\/\/shopify\/(?:Order|DraftOrder)\/[^/]+$/.test(identity), 'SHOPIFY_OBJECT_PROFILE_REQUIRED', 'Shopify global identifiers must identify Order or DraftOrder objects for this profile.');
    check(!Object.hasOwn(r, 'draft') || typeof r.draft === 'boolean', 'SHOPIFY_SOURCE_STATE_REQUIRED', 'An explicit draft flag must be boolean; ambiguous source state cannot become a billed claim.');
    check(r.id && r.processed_at && r.subtotal_price !== undefined && typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) && (!r.presentment_currency || r.presentment_currency === r.currency), 'AMBIGUOUS_SHOPIFY_EXPORT', 'Orders need original subtotal and a single explicit currency.');
    check(!Object.hasOwn(r, 'refunds') || (Array.isArray(r.refunds) && r.refunds.length === 0), 'SHOPIFY_REFUND_PROFILE_REQUIRED', 'Embedded refunds require a separate reviewed transaction profile; an original order total cannot establish net revenue or refunded money.');
    check(['taxes_included', 'taxesIncluded'].some(taxFlag => Object.hasOwn(r, taxFlag)), 'SHOPIFY_TAX_PROFILE_REQUIRED', 'Shopify subtotals require an explicit source tax mode before importing tax-exclusive billed amounts.');
    for (const taxFlag of ['taxes_included', 'taxesIncluded']) check(!Object.hasOwn(r, taxFlag) || r[taxFlag] === false, 'SHOPIFY_TAX_PROFILE_REQUIRED', 'Tax-inclusive or ambiguous Shopify subtotals require a reviewed tax allocation before importing tax-exclusive billed amounts.');
    const draft = r.__typename === 'DraftOrder' || r.draft === true || [r.id, r.admin_graphql_api_id].some(value => typeof value === 'string' && value.startsWith('gid://shopify/DraftOrder/'));
    return { id: String(r.id), kind: 'invoice', date: String(r.processed_at).slice(0, 10), amount: r.subtotal_price, currency: r.currency, customerId: String(r.customer?.id ?? 'guest'), invoiceId: String(r.id), orderId: String(r.id), dueDate: '', status: draft ? 'draft' : r.cancelled_at ? 'cancelled' : String(r.financial_status ?? ''), description: String(r.note ?? ''), branch: String(r.location_id ?? 'main') };
  });
}
export function parseGstJson(content: string): Record<string, unknown>[] {
  const data = safeJson(content); const b2b = data.data?.docdata?.b2b ?? data.docdata?.b2b ?? data.b2b; check(Array.isArray(b2b), 'INVALID_GST_EXPORT', 'Expected the downloaded GSTR-2B B2B invoice section.');
  return b2b.flatMap((supplier: any) => (supplier.inv ?? []).map((inv: any) => { const values = inv.items ?? inv.itms; check(inv.inum && inv.idt && Array.isArray(values), 'INVALID_GST_INVOICE', 'GST invoices need number, date and taxable line items.'); const amount = values.reduce((sum: bigint, line: any) => { const details = line.itm_det ?? line; check(details.txval !== undefined, 'GST_TAXABLE_MISSING', 'Every GST line needs taxable value.'); return sum + BigInt(parseIndianMoney(details.txval)); }, 0n); return { id: `${supplier.ctin}:${inv.inum}`, kind: 'purchase', date: inv.idt.replaceAll('-', '/'), amount: String(amount), currency: 'INR', customerId: supplier.ctin, invoiceId: inv.inum, orderId: '', dueDate: '', status: 'settled', description: supplier.trdnm ?? '', branch: 'main' }; }));
}
export const demoRecipe: MappingRecipe = {
  version: 1, id: 'chausar-canonical-v1', system: 'canonical-export', edition: '1', scope: { company: 'Demo Shop', branches: ['main', 'west'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' }, { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' }, { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(target => ({ target, source: target, type: 'string' as const, nulls: 'omit' as const })), { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ], allowedKinds: ['invoice', 'payment', 'sale', 'refund', 'cost', 'purchase', 'bank'], allowedStatuses: ['settled', 'delivered', 'paid', 'unpaid', 'draft', 'cancelled', 'bounced', 'void', 'open', 'overdue', 'partially_paid', 'pending', 'authorized', 'refunded', 'partially_refunded', 'sent', 'viewed', ''], onUnmapped: 'report',
};
export const demoCsv = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch
inv-1,invoice,2026-09-03,1000.00,INR,cust-1,inv-1,order-1,2026-09-10,unpaid,September order,main
sale-1,sale,2026-09-04,1000.00,INR,cust-1,inv-1,order-1,,delivered,Goods delivered,main
pay-1,payment,2026-09-05,600.00,INR,cust-1,inv-1,order-1,,settled,Partial payment,main
cost-1,cost,2026-09-04,400.00,INR,cust-1,inv-1,order-1,,settled,Goods and shipping cost,main
refund-1,refund,2026-09-08,100.00,INR,cust-1,inv-1,order-1,,settled,Credit note,main
inv-2,invoice,2026-09-12,2000.00,INR,cust-2,inv-2,order-2,2026-09-20,paid,Second order,west
sale-2,sale,2026-09-14,1500.00,INR,cust-2,inv-2,order-2,,delivered,Only part delivered,west
pay-2,payment,2026-09-13,2000.00,INR,cust-2,inv-2,order-2,,settled,Full payment,west
cost-2,cost,2026-09-14,700.00,INR,cust-2,inv-2,order-2,,settled,Goods and fees,west
sale-aug,sale,2026-08-20,3000.00,INR,cust-1,inv-aug,order-aug,,delivered,August comparison,main
`;
export function defaultRecipe(format: ImportFormat = 'csv'): MappingRecipe {
  const recipe = structuredClone(demoRecipe);
  if (format === 'tally-xml') { recipe.system = 'tally-export'; recipe.id = 'tally-voucher-v1'; recipe.bindings.find(b => b.target === 'validFrom')!.dateFormat = 'YMD8'; recipe.bindings.find(b => b.target === 'amountMinor')!.moneyUnit = 'minor'; recipe.bindings.push({ target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'zero' }); }
  if (format === 'gst-json') { recipe.system = 'gst-2b-export'; recipe.id = 'gst-2b-v1'; recipe.bindings.find(b => b.target === 'validFrom')!.dateFormat = 'DMY'; recipe.bindings.find(b => b.target === 'amountMinor')!.moneyUnit = 'minor'; }
  if (format === 'bank-csv') { recipe.system = 'bank-export'; recipe.id = 'bank-movements-v1'; recipe.bindings.find(b => b.target === 'amountMinor')!.moneyUnit = 'minor'; }
  if (format === 'zoho-json') { recipe.system = 'zoho-books-export'; recipe.id = 'zoho-invoices-v1'; }
  if (format === 'shopify-json') { recipe.system = 'shopify-export'; recipe.id = 'shopify-orders-v1'; }
  return recipe;
}

function validateRecipe(recipe: MappingRecipe, store: StateStore, ctx: Context) {
  check(recipe && recipe.version === 1 && /^[a-zA-Z0-9_.-]+$/.test(recipe.id), 'INVALID_RECIPE', 'Use a version one data recipe with an identifier.');
  check(Object.keys(recipe).every(k => ['version', 'id', 'system', 'edition', 'scope', 'bindings', 'allowedKinds', 'allowedStatuses', 'onUnmapped', 'ignoredFields', 'tallyLedgerClasses', 'bankLayout'].includes(k)), 'RECIPE_CODE_FORBIDDEN', 'Recipes may only contain published mapping data.');
  check(recipe.scope?.company && Array.isArray(recipe.scope.branches) && recipe.scope.branches.length, 'MISSING_SCOPE', 'A recipe must name its company and branches.');
  for (const branch of recipe.scope.branches) currentAccess(store, ctx, branch);
  const dictionary = new OntologyService(store).current(ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business meanings before importing.');
  const targets = new Set<string>();
  for (const binding of recipe.bindings) {
    check(Object.keys(binding).every(k => ['target', 'source', 'constant', 'type', 'nulls', 'values', 'dateFormat', 'moneyUnit', 'currency', 'fx'].includes(k)), 'RECIPE_CODE_FORBIDDEN', 'Mapping bindings are typed data, never expressions or programs.');
    check(!targets.has(binding.target) && (['entityId', 'kind', 'validFrom', 'validTo', 'branch'].includes(binding.target) || dictionary.fields[binding.target]), 'UNKNOWN_BINDING', 'Bind unique, published dictionary fields only.'); targets.add(binding.target);
    check((typeof binding.source === 'string') !== (binding.constant !== undefined), 'AMBIGUOUS_BINDING', 'Use one source field or one constant per binding.');
    check(['string', 'money', 'date', 'integer', 'boolean'].includes(binding.type) && ['reject', 'omit', 'zero'].includes(binding.nulls), 'INVALID_BINDING', 'Bindings need supported types and null handling.');
    if (dictionary.fields[binding.target]) check(dictionary.fields[binding.target] === binding.type, 'BINDING_TYPE_MISMATCH', 'The mapping type must match the published dictionary.');
    if (['entityId', 'kind', 'branch'].includes(binding.target)) check(binding.type === 'string', 'BINDING_TYPE_MISMATCH', 'Identity and scope bindings must be text.');
    if (['validFrom', 'validTo'].includes(binding.target)) check(binding.type === 'date', 'BINDING_TYPE_MISMATCH', 'Business date bindings must be typed dates.');
    if (binding.type === 'date') check(['ISO', 'DMY', 'YMD8'].includes(binding.dateFormat ?? ''), 'AMBIGUOUS_DATE', 'Every date binding needs an explicit date format.');
    if (binding.type === 'money') { check(['major','minor'].includes(binding.moneyUnit ?? '') && binding.currency && /^[A-Z]{3}$/.test(binding.currency), 'AMBIGUOUS_MONEY', 'Every amount binding needs explicit units and currency.'); currencyMinorDigits(binding.currency); }
    if (binding.fx) check(/^\d+$/.test(binding.fx.numerator) && BigInt(binding.fx.numerator) > 0n && /^\d+$/.test(binding.fx.denominator) && BigInt(binding.fx.denominator) > 0n && ['exact', 'half-up'].includes(binding.fx.rounding), 'INVALID_EXCHANGE_RATE', 'Exchange rates need exact positive numerator, denominator and rounding.');
  }
  check(['entityId', 'kind', 'validFrom', 'amountMinor', 'currency'].every(t => targets.has(t)), 'MISSING_BINDING', 'Bind record identity, kind, date, amount and currency.');
  check(Array.isArray(recipe.allowedKinds) && recipe.allowedKinds.length && Array.isArray(recipe.allowedStatuses) && ['report', 'reject'].includes(recipe.onUnmapped), 'MISSING_ASSERTIONS', 'A recipe needs known kinds, statuses and a policy for unknown columns.');
}
function transform(value: unknown, b: Binding, targetCurrency: string): unknown {
  if (value === undefined || value === null || value === '') { if (b.nulls === 'omit') return undefined; if (b.nulls === 'zero' && ['money', 'integer'].includes(b.type)) return b.type === 'money' ? '0' : 0; check(false, 'MISSING_VALUE', `A required ${b.target} is missing.`); }
  if (b.values) { check(Object.hasOwn(b.values, String(value)), 'UNKNOWN_VALUE', `An unknown ${b.target} needs your mapping decision.`); value = b.values[String(value)]; }
  if (b.type === 'string') { check(['string', 'number', 'boolean'].includes(typeof value), 'INVALID_TEXT', 'Object values cannot become text bindings.'); return String(value); }
  if (b.type === 'date') return parseDate(value, b.dateFormat);
  if (b.type === 'integer') { check(/^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)), 'INVALID_INTEGER', 'An integer binding must be exact.'); return Number(value); }
  if (b.type === 'boolean') { check([true, false, 'true', 'false'].includes(value as any), 'INVALID_BOOLEAN', 'Use true or false.'); return value === true || value === 'true'; }
  let amount = BigInt(parseIndianMoney(value, b.moneyUnit, b.currency));
  if (b.fx) { const numerator = amount * BigInt(b.fx.numerator) * 10n ** BigInt(currencyMinorDigits(targetCurrency)), denominator = BigInt(b.fx.denominator) * 10n ** BigInt(currencyMinorDigits(b.currency!)), remainder = numerator % denominator; check(b.fx.rounding !== 'exact' || remainder === 0n, 'FX_PRECISION', 'The exchange rate would lose fractional minor units.'); amount = numerator / denominator; if (b.fx.rounding === 'half-up' && (remainder < 0n ? -remainder : remainder) * 2n >= denominator) amount += numerator < 0n ? -1n : 1n; }
  return String(amount);
}

// Canonical target names describe structure; source headers/values never enter learning previews.
const learningFields: Record<string, string> = { invoiceId: 'invoice_id', customerId: 'customer_id', validFrom: 'date', dueDate: 'due_date', amountMinor: 'amount', taxMinor: 'tax', currency: 'currency', account: 'account', debit: 'debit', credit: 'credit', sku: 'sku', quantity: 'quantity', status: 'status', description: 'description', orderId: 'order_id', paymentId: 'payment_id', bankReference: 'bank_reference', branch: 'branch' };
function importDecision(input: ImportInput, choice: 'accepted' | 'rejected', codes: string[]): DecisionInput {
  const recipe = input.recipe ?? defaultRecipe(input.format);
  const reasonCode: DecisionInput['reasonCode'] = choice === 'accepted' || codes.some(code => /^SOURCE_(?:ROW_MISMATCH|TOTAL_MISMATCH|TOTALS_REQUIRED)$/.test(code)) ? 'reconciliation'
    : codes.includes('DUPLICATE_SOURCE_ROW') ? 'duplicate_record' : codes.includes('CURRENCY_MISMATCH') ? 'currency_mismatch'
    : codes.some(code => ['AMBIGUOUS_DATE', 'INVALID_DATE'].includes(code)) ? 'date_format'
    : codes.some(code => ['UNMAPPED_FIELDS', 'UNKNOWN_BINDING', 'AMBIGUOUS_BINDING'].includes(code)) ? 'ambiguous_field' : 'unsupported_shape';
  const fields: NonNullable<DecisionInput['fields']> = [];
  for (const binding of Array.isArray(recipe?.bindings) ? recipe.bindings.slice(0, 1000) : []) {
    const name = Object.hasOwn(learningFields, binding?.target) ? learningFields[binding.target] : undefined; const type = binding?.type === 'money' ? 'decimal' : binding?.type;
    if (name && ['string', 'integer', 'decimal', 'date', 'boolean'].includes(type)) fields.push({ name, type: type as NonNullable<DecisionInput['fields']>[number]['type'] });
  }
  return { kind: 'mapping', choice, reasonCode, fields, reportShape: input.format === 'bank-csv' ? 'bank-statement' : 'ledger', sourceIds: [input.sourceId] };
}
function importIdentity(input: ImportInput, id: string, contentHash: string, recipeHash: string, outcome: 'accepted' | 'rejected'): ImportDecisionIdentity {
  const recipe = input.recipe ?? defaultRecipe(input.format);
  return { id, sourceId: input.sourceId, branches: [...new Set(Array.isArray(recipe?.scope?.branches) ? recipe.scope.branches.filter(branch => typeof branch === 'string' && branch.length > 0) : [])].sort(),
    format: ['csv', 'tally-xml', 'zoho-json', 'gst-json', 'bank-csv', 'shopify-json', 'xlsx'].includes(input.format) ? input.format : 'unsupported', contentHash, recipeHash, outcome, qualification: 'experimental' };
}

export class ImportService {
  store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  preview(ctx: Context, input: ImportInput): ImportPreview {
    authorize(this.store, ctx, 'prepare'); currentAccess(this.store, ctx, undefined, input.sourceId);
    check(!isNoResend(this.store.read(), hash(input.content)), 'SOURCE_DELETED', 'This file was previously deleted. Its content cannot be imported under another source name.');
    const recipe = input.recipe ?? defaultRecipe(input.format); validateRecipe(recipe, this.store, ctx);
    const dictionary = new OntologyService(this.store).current(ctx)!;
    if (input.installation) check(input.installation.company === recipe.scope.company && input.installation.edition === recipe.edition && (!recipe.scope.gstin || input.installation.gstin === recipe.scope.gstin), 'INSTALLATION_MISMATCH', 'This installation does not match the recipe company, edition or GST registration.');
    check(input.format !== 'xlsx', 'EXCEL_ADAPTER_REQUIRED', 'Excel needs the optional isolated XLSX adapter. Export CSV or use previewWorkbook with an installed parser.');
    let rows: Record<string, unknown>[];
    if (input.format === 'csv') rows = parseCsv(input.content);
    else if (input.format === 'bank-csv') rows = parseBankCsv(input.content, recipe);
    else if (input.format === 'tally-xml') rows = parseTallyXml(input.content, recipe);
    else if (input.format === 'zoho-json') rows = parseZohoJson(input.content);
    else if (input.format === 'shopify-json') rows = parseShopifyJson(input.content);
    else if (input.format === 'gst-json') rows = parseGstJson(input.content);
    else check(false, 'UNSUPPORTED_FORMAT', 'This source format is not implemented.');
    const errors: ImportPreview['errors'] = []; const facts: FactInput[] = [];
    const mapped = new Set(recipe.bindings.map(b => b.source).filter(Boolean)); const unmappedFields = [...new Set(rows.flatMap(row => Object.keys(row)).filter(key => !mapped.has(key) && !recipe.ignoredFields?.includes(key)))];
    if (unmappedFields.length && recipe.onUnmapped === 'reject') errors.push({ row: 0, code: 'UNMAPPED_FIELDS', message: 'New fields need an explicit mapping or ignore decision.' });
    const identities = new Set<string>();
    rows.forEach((row, index) => {
      try {
        for (const binding of recipe.bindings.filter(b => b.type === 'money')) check(binding.currency === dictionary.currency || !!binding.fx, 'CURRENCY_MISMATCH', 'Every money field needs the dictionary currency or an explicit exchange rate.');
        const converted = Object.fromEntries(recipe.bindings.map(b => [b.target, transform(b.constant ?? row[b.source!], b, dictionary.currency)]).filter(([, value]) => value !== undefined));
        if (input.format === 'shopify-json') {
          check(converted.kind === 'invoice', 'SHOPIFY_RECOGNITION_PROFILE_REQUIRED', 'Original Shopify orders can establish billed claims only; earned sales and received money require separate reviewed evidence profiles.');
          if (row.status === 'draft' || row.status === 'cancelled') check(converted.status === row.status, 'SHOPIFY_SOURCE_STATE_REQUIRED', 'Mapping recipes must preserve nonbillable Shopify draft and cancellation states.');
        }
        check(recipe.allowedKinds.includes(String(converted.kind)), 'UNKNOWN_KIND', 'This record kind is outside the recipe.');
        check(converted.status === undefined || recipe.allowedStatuses.includes(String(converted.status)), 'UNKNOWN_STATUS', 'This status needs a mapping decision before importing.');
        check(converted.amountMinor !== undefined && converted.amountMinor !== null, 'MISSING_MEASURE_VALUE', 'Every source row needs an explicit amount before its source total can be reconciled.');
        const branch = String(converted.branch ?? recipe.scope.branches[0]); check(recipe.scope.branches.includes(branch), 'OUTSIDE_SCOPE', 'The row belongs to a branch outside this recipe.'); currentAccess(this.store, ctx, branch, input.sourceId);
        check(!converted.company || converted.company === recipe.scope.company, 'OUTSIDE_COMPANY', 'This row belongs to another company.');
        check(!recipe.scope.gstin || !converted.gstin || converted.gstin === recipe.scope.gstin, 'OUTSIDE_GSTIN', 'This row belongs to another GST registration.');
        const amountBinding = recipe.bindings.find(b => b.target === 'amountMinor')!;
        check(converted.currency === amountBinding.currency, 'BINDING_CURRENCY_MISMATCH', 'The row currency differs from the amount binding; one recipe cannot silently mix currencies.');
        check(converted.currency === dictionary.currency || !!amountBinding.fx, 'CURRENCY_MISMATCH', 'Publish an explicit exchange rate; mixed currencies cannot be added.');
        const entityId = String(converted.entityId); const identity = `${converted.kind}:${entityId}`; check(!identities.has(identity), 'DUPLICATE_SOURCE_ROW', 'Two source rows have the same logical identity.'); identities.add(identity);
        const { entityId: _id, kind, validFrom, validTo, branch: _branch, ...fields } = converted; fields.currency = dictionary.currency; fields._sourceCurrency = converted.currency; fields._recipeHash = hash(recipe);
        if (recipe.bindings.find(b => b.target === 'amountMinor')?.fx) fields._fx = structuredClone(recipe.bindings.find(b => b.target === 'amountMinor')!.fx);
        facts.push({ entityId, kind: String(kind), validFrom: String(validFrom), validTo: validTo ? String(validTo) : null, sourceId: input.sourceId, sourceRow: index + 2, fields, branch });
      } catch (error) { const e = error as any; errors.push({ row: index + 2, code: e.code ?? 'INVALID_ROW', message: e.message }); }
    });
    const totalsMinor = String(facts.reduce((sum, f) => sum + BigInt(String(f.fields.amountMinor)), 0n));
    const expected = input.expectedTotals;
    if (!expected) errors.push({ row: 0, code: 'SOURCE_TOTALS_REQUIRED', message: 'Enter the source system report total and row count before accepting this import.' });
    else {
      check(Number.isInteger(expected.rowCount) && expected.rowCount >= 0 && /^-?\d+$/.test(expected.amountMinor), 'INVALID_SOURCE_TOTALS', 'Source totals need an exact minor-unit amount and row count.');
      if (expected.rowCount !== rows.length) errors.push({ row: 0, code: 'SOURCE_ROW_MISMATCH', message: `The source reports ${expected.rowCount} rows; the export contains ${rows.length}. It may be cut short.` });
      if (expected.amountMinor !== totalsMinor) errors.push({ row: 0, code: 'SOURCE_TOTAL_MISMATCH', message: 'The mapped total does not match the source report to the minor unit.' });
    }
    return { accepted: errors.length === 0, errors, unmappedFields, facts, totalsMinor, coverage: { sourceRows: rows.length, importedRows: facts.length, rejectedRows: rows.length - facts.length, expectedRows: expected?.rowCount ?? null, reconciled: errors.length === 0 }, sourceId: input.sourceId, contentHash: hash(input.content), recipeHash: hash(recipe), format: input.format, qualification: 'experimental', question: errors.length ? 'Confirm the first reported mapping or source-total issue before accepting this file.' : null };
  }
  async commit(ctx: Context, input: ImportInput) {
    ctx = { ...ctx }; input = structuredClone(input); authorize(this.store, ctx, 'prepare');
    check(input && typeof input.sourceId === 'string' && input.sourceId.length > 0 && typeof input.content === 'string', 'INVALID_IMPORT', 'An import needs its explicit source identifier and file content.');
    let preview: ImportPreview;
    try { preview = this.preview(ctx, input); }
    catch (error) {
      if (['ACCESS_REVOKED', 'FORBIDDEN', 'FORBIDDEN_BRANCH', 'SOURCE_REVOKED', 'SOURCE_DELETED'].includes((error as any)?.code)) throw error;
      // Only an admitted source/author can retain a refusal; denied or deleted input gains no new evidence.
      await this.refusal(ctx, input, [typeof (error as any)?.code === 'string' ? (error as any).code : 'UNSUPPORTED_SHAPE']);
      throw error;
    }
    if (!preview.accepted) {
      await this.refusal(ctx, input, preview.errors.map(e => e.code));
      check(false, 'IMPORT_REFUSED', preview.errors.map(e => `${e.code}: ${e.message}`).join(' '));
    }
    return this.store.update(state => {
      authorize(this.store, ctx, 'prepare'); for (const f of preview.facts) currentAccess(this.store, ctx, f.branch, f.sourceId);
      const prior = state.imports.find(i => i.contentHash === preview.contentHash && i.recipeHash === preview.recipeHash && i.sourceId === input.sourceId);
      if (prior) return { ...importPublicRecord(prior), duplicate: true };
      insertFacts(state, preview.facts, now());
      // A source export includes unchanged claims as well as newly appended versions.
      // Keep its complete lineage while preserving insertFacts' no-op deduplication.
      const latestByIdentity = new Map(state.facts.filter(f => f.sourceId === input.sourceId).map(f => [JSON.stringify([f.kind, f.entityId]), f] as const));
      const records = preview.facts.map(f => {
        const stored = latestByIdentity.get(JSON.stringify([f.kind, f.entityId]));
        check(stored, 'IMPORT_LINEAGE_INVALID', 'Every accepted source row must resolve to its stored claim.');
        return stored;
      });
      const retained = JSON.parse(JSON.stringify({ ...input, recipe: input.recipe ?? defaultRecipe(input.format) })) as ImportInput;
      const imported = { id: newId('import'), at: now(), sourceId: input.sourceId, format: input.format, recipeHash: preview.recipeHash, contentHash: preview.contentHash, rowIds: records.map(f => f.id), coverage: preview.coverage, totalsMinor: preview.totalsMinor, expectedTotals: input.expectedTotals, unmappedFields: preview.unmappedFields, qualification: 'experimental', retainedInput: { version: 1, generation: state.imports.filter(i => i.sourceId === input.sourceId && i.format).length + 1, input: retained, digest: hash(retained) } };
      state.imports.push(imported);
      appendLearningDecision(state, ctx, importDecision(input, 'accepted', []), { rowIds: imported.rowIds, importIdentity: importIdentity(input, imported.id, imported.contentHash, imported.recipeHash, 'accepted') });
      audit(state, 'source.imported', { importId: imported.id, sourceId: input.sourceId, rowCount: records.length }); return importPublicRecord(imported);
    });
  }
  private async refusal(ctx: Context, input: ImportInput, codes: string[]) {
    // A validation failure is recorded separately from the rejected import, which writes no facts/import row.
    // Authorization failure and deletion remain fail-closed even if they race a queued transaction.
    await this.store.update(state => {
      authorize(this.store, ctx, 'prepare'); currentAccess(this.store, ctx, undefined, input.sourceId);
      check(typeof input.content === 'string' && !isNoResend(state, hash(input.content)), 'SOURCE_DELETED', 'Deleted content cannot create new learning evidence.');
      const event = appendLearningDecision(state, ctx, importDecision(input, 'rejected', codes), { importIdentity: importIdentity(input, newId('importattempt'), hash(input.content), hash(input.recipe ?? defaultRecipe(input.format)), 'rejected') });
      audit(state, 'source.import-refused', { eventId: event.id, sourceId: input.sourceId, reasonCode: event.input.reasonCode });
    });
  }
  async previewWorkbook(ctx: Context, input: Omit<ImportInput, 'format' | 'content'> & { bytes: Uint8Array }) {
    authorize(this.store, ctx, 'prepare');
    const packageName = 'xlsx'; let adapter: any;
    try { adapter = await import(packageName); } catch { check(false, 'EXCEL_ADAPTER_REQUIRED', 'Install the optional XLSX parser in the isolated reader profile, or export CSV.'); }
    const workbook = adapter.read(input.bytes, { type: 'array', cellDates: false, cellFormula: false });
    check(workbook.SheetNames.length === 1, 'AMBIGUOUS_WORKBOOK', 'Import one explicitly selected sheet at a time.');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    check(!Object.values(sheet).some((cell: any) => cell && (cell.f || cell.l)), 'ACTIVE_WORKBOOK_REFUSED', 'Workbooks with formulas or external links need a values-only export.');
    const csv = adapter.utils.sheet_to_csv(sheet); return this.preview(ctx, { ...input, format: 'csv', content: csv });
  }
}
/** Calendar-only copy of the authored synthetic fixture. Ordinary seed callers
 * retain the fixed fixture; the guarded native preview selects its UTC month. */
export function demoCsvForMonth(month: string): string {
  check(typeof month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)
    && month >= '0001-01' && validDate(`${month}-01`), 'INVALID_REQUEST', 'Select a valid synthetic fixture calendar month.');
  const preceding = new Date(`${month}-01T00:00:00.000Z`);
  preceding.setUTCMonth(preceding.getUTCMonth() - 1);
  const precedingMonth = preceding.toISOString().slice(0, 7);
  return demoCsv.replace(/\b2026-(08|09)-(\d{2})\b/g,
    (_date, sourceMonth: string, day: string) => `${sourceMonth === '08' ? precedingMonth : month}-${day}`);
}
export async function seedDemo(store: StateStore, ctx: Context, month?: string) {
  check(store.read().workspace.demo, 'DEMO_ONLY', 'Synthetic demo fixtures can only be seeded in a labelled demo workspace.');
  const content = month === undefined ? demoCsv : demoCsvForMonth(month);
  const ontology = new OntologyService(store); if (!ontology.current(ctx)) await ontology.publish(ctx, 'ecommerce');
  return new ImportService(store).commit(ctx, { sourceId: 'demo-export', format: 'csv', content, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
}

export function matchGstPurchases(gst: FactInput[], purchases: FactInput[]) {
  const key = (f: FactInput) => `${String(f.fields.customerId).toUpperCase()}:${f.fields.invoiceId}:${f.validFrom}`;
  return gst.map(g => { const matches = purchases.filter(p => key(p) === key(g)); if (matches.length !== 1) return { gstEntityId: g.entityId, status: matches.length ? 'ambiguous' : 'missing', purchaseEntityIds: matches.map(p => p.entityId) }; return { gstEntityId: g.entityId, purchaseEntityIds: [matches[0].entityId], status: g.fields.amountMinor === matches[0].fields.amountMinor ? 'matched' : 'amount-mismatch' }; });
}
