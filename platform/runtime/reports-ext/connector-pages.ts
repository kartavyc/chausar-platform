/**
 * The three report pages built over the connector part (connectors-ext): GST turnover against the books,
 * the bank statement summary, and purchases against GSTR-2B. Which sources hold a GSTR-1, a GSTR-3B, a
 * GSTR-2B or a bank statement comes from `connectorsx.envelopes`; the match comes from `connectorsx.gstMatch`
 * and the months loaded from `connectorsx.freshness`, each called through `host.call` and checked here.
 *
 * Every amount on these pages is a registered calculation over those sources, so each opens its receipt.
 * The connector's own totals (a statement's balances, the match lists) point to source lines, not to a
 * calculation receipt, so they print as not counted with a gap saying why. Nothing is added up here.
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
  gstr3b: w('Taxable value of outward supplies in GSTR-3B (table 3.1)', 'GSTR-3B (तालिका 3.1) में बाहरी आपूर्ति का कर योग्य मूल्य'),
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

async function gstTurnover(ctx: Context, host: ModuleHost, calc: Calculations, period: Period, lang: Language): Promise<ConnectorPage> {
  const found = await imported(host); if ('reason' in found) return blocked(found.reason);
  const gstr1 = sourcesOf(found.envelopes, item => item.group === 'gst-downloads' && item.operation === 'gstr1-outward-invoices');
  const gstr3b = sourcesOf(found.envelopes, item => item.group === 'gst-downloads' && item.operation === 'gstr3b-outward-supplies');
  if (!gstr1.length && !gstr3b.length) return blocked(reasons.gst_turnover);
  const lines = new Lines(calc, period, lang);
  const first = line('gst', words.gstr1, lang, await lines.figure('billed', 'total', gstr1, words.noGstr1));
  if (gstr1.length) lines.gaps.push(words.gstr1Notes[lang]);
  const third = line('gstr3b', words.gstr3b, lang, gstr3b.length ? notCounted() : missing('not-loaded-yet'));
  lines.gaps.push((gstr3b.length ? words.gstr3bNotCounted : words.noGstr3b)[lang]);
  const books = line('books', words.books, lang, await lines.figure('net_sales', 'total', bookSources(ctx, host, found.envelopes, period, null), words.noBooks));
  const state = lines.state(gstr3b.length > 0);
  return { state, ...(state === 'not-started' && lines.reason ? { reason: lines.reason } : {}), receipts: lines.receipts,
    sections: [{ id: 'compare', title: words.compare[lang], projection: false, lines: [first, third, books], gaps: [...new Set(lines.gaps)] }] };
}

async function bankSummary(host: ModuleHost, period: Period, lang: Language): Promise<ConnectorPage> {
  const found = await imported(host); if ('reason' in found) return blocked(found.reason);
  const banks = sourcesOf(found.envelopes, item => item.group === 'bank-statements');
  if (!banks.length) return blocked(reasons.bank_summary);
  const gaps = [words.bankNotCounted[lang]], wanted = new Set<string>();
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
  if (notLoaded) gaps.push(words.bankMonthsMissing[lang]);
  if (refused) gaps.push(words.bankMonthsRefused[lang]);
  const lines = (['credits', 'debits', 'opening', 'closing', 'entries'] as const).map(id => line(id, words[id], lang, notCounted()));
  return { state: 'ready-untested', receipts: [], sections: [{ id: 'bank', title: words.bankTitle[lang], projection: false, lines, gaps }] };
}

async function purchasesAgainst2b(ctx: Context, host: ModuleHost, calc: Calculations, period: Period, lang: Language): Promise<ConnectorPage> {
  const found = await imported(host); if ('reason' in found) return blocked(found.reason);
  const twoB = sourcesOf(found.envelopes, item => item.group === 'gst-downloads' && item.operation === 'gstr2b-b2b-invoices');
  if (!twoB.length) return blocked(reasons.gstr2b_match);
  const register = bookSources(ctx, host, found.envelopes, period, ['purchase']);
  const lines = new Lines(calc, period, lang);
  const books = line('books', words.booksPurchases, lang, await lines.figure('purchases', 'total', register, words.noRegister));
  const inTwoB = line('gstr2b', words.twoBPurchases, lang, await lines.figure('purchases', 'total', twoB, reasons.gstr2b_match));
  let match: Match | null = null;
  if (register.length !== 1 || twoB.length !== 1) { if (register.length) lines.gaps.push(words.matchOneEach[lang]); }
  else {
    const result = await call(host, 'connectorsx.gstMatch', { registerSourceId: register[0], gstr2bSourceId: twoB[0], period });
    if ('code' in result) lines.gaps.push((result.code === 'GST_MATCH_SOURCES_EMPTY' ? words.matchEmpty : result.code === 'DICTIONARY_REQUIRED' ? reasons.dictionary : words.matchRefused)[lang]);
    else match = checkMatch(result.reply);
  }
  if (match?.mode === 'not-applicable') return blocked(match.gstMode === 'composition' ? words.composition : words.unregistered);
  const matchLines = ([['matched', 'matchedLine'], ['amount-differs', 'mismatchLine'], ['books-only', 'booksOnlyLine'], ['gstr2b-only', 'twoBOnlyLine'], ['probable', 'probableLine'], ['credit-at-risk', 'atRiskLine']] as const)
    .map(([id, label]) => line(id, words[label], lang, match ? notCounted() : missing('not-loaded-yet')));
  if (match) {
    lines.gaps.push(words.matchNotCounted[lang]);
    const c = match.counts;
    if (c.inBooksOnly > 0) lines.gaps.push(words.booksOnly[lang]);
    if (c.in2bOnly > 0) lines.gaps.push(words.twoBOnly[lang]);
    if (c.amountMismatch > 0) lines.gaps.push(words.mismatch[lang]);
    if (c.probable > 0) lines.gaps.push(words.probable[lang]);
    if (c.invalid > 0) lines.gaps.push(words.invalid[lang]);
  }
  const state = lines.state(true);
  return { state, ...(state === 'not-started' && lines.reason ? { reason: lines.reason } : {}), receipts: lines.receipts,
    sections: [{ id: 'match', title: words.matchTitle[lang], projection: false, lines: [books, inTwoB, ...matchLines], gaps: [...new Set(lines.gaps)] }] };
}

export function connectorPage(ctx: Context, host: ModuleHost, calc: Calculations, id: ConnectorPageId, period: Period, lang: Language): Promise<ConnectorPage> {
  return id === 'gst-turnover' ? gstTurnover(ctx, host, calc, period, lang) : id === 'bank-summary' ? bankSummary(host, period, lang) : purchasesAgainst2b(ctx, host, calc, period, lang);
}
