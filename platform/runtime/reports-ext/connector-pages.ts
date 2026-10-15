/**
 * The three report pages built over the connector part (connectors-ext): GST turnover against the books,
 * the bank statement summary, and purchases against GSTR-2B. Which sources hold a GSTR-1, a GSTR-3B, a
 * GSTR-2B or a bank statement comes from `connectorsx.envelopes`; the match comes from `connectorsx.gstMatch`
 * and the months loaded from `connectorsx.freshness`, each called through `host.call` and checked here.
 *
 * Every figure on these pages opens a calculation receipt; nothing is added up here. The GSTR-1 and books lines
 * are registered calculations. Bank totals, GSTR-3B turnover and the GSTR-2B match come from core-data's receipts
 * (`coredata.bankTotals`, `coredata.gstr3bTurnover`, `coredata.gst2bReceipt`), called through `host.call` and
 * checked here. While core-data is not merged those methods are absent (UNKNOWN_METHOD or METHOD_UNAVAILABLE) and
 * the pages fall back to what they printed before: those lines are not counted, with a gap saying why.
 */
import { check, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { addDays, record, type EngineFigure, type Language, type Missing, type Period, type Words } from './common.ts';
import { reasons } from './packs.ts';
import type { Calculations, PageState, ReportSection } from './pages.ts';
import type { CalculationReceipt } from '../calculator.ts';

export type ConnectorPageId = 'gst-turnover' | 'bank-summary' | 'purchases-gstr2b';
export type ConnectorPage = { state: PageState; reason?: Words; sections: ReportSection[]; receipts: CalculationReceipt[] };

const w = (en: string, hi: string): Words => ({ en, hi });
const words = {
  connectorMissing: w('The connector part is not available, so the imported returns and statements cannot be listed.', 'कनेक्टर भाग उपलब्ध नहीं है, इसलिए आयात किए गए रिटर्न और विवरण सूचीबद्ध नहीं हो सकते।'),
  connectorRefused: w('The connector part refused to list the imported returns and statements.', 'कनेक्टर भाग ने आयात किए गए रिटर्न और विवरण सूचीबद्ध करने से मना किया।'),
  compare: w('Turnover in returns and in the books', 'रिटर्न में और खातों में टर्नओवर'),
  gstr1: w('Taxable value of invoices in GSTR-1', 'GSTR-1 में बिलों का कर योग्य मूल्य'),
  gstr3b: w('Turnover in GSTR-3B: taxable value of outward supplies (table 3.1)', 'GSTR-3B में टर्नओवर: बाहरी आपूर्ति का कर योग्य मूल्य (तालिका 3.1)'),
  books: w('Net sales in the books', 'खातों में शुद्ध बिक्री'),
  noGstr1: w('No GSTR-1 is imported yet.', 'अभी तक कोई GSTR-1 आयात नहीं हुआ है।'),
  noGstr3b: w('No GSTR-3B is imported yet.', 'अभी तक कोई GSTR-3B आयात नहीं हुआ है।'),
  gstr3bNotCounted: w('GSTR-3B is kept as the rows of the filed return, which no published calculation adds up, so its turnover is not counted here.', 'GSTR-3B दाखिल रिटर्न की पंक्तियों के रूप में रखा गया है, जिन्हें कोई प्रकाशित गणना नहीं जोड़ती, इसलिए इसका टर्नओवर यहाँ नहीं गिना गया।'),
  gstr1Notes: w('GSTR-1 credit and debit notes are not taken off the GSTR-1 line.', 'GSTR-1 के क्रेडिट और डेबिट नोट GSTR-1 पंक्ति से नहीं घटाए गए हैं।'),
  noBooks: w('No books are imported apart from the GST returns and bank statements.', 'GST रिटर्न और बैंक विवरण के अलावा कोई खाता आयात नहीं हुआ है।'),
  tooManySources: w('There are more than sixty-four sources, so this line is not counted.', 'साठ-चार से अधिक स्रोत हैं, इसलिए यह पंक्ति नहीं गिनी गई।'),
  bankTitle: w('Bank accounts in the period', 'अवधि में बैंक खाते'),
  credits: w('Money in (credits)', 'आई राशि (जमा)'),
  debits: w('Money out (debits)', 'गई राशि (नामे)'),
  opening: w('Opening balance', 'प्रारंभिक शेष'),
  closing: w('Closing balance', 'अंतिम शेष'),
  entries: w('Entries in the statements', 'विवरणों में प्रविष्टियाँ'),
  bankNotCounted: w('The bank connector checks each statement against its own balances, but these totals have no calculation receipt yet, so they are not counted here.', 'बैंक कनेक्टर हर विवरण को उसके अपने शेष से जाँचता है, पर इन योगों की अभी कोई गणना रसीद नहीं है, इसलिए ये यहाँ नहीं गिने गए।'),
  bankMonthsMissing: w('Some months of this period have no bank statement loaded.', 'इस अवधि के कुछ महीनों का कोई बैंक विवरण लोड नहीं हुआ है।'),
  bankMonthsRefused: w('A bank statement for some months of this period was refused by its checks.', 'इस अवधि के कुछ महीनों का बैंक विवरण उसकी जाँच में अस्वीकार हुआ।'),
  matchTitle: w('Purchase register against GSTR-2B', 'ख़रीद रजिस्टर बनाम GSTR-2B'),
  booksPurchases: w('Purchases in the books', 'खातों में ख़रीद'),
  twoBPurchases: w('Purchases in GSTR-2B', 'GSTR-2B में ख़रीद'),
  matchedLine: w('Invoices matched', 'मिलान हुए बिल'),
  mismatchLine: w('Invoices with a different amount', 'अलग राशि वाले बिल'),
  booksOnlyLine: w('Invoices in the books only', 'केवल खातों में बिल'),
  twoBOnlyLine: w('Invoices in GSTR-2B only', 'केवल GSTR-2B में बिल'),
  probableLine: w('Probable matches to confirm', 'पुष्टि के लिए संभावित मिलान'),
  atRiskLine: w('Input tax credit at risk', 'जोखिम में इनपुट टैक्स क्रेडिट'),
  matchNotCounted: w('The match from the GST connector points to invoice lines, not to a calculation receipt, so its counts and the credit at risk are not counted here.', 'GST कनेक्टर का मिलान बिल की पंक्तियों की ओर इशारा करता है, किसी गणना रसीद की ओर नहीं, इसलिए इसकी गिनती और जोखिम वाला क्रेडिट यहाँ नहीं गिने गए।'),
  matchOneEach: w('The match needs one purchase register and one GSTR-2B source; this period has more than one of either, so the match is not shown.', 'मिलान के लिए एक ख़रीद रजिस्टर और एक GSTR-2B स्रोत चाहिए; इस अवधि में किसी का एक से अधिक है, इसलिए मिलान नहीं दिखाया गया।'),
  matchEmpty: w('The purchase register or GSTR-2B has no purchases in this period, so they are not matched.', 'इस अवधि में ख़रीद रजिस्टर या GSTR-2B में कोई ख़रीद नहीं है, इसलिए मिलान नहीं हुआ।'),
  matchRefused: w('The GST connector refused the match.', 'GST कनेक्टर ने मिलान से मना किया।'),
  noRegister: w('No purchase register is imported apart from GSTR-2B.', 'GSTR-2B के अलावा कोई ख़रीद रजिस्टर आयात नहीं हुआ है।'),
  booksOnly: w('Some invoices are in the books but not in GSTR-2B: their input tax credit is at risk until the supplier reports them.', 'कुछ बिल खातों में हैं पर GSTR-2B में नहीं: सप्लायर के रिपोर्ट करने तक उनका इनपुट टैक्स क्रेडिट जोखिम में है।'),
  twoBOnly: w('Some invoices in GSTR-2B are not in the purchase register.', 'GSTR-2B के कुछ बिल ख़रीद रजिस्टर में नहीं हैं।'),
  mismatch: w('Some invoices are in both, with different amounts.', 'कुछ बिल दोनों में हैं, पर अलग राशि के साथ।'),
  probable: w('Some invoices may be the same with a differently written number or date; a person must confirm them.', 'कुछ बिल अलग लिखे नंबर या तारीख़ के साथ एक ही हो सकते हैं; किसी व्यक्ति को उनकी पुष्टि करनी होगी।'),
  invalid: w('Some lines have an invalid GSTIN or a repeated invoice and were set aside.', 'कुछ पंक्तियों में अमान्य GSTIN या दोहराया गया बिल है और उन्हें अलग रखा गया।'),
  composition: w('A composition business cannot claim input tax credit, so purchases are not matched with GSTR-2B.', 'कंपोज़िशन व्यवसाय इनपुट टैक्स क्रेडिट नहीं ले सकता, इसलिए ख़रीद का GSTR-2B से मिलान नहीं होता।'),
  unregistered: w('A business without GST registration has no GSTR-2B to match.', 'बिना GST पंजीकरण वाले व्यवसाय के पास मिलान के लिए GSTR-2B नहीं होता।'),
  gstr3bTitle: w('GSTR-3B outward supplies (table 3.1)', 'GSTR-3B बाहरी आपूर्ति (तालिका 3.1)'),
  outwardTaxable: w('Outward taxable supplies (3.1(a))', 'बाहरी कर योग्य आपूर्ति (3.1(a))'),
  zeroRated: w('Zero rated supplies (3.1(b))', 'शून्य दर वाली आपूर्ति (3.1(b))'),
  nilExempt: w('Nil rated and exempted supplies (3.1(c))', 'शून्य दर और छूट वाली आपूर्ति (3.1(c))'),
  nonGst: w('Non-GST supplies (3.1(e))', 'गैर-GST आपूर्ति (3.1(e))'),
  reverseChargeInward: w('Inward supplies under reverse charge (3.1(d)), not turnover', 'रिवर्स चार्ज वाली आवक आपूर्ति (3.1(d)), टर्नओवर नहीं'),
  outwardTax: w('Tax on outward taxable and zero rated supplies', 'बाहरी कर योग्य और शून्य दर वाली आपूर्ति पर कर'),
  gstr3bNotApplicable: w('A composition or unregistered business files no GSTR-3B outward supplies table, so there is no GSTR-3B turnover to compare.', 'कंपोज़िशन या बिना पंजीकरण वाला व्यवसाय GSTR-3B की बाहरी आपूर्ति तालिका दाखिल नहीं करता, इसलिए तुलना के लिए GSTR-3B टर्नओवर नहीं है।'),
  gstr3bRefused: w('The calculation of GSTR-3B turnover was refused, so it is not shown.', 'GSTR-3B टर्नओवर की गणना से मना किया गया, इसलिए यह नहीं दिखाया गया।'),
  net: w('Net movement (money in less money out)', 'शुद्ध बदलाव (आई राशि में से गई राशि घटाकर)'),
  bankRefused: w('The calculation of the bank totals was refused, so they are not shown.', 'बैंक योगों की गणना से मना किया गया, इसलिए वे नहीं दिखाए गए।'),
  withinToleranceLine: w('Invoices differing within the tolerance', 'सहनशीलता के भीतर अंतर वाले बिल'),
  tolerance: w('Invoices are matched exactly: no difference is treated as within a tolerance.', 'बिलों का मिलान ठीक-ठीक किया गया: किसी अंतर को सहनशीलता के भीतर नहीं माना गया।'),
  matchTooLarge: w('There are too many purchase lines to give each its own receipt. Choose a shorter period.', 'हर ख़रीद पंक्ति की अपनी रसीद देने के लिए पंक्तियाँ बहुत ज़्यादा हैं। छोटी अवधि चुनें।'),
  matchNotApplicable: w('A composition or unregistered business does not match purchases with GSTR-2B.', 'कंपोज़िशन या बिना पंजीकरण वाला व्यवसाय ख़रीद का GSTR-2B से मिलान नहीं करता।'),
  unknownTax: w('Some invoices in the books only do not state their tax; the credit at risk leaves them out, which is not their zero.', 'केवल खातों वाले कुछ बिलों में कर नहीं लिखा है; जोखिम वाला क्रेडिट उन्हें छोड़ देता है, यह उनका शून्य नहीं है।'),
  invoicesTitle: w('Invoices to look at', 'देखने लायक बिल'),
  invoicesMore: w('More invoices differ than are listed here; each has its own receipt in the match.', 'यहाँ जितने दिखाए गए हैं उससे ज़्यादा बिलों में अंतर है; हर एक की मिलान में अपनी रसीद है।'),
  'line.within-tolerance': w('differs within the tolerance', 'सहनशीलता के भीतर अंतर'),
  'line.amount-differs': w('amount differs', 'राशि अलग है'),
  'line.books-only': w('in the books only', 'केवल खातों में'),
  'line.gstr2b-only': w('in GSTR-2B only', 'केवल GSTR-2B में'),
  'line.probable': w('probable match to confirm', 'पुष्टि के लिए संभावित मिलान'),
};

// ---- The adapter: connectorsx replies, checked before use. -----------------------------------------------
type Envelope = { sourceId: string; group: string; operation: string; accepted: boolean; committed: boolean };
type Match = { mode: 'not-applicable'; gstMode: string } | { mode: 'matched'; counts: Record<'matched' | 'amountMismatch' | 'inBooksOnly' | 'in2bOnly' | 'probable' | 'invalid', number> };
type Months = { month: string; status: 'loaded' | 'not-loaded-yet' | 'refused' | 'failed' }[];
const INVALID = 'CONNECTOR_REPLY_INVALID';
const invalid = 'The connector part gave a reply this page cannot read.';
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const codeOf = (error: unknown) => (error as { code?: string })?.code;

/** Calls one connector method; `null` with a reason when the connector part is not there or refuses. ACCESS_REVOKED always stops the page. */
async function call(host: ModuleHost, method: string, payload: Record<string, unknown>): Promise<{ reply: unknown } | { code: string }> {
  try { return { reply: await host.call(method, payload) }; } catch (error) {
    const code = codeOf(error) ?? 'REQUEST_FAILED';
    if (code === 'ACCESS_REVOKED') throw error;
    return { code };
  }
}
export function checkEnvelopes(reply: unknown): Envelope[] {
  check(Array.isArray(reply) && reply.length <= 400, INVALID, invalid);
  return reply.map(item => {
    check(record(item) && text(item.sourceId) && text(item.group) && text(item.operation) && text(item.status, 20) && (item.committed === null || record(item.committed)), INVALID, invalid);
    return { sourceId: item.sourceId, group: item.group, operation: item.operation, accepted: item.status === 'accepted', committed: item.committed !== null };
  });
}
export function checkMatch(reply: unknown): Match {
  check(record(reply) && (reply.mode === 'not-applicable' || reply.mode === 'matched'), INVALID, invalid);
  if (reply.mode === 'not-applicable') { check(text(reply.gstMode, 20), INVALID, invalid); return { mode: 'not-applicable', gstMode: reply.gstMode }; }
  const counts = reply.counts;
  check(record(counts) && ['matched', 'amountMismatch', 'inBooksOnly', 'in2bOnly', 'probable', 'invalid'].every(key => count(counts[key])), INVALID, invalid);
  return { mode: 'matched', counts: { matched: counts.matched, amountMismatch: counts.amountMismatch, inBooksOnly: counts.inBooksOnly, in2bOnly: counts.in2bOnly, probable: counts.probable, invalid: counts.invalid } };
}
export function checkFreshness(reply: unknown): Months {
  check(Array.isArray(reply) && reply.length <= 1 && (reply.length === 0 || (record(reply[0]) && Array.isArray(reply[0].months) && reply[0].months.length <= 24)), INVALID, invalid);
  if (!reply.length) return [];
  return reply[0].months.map((item: unknown) => {
    check(record(item) && typeof item.month === 'string' && /^\d{4}-\d{2}$/.test(item.month) && ['loaded', 'not-loaded-yet', 'refused', 'failed'].includes(item.status), INVALID, invalid);
    return { month: item.month, status: item.status };
  });
}

// ---- The adapter: core-data's connector receipts, checked before use. ----------------------------------------
const CORE_INVALID = 'COREDATA_REPLY_INVALID';
const coreInvalid = 'The core data part gave a reply this page cannot read.';
const MINOR = /^-?\d{1,30}$/;
const coreMissing: readonly Missing[] = ['not-loaded-yet', 'absent', 'unknown', 'not-applicable', 'not-counted'];
/** A figure core-data gives: money in paise, or a whole count (never money). */
export type CoreFigure = { exact: string; unit: 'money' | 'count' };
/** What one core-data receipt gives for the keys this page knows: each a figure that opens the receipt, or a missing state. */
export type CoreTotals = { receipt: CalculationReceipt; figures: Record<string, CoreFigure | Missing> };
/** A stored receipt as core-data returns it: an id, and figures each with a key and an exact whole number. */
function checkReceipt(value: unknown): CalculationReceipt {
  check(record(value) && text(value.id) && text(value.operation, 80) && Array.isArray(value.figures) && value.figures.length <= 200
    && value.figures.every((f: unknown) => record(f) && text(f.key, 80) && typeof f.minor === 'string' && MINOR.test(f.minor))
    && record(value.coverage) && Array.isArray(value.coverage.gaps) && value.coverage.gaps.length <= 100 && value.coverage.gaps.every((g: unknown) => text(g, 500)), CORE_INVALID, coreInvalid);
  return value as CalculationReceipt;
}
/**
 * `coredata.bankTotals` / `coredata.gstr3bTurnover` reply: `{ receipt, figures: Record<key, minor>, missing: Record<key, Missing> }`.
 * Only `keys` are read. Each figure must be the receipt's own figure for that key; a count is never negative. A key
 * neither given nor missing is unknown, never zero.
 */
export function checkCoreTotals(reply: unknown, keys: Record<string, 'money' | 'count'>): CoreTotals {
  check(record(reply) && record(reply.figures) && record(reply.missing), CORE_INVALID, coreInvalid);
  const receipt = checkReceipt(reply.receipt), figures: CoreTotals['figures'] = {};
  for (const [key, unit] of Object.entries(keys)) {
    const value = reply.figures[key], gap = reply.missing[key];
    if (value !== undefined) {
      check(typeof value === 'string' && MINOR.test(value) && (unit === 'money' || !value.startsWith('-'))
        && receipt.figures.some(f => f.key === key && f.minor === value), CORE_INVALID, coreInvalid);
      figures[key] = { exact: value, unit };
    } else if (gap !== undefined) { check(coreMissing.includes(gap), CORE_INVALID, coreInvalid); figures[key] = gap; }
    else figures[key] = 'unknown';
  }
  return { receipt, figures };
}
/** `coredata.gst2bReceipt` reply: `{ receiptId, lines: { key: 'SUPPLIERGSTIN|INVOICE|FY', receiptId }[] }`. */
export function checkGst2b(reply: unknown): { receiptId: string; lines: { key: string; receiptId: string }[] } {
  check(record(reply) && text(reply.receiptId) && Array.isArray(reply.lines) && reply.lines.length <= 2000
    && reply.lines.every((l: unknown) => record(l) && text(l.key, 300) && l.key.split('|').length >= 3 && text(l.receiptId)), CORE_INVALID, coreInvalid);
  return { receiptId: reply.receiptId, lines: reply.lines.map((l: { key: string; receiptId: string }) => ({ key: l.key, receiptId: l.receiptId })) };
}
/** Figures of a stored receipt by key, for the keys asked; missing figures by their state, anything else unknown. */
function receiptFigures(receipt: CalculationReceipt, keys: Record<string, 'money' | 'count'>): CoreTotals['figures'] {
  const missingFigures = (receipt as { missingFigures?: unknown }).missingFigures;
  const gaps = new Map(Array.isArray(missingFigures) ? missingFigures.filter(m => record(m) && typeof m.key === 'string' && coreMissing.includes(m.missing)).map(m => [m.key as string, m.missing as Missing]) : []);
  const out: CoreTotals['figures'] = {};
  for (const [key, unit] of Object.entries(keys)) {
    const figure = receipt.figures.find(f => f.key === key);
    out[key] = figure && (unit === 'money' || !figure.minor.startsWith('-')) ? { exact: figure.minor, unit } : gaps.get(key) ?? 'unknown';
  }
  return out;
}
/** A core-data method: its reply, `absent` when core-data is not merged, or the refusal code. */
async function core(host: ModuleHost, method: string, payload: Record<string, unknown>): Promise<{ reply: unknown } | { absent: true } | { code: string }> {
  const result = await call(host, method, payload);
  return 'code' in result && ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(result.code) ? { absent: true } : result;
}
/** One figure line over a core-data receipt. */
function coreFigure(receipt: CalculationReceipt, key: string, value: CoreFigure | Missing): EngineFigure {
  if (typeof value === 'string') return missing(value);
  return { kind: value.unit, exact: value.exact, receiptId: receipt.id, labels: receipt.stale ? ['stale'] : [], measure: { operation: receipt.operation, key } };
}
/** A receipt's page state: tested only over reconciled imports and not stale, as for the registered calculations. */
const receiptState = (receipt: CalculationReceipt): PageState => receipt.coverage.completeness === 'reconciled-imports' && !receipt.stale ? 'ready-tested' : 'ready-untested';

/** The committed, accepted imports, by what they hold. */
async function imported(host: ModuleHost): Promise<{ envelopes: Envelope[] } | { reason: Words }> {
  const result = await call(host, 'connectorsx.envelopes', { limit: 400 });
  if ('code' in result) return { reason: ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(result.code) ? words.connectorMissing : words.connectorRefused };
  return { envelopes: checkEnvelopes(result.reply).filter(item => item.accepted && item.committed) };
}
const sourcesOf = (envelopes: Envelope[], test: (item: Envelope) => boolean) => [...new Set(envelopes.filter(test).map(item => item.sourceId))].sort();
const connectorGroups = new Set(['gst-downloads', 'gst-provider', 'bank-statements', 'form26as-ais']);
/** Sources the caller may see with facts of a kind in the period, other than the connector's own GST, tax and bank sources. */
function bookSources(ctx: Context, host: ModuleHost, envelopes: Envelope[], period: Period, kinds: string[] | null): string[] {
  const own = new Set(sourcesOf(envelopes, item => connectorGroups.has(item.group)));
  const facts: { sourceId: string; kind: string }[] = host.services.memory.query(ctx, { period }).facts;
  return [...new Set(facts.filter(fact => !own.has(fact.sourceId) && (kinds === null || kinds.includes(fact.kind))).map(fact => fact.sourceId))].sort();
}

// ---- Page building -----------------------------------------------------------------------------------------
const rank: Record<PageState, number> = { 'ready-tested': 0, 'ready-untested': 1, 'not-started': 2 };
const notCounted = (): EngineFigure => ({ kind: 'missing', missing: 'not-counted' });
const missing = (state: Missing): EngineFigure => ({ kind: 'missing', missing: state });
const blocked = (reason: Words): ConnectorPage => ({ state: 'not-started', reason, sections: [], receipts: [] });

/** One calculated line over chosen sources: its figure, its receipt and its gaps. */
class Lines {
  states: PageState[] = []; gaps: string[] = []; receipts: CalculationReceipt[] = []; reason: Words | undefined;
  private readonly calc: Calculations; private readonly period: Period; private readonly lang: Language;
  constructor(calc: Calculations, period: Period, lang: Language) { this.calc = calc; this.period = period; this.lang = lang; }
  async figure(op: string, key: string, sourceIds: string[], none: Words): Promise<EngineFigure> {
    if (!sourceIds.length) { this.gaps.push(none[this.lang]); return missing('not-loaded-yet'); }
    if (sourceIds.length > 64) { this.gaps.push(words.tooManySources[this.lang]); this.states.push('ready-untested'); return notCounted(); }
    const result = await this.calc.run(op, this.period, sourceIds);
    this.states.push(result.state);
    if (result.state === 'not-started' && result.reason) { this.reason ??= result.reason; this.gaps.push(result.reason[this.lang]); }
    const receipt = result.receipt;
    if (!receipt || receipt.coverage.completeness === 'empty') return missing(result.missing ?? 'unknown');
    this.receipts.push(receipt); this.gaps.push(...receipt.coverage.gaps);
    const figure = receipt.figures.find(item => item.key === key);
    if (!figure) return missing('not-applicable');
    return { kind: 'money', exact: figure.minor, receiptId: receipt.id, labels: receipt.stale ? ['stale'] : [], measure: { operation: receipt.operation, key: figure.key } };
  }
  /** Worst state of the calculated lines; a page with a not-counted line is never better than untested. */
  state(hasNotCounted: boolean): PageState {
    const all: PageState[] = [...this.states, ...(hasNotCounted ? ['ready-untested' as const] : [])];
    return all.reduce<PageState>((a, b) => rank[b] > rank[a] ? b : a, 'ready-tested');
  }
}
const line = (id: string, label: Words, lang: Language, figure: EngineFigure) => ({ id, label: label[lang], figure });

const turnoverKeys = { turnover: 'money', outwardTaxable: 'money', zeroRated: 'money', nilExempt: 'money', nonGst: 'money', reverseChargeInward: 'money', outwardTax: 'money' } as const;
type PageLine = ReturnType<typeof line>;

async function gstTurnover(ctx: Context, host: ModuleHost, calc: Calculations, period: Period, lang: Language): Promise<ConnectorPage> {
  const found = await imported(host); if ('reason' in found) return blocked(found.reason);
  const gstr1 = sourcesOf(found.envelopes, item => item.group === 'gst-downloads' && item.operation === 'gstr1-outward-invoices');
  const gstr3b = sourcesOf(found.envelopes, item => item.group === 'gst-downloads' && item.operation === 'gstr3b-outward-supplies');
  if (!gstr1.length && !gstr3b.length) return blocked(reasons.gst_turnover);
  const lines = new Lines(calc, period, lang);
  const first = line('gst', words.gstr1, lang, await lines.figure('billed', 'total', gstr1, words.noGstr1));
  if (gstr1.length) lines.gaps.push(words.gstr1Notes[lang]);
  // GSTR-3B turnover: core-data's receipt when it is there; before it is, not counted.
  let third: PageLine, notCountedLine = false; const sections: ReportSection[] = [];
  if (!gstr3b.length) { third = line('gstr3b', words.gstr3b, lang, missing('not-loaded-yet')); lines.gaps.push(words.noGstr3b[lang]); }
  else if (gstr3b.length > 64) { third = line('gstr3b', words.gstr3b, lang, notCounted()); lines.gaps.push(words.tooManySources[lang]); notCountedLine = true; }
  else {
    const result = await core(host, 'coredata.gstr3bTurnover', { sourceIds: gstr3b, period });
    if ('absent' in result) { third = line('gstr3b', words.gstr3b, lang, notCounted()); lines.gaps.push(words.gstr3bNotCounted[lang]); notCountedLine = true; }
    else if ('code' in result) {
      // Not GST-regular is a fact about the business, said in words; any other refusal leaves the line unknown.
      const notApplicable = result.code === 'GST_RETURN_NOT_APPLICABLE';
      third = line('gstr3b', words.gstr3b, lang, missing(notApplicable ? 'not-applicable' : 'unknown'));
      lines.gaps.push((notApplicable ? words.gstr3bNotApplicable : result.code === 'DICTIONARY_REQUIRED' ? reasons.dictionary : words.gstr3bRefused)[lang]);
      if (!notApplicable) lines.states.push('ready-untested');
    } else {
      const totals = checkCoreTotals(result.reply, turnoverKeys), receipt = totals.receipt;
      lines.receipts.push(receipt); lines.gaps.push(...receipt.coverage.gaps); lines.states.push(receiptState(receipt));
      third = line('gstr3b', words.gstr3b, lang, coreFigure(receipt, 'turnover', totals.figures.turnover));
      sections.push({ id: 'gstr3b', title: words.gstr3bTitle[lang], projection: false, gaps: [],
        lines: (['outwardTaxable', 'zeroRated', 'nilExempt', 'nonGst', 'reverseChargeInward', 'outwardTax'] as const).map(key => line(key, words[key], lang, coreFigure(receipt, key, totals.figures[key]))) });
    }
  }
  const books = line('books', words.books, lang, await lines.figure('net_sales', 'total', bookSources(ctx, host, found.envelopes, period, null), words.noBooks));
  const state = lines.state(notCountedLine);
  return { state, ...(state === 'not-started' && lines.reason ? { reason: lines.reason } : {}), receipts: lines.receipts,
    sections: [{ id: 'compare', title: words.compare[lang], projection: false, lines: [first, third, books], gaps: [...new Set(lines.gaps)] }, ...sections] };
}

const bankKeys = { credits: 'money', debits: 'money', net: 'money', opening: 'money', closing: 'money', entries: 'count' } as const;

async function bankSummary(host: ModuleHost, period: Period, lang: Language): Promise<ConnectorPage> {
  const found = await imported(host); if ('reason' in found) return blocked(found.reason);
  const banks = sourcesOf(found.envelopes, item => item.group === 'bank-statements');
  if (!banks.length) return blocked(reasons.bank_summary);
  const gaps: string[] = [], wanted = new Set<string>();
  for (let month = period.from.slice(0, 7); month <= period.to.slice(0, 7); month = addDays(`${month}-28`, 7).slice(0, 7)) wanted.add(month);
  let notLoaded = false, refused = false;
  for (const sourceId of banks) {
    const result = await call(host, 'connectorsx.freshness', { sourceId, asOf: period.to });
    if ('code' in result) { notLoaded = true; continue; }
    // Freshness covers the twelve months ending at the period's end; earlier months of a longer period are not known.
    const months = checkFreshness(result.reply);
    if (wanted.size > months.length) notLoaded = true;
    for (const item of months) if (wanted.has(item.month)) { if (item.status === 'not-loaded-yet') notLoaded = true; if (item.status === 'refused' || item.status === 'failed') refused = true; }
  }
  const ids = ['credits', 'debits', 'net', 'opening', 'closing', 'entries'] as const;
  const result = banks.length > 64 ? null : await core(host, 'coredata.bankTotals', { sourceIds: banks, period });
  let lines: PageLine[], receipts: CalculationReceipt[] = [], state: PageState = 'ready-untested', reason: Words | undefined;
  if (result === null) { gaps.push(words.tooManySources[lang]); lines = ids.map(id => line(id, words[id], lang, notCounted())); }
  else if ('absent' in result) {
    // Before core-data: the lines the page always had, not counted.
    gaps.push(words.bankNotCounted[lang]); lines = ids.filter(id => id !== 'net').map(id => line(id, words[id], lang, notCounted()));
  } else if ('code' in result) {
    reason = result.code === 'DICTIONARY_REQUIRED' ? reasons.dictionary : words.bankRefused; state = 'not-started';
    gaps.push(reason[lang]); lines = ids.map(id => line(id, words[id], lang, missing('unknown')));
  } else {
    const totals = checkCoreTotals(result.reply, bankKeys), receipt = totals.receipt;
    receipts = [receipt]; gaps.push(...receipt.coverage.gaps); state = receiptState(receipt);
    lines = ids.map(id => line(id, words[id], lang, coreFigure(receipt, id, totals.figures[id])));
  }
  if (notLoaded) gaps.push(words.bankMonthsMissing[lang]);
  if (refused) gaps.push(words.bankMonthsRefused[lang]);
  // A month not loaded, or refused by its checks, keeps the page from being tested.
  if (state === 'ready-tested' && (notLoaded || refused)) state = 'ready-untested';
  return { state, ...(reason ? { reason } : {}), receipts, sections: [{ id: 'bank', title: words.bankTitle[lang], projection: false, lines, gaps: [...new Set(gaps)] }] };
}

const matchKeys = { booksTaxable: 'money', gstr2bTaxable: 'money', matched: 'count', withinTolerance: 'count', amountDiffers: 'count', inBooksOnly: 'count', in2bOnly: 'count',
  probable: 'count', invalid: 'count', creditAtRisk: 'money', creditAtRiskUnknownTax: 'count' } as const;
const lineKeys = { booksTaxable: 'money', gstr2bTaxable: 'money', difference: 'money' } as const;
/** At most this many invoices that differ are listed on the page, each opening its own line receipt. */
export const MAX_INVOICE_LINES = 20;
const lineGroups = ['within-tolerance', 'amount-differs', 'books-only', 'gstr2b-only', 'probable'] as const;
type LineGroup = typeof lineGroups[number];
const matchIds = [['matched', 'matchedLine'], ['within-tolerance', 'withinToleranceLine'], ['amount-differs', 'mismatchLine'], ['books-only', 'booksOnlyLine'], ['gstr2b-only', 'twoBOnlyLine'],
  ['probable', 'probableLine'], ['credit-at-risk', 'atRiskLine']] as const;

/** The GSTR-2B match through core-data's receipts: group figures, gaps in words and the invoices that differ. */
function coreMatch(ctx: Context, host: ModuleHost, lines: Lines, lang: Language, reply: unknown) {
  const checked = checkGst2b(reply);
  const receipt = checkReceipt(host.services.calculator.receipt(ctx, checked.receiptId));
  const figures = receiptFigures(receipt, matchKeys);
  lines.receipts.push(receipt); lines.gaps.push(...receipt.coverage.gaps); lines.states.push(receiptState(receipt));
  const some = (key: keyof typeof matchKeys) => { const f = figures[key]; return typeof f !== 'string' && f.exact !== '0'; };
  if (some('inBooksOnly')) lines.gaps.push(words.booksOnly[lang]);
  if (some('in2bOnly')) lines.gaps.push(words.twoBOnly[lang]);
  if (some('amountDiffers')) lines.gaps.push(words.mismatch[lang]);
  if (some('probable')) lines.gaps.push(words.probable[lang]);
  if (some('invalid')) lines.gaps.push(words.invalid[lang]);
  if (some('creditAtRiskUnknownTax')) lines.gaps.push(words.unknownTax[lang]);
  lines.gaps.push(words.tolerance[lang]);
  const out = (id: string, label: Words, key: keyof typeof matchKeys) => line(id, label, lang, coreFigure(receipt, key, figures[key]));
  const group = [out('books', words.booksPurchases, 'booksTaxable'), out('gstr2b', words.twoBPurchases, 'gstr2bTaxable'), out('matched', words.matchedLine, 'matched'),
    out('within-tolerance', words.withinToleranceLine, 'withinTolerance'), out('amount-differs', words.mismatchLine, 'amountDiffers'), out('books-only', words.booksOnlyLine, 'inBooksOnly'),
    out('gstr2b-only', words.twoBOnlyLine, 'in2bOnly'), out('probable', words.probableLine, 'probable'), out('credit-at-risk', words.atRiskLine, 'creditAtRisk')];
  // The invoices that differ, in core-data's key order: each opens its own line receipt.
  const stored = new Map(host.store.read().receipts.map(item => [item.id, item]));
  const invoices: PageLine[] = []; let more = false;
  for (const item of checked.lines) {
    const kind = (stored.get(item.receiptId)?.assumptions as { group?: unknown } | undefined)?.group;
    if (!lineGroups.includes(kind as LineGroup)) continue;
    if (invoices.length >= MAX_INVOICE_LINES) { more = true; break; }
    const one = checkReceipt(host.services.calculator.receipt(ctx, item.receiptId)), values = receiptFigures(one, lineKeys);
    const key = typeof values.difference !== 'string' ? 'difference' : typeof values.booksTaxable !== 'string' ? 'booksTaxable' : 'gstr2bTaxable';
    lines.receipts.push(one);
    const [gstin, ...rest] = item.key.split('|'); const year = rest.pop()!;
    invoices.push({ id: `invoice-${invoices.length + 1}`, label: `${gstin} · ${rest.join('|')} · ${year}: ${words[`line.${kind as LineGroup}`][lang]}`, figure: coreFigure(one, key, values[key]) });
  }
  const section: ReportSection | null = invoices.length ? { id: 'invoices', title: words.invoicesTitle[lang], projection: false, lines: invoices, gaps: more ? [words.invoicesMore[lang]] : [] } : null;
  return { group, section };
}

async function purchasesAgainst2b(ctx: Context, host: ModuleHost, calc: Calculations, period: Period, lang: Language): Promise<ConnectorPage> {
  const found = await imported(host); if ('reason' in found) return blocked(found.reason);
  const twoB = sourcesOf(found.envelopes, item => item.group === 'gst-downloads' && item.operation === 'gstr2b-b2b-invoices');
  if (!twoB.length) return blocked(reasons.gstr2b_match);
  const register = bookSources(ctx, host, found.envelopes, period, ['purchase']);
  const lines = new Lines(calc, period, lang);
  const one = register.length === 1 && twoB.length === 1;
  const page = (state: PageState, sections: ReportSection[]): ConnectorPage => ({ state, ...(state === 'not-started' && lines.reason ? { reason: lines.reason } : {}), receipts: lines.receipts, sections });
  const purchaseLines = async () => [line('books', words.booksPurchases, lang, await lines.figure('purchases', 'total', register, words.noRegister)),
    line('gstr2b', words.twoBPurchases, lang, await lines.figure('purchases', 'total', twoB, reasons.gstr2b_match))];
  // core-data's match receipts, when they are there. Exact matching: no tolerance is set on this page.
  if (one) {
    let result = await core(host, 'coredata.gst2bReceipt', { registerSourceId: register[0], gstr2bSourceId: twoB[0], period, toleranceMinor: '0' });
    if ('reply' in result) {
      const trial = new Lines(calc, period, lang);
      try {
        const { group, section } = coreMatch(ctx, host, trial, lang, result.reply);
        return { state: trial.state(false), receipts: trial.receipts,
          sections: [{ id: 'match', title: words.matchTitle[lang], projection: false, lines: group, gaps: [...new Set(trial.gaps)] }, ...(section ? [section] : [])] };
      } catch (error) {
        // A match receipt that does not open is a refusal of the match, never a page of guesses.
        const code = codeOf(error); if (code === 'ACCESS_REVOKED' || code === CORE_INVALID) throw error;
        result = { code: code ?? 'REQUEST_FAILED' };
      }
    }
    if ('code' in result) {
      if (result.code === 'GST_MATCH_NOT_APPLICABLE') return blocked(words.matchNotApplicable);
      // A refusal: the purchase lines still come from the registered calculation; the match lines are not known.
      const purchases = await purchaseLines(), empty = result.code === 'GST_MATCH_SOURCES_EMPTY';
      lines.gaps.push((empty ? words.matchEmpty : result.code === 'GST_MATCH_TOO_LARGE' ? words.matchTooLarge : result.code === 'DICTIONARY_REQUIRED' ? reasons.dictionary : words.matchRefused)[lang]);
      const matchLines = matchIds.map(([id, label]) => line(id, words[label], lang, missing(empty ? 'not-loaded-yet' : 'unknown')));
      return page(lines.state(!empty), [{ id: 'match', title: words.matchTitle[lang], projection: false, lines: [...purchases, ...matchLines], gaps: [...new Set(lines.gaps)] }]);
    }
  }
  // Before core-data, or with more than one source on a side: the connector's own match, whose lines are not counted.
  const purchases = await purchaseLines();
  let match: Match | null = null;
  if (!one) { if (register.length) lines.gaps.push(words.matchOneEach[lang]); }
  else {
    const result = await call(host, 'connectorsx.gstMatch', { registerSourceId: register[0], gstr2bSourceId: twoB[0], period });
    if ('code' in result) lines.gaps.push((result.code === 'GST_MATCH_SOURCES_EMPTY' ? words.matchEmpty : result.code === 'DICTIONARY_REQUIRED' ? reasons.dictionary : words.matchRefused)[lang]);
    else match = checkMatch(result.reply);
  }
  if (match?.mode === 'not-applicable') return blocked(match.gstMode === 'composition' ? words.composition : words.unregistered);
  const matchLines = matchIds.filter(([id]) => id !== 'within-tolerance').map(([id, label]) => line(id, words[label], lang, match ? notCounted() : missing('not-loaded-yet')));
  if (match) {
    lines.gaps.push(words.matchNotCounted[lang]);
    const c = match.counts;
    if (c.inBooksOnly > 0) lines.gaps.push(words.booksOnly[lang]);
    if (c.in2bOnly > 0) lines.gaps.push(words.twoBOnly[lang]);
    if (c.amountMismatch > 0) lines.gaps.push(words.mismatch[lang]);
    if (c.probable > 0) lines.gaps.push(words.probable[lang]);
    if (c.invalid > 0) lines.gaps.push(words.invalid[lang]);
  }
  return page(lines.state(true), [{ id: 'match', title: words.matchTitle[lang], projection: false, lines: [...purchases, ...matchLines], gaps: [...new Set(lines.gaps)] }]);
}

export function connectorPage(ctx: Context, host: ModuleHost, calc: Calculations, id: ConnectorPageId, period: Period, lang: Language): Promise<ConnectorPage> {
  return id === 'gst-turnover' ? gstTurnover(ctx, host, calc, period, lang) : id === 'bank-summary' ? bankSummary(host, period, lang) : purchasesAgainst2b(ctx, host, calc, period, lang);
}
