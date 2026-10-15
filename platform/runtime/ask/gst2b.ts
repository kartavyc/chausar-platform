/**
 * AS-19: purchases against GSTR-2B. The match is the connectors lane's (`connectorsx.gstMatch`):
 * its GSTR-2B recipe (`gst.gstr2b-*`) writes the suppliers' filed lines as facts of kind
 * `purchase` in their own source, beside the purchase register's source, and matches them by
 * supplier GSTIN, invoice number and financial year, with probable matches kept apart. This page
 * finds the two sources (or asks which), applies your tolerance to the amounts that differ, and
 * builds the IMS list. Where the connectors lane is absent, an older local match reads facts of
 * kind `gstr2b` by GSTIN and invoice number. Each line opens its receipt once the core lane serves
 * match receipts (`coredata.gst2bReceipt`); until then it opens its two rows as written.
 *
 * Each pair is matched, Each pair is matched, differs inside or outside the
 * tolerance you set, or is on one side only. The IMS list says what a person should accept,
 * reject or keep pending in the GST portal, with the reason.
 *
 * Chausar never acts in the GST portal. Amounts are exact paise; the difference is a BigInt.
 */
import { check, hash, type Context, type Fact } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canSeeFact, type Period } from '../memory.ts';
import type { Gst2bGroup, Gst2bLineReply, Gst2bReply } from './contracts.ts';
import { askState, asText, businessToday, codeOf, currentDictionary, identifier, input, minorString, namedPeriod, peekAsk, period, requireId, translate } from './shared.ts';

export const BOOK_KIND = 'purchase';
export const TWO_B_KINDS: readonly string[] = ['gstr2b', 'gstr-2b'];
const MONEY = /^-?\d+$/;

type Line = { id: string; group: Gst2bGroup; supplier: string; invoice: string; books: Fact | null; twoB: Fact | null; booksMinor: bigint | null; twoBMinor: bigint | null; booksTax: bigint | null; twoBTax: bigint | null; key: string };

const key = (fact: Fact) => `${asText(fact.fields.gstin ?? fact.fields.supplierGstin).trim().toUpperCase()}|${asText(fact.fields.invoiceId ?? fact.fields.invoiceNumber).trim().toUpperCase()}`;
const amount = (fact: Fact, field: string) => { const value = fact.fields[field]; return typeof value === 'string' && MONEY.test(value) ? BigInt(value) : null; };
/** A row can be matched only with a supplier GSTIN, an invoice number and its amount in the books' currency. */
export const matchable = (fact: Fact, currency: string) => key(fact).split('|').every(part => part.length > 0) && amount(fact, 'amountMinor') !== null
  && (fact.fields.currency === undefined || fact.fields.currency === currency);
const abs = (n: bigint) => n < 0n ? -n : n;

export function matchLines(books: Fact[], twoB: Fact[], tolerance: bigint): Line[] {
  const byKey = new Map<string, { books: Fact[]; twoB: Fact[] }>();
  for (const fact of books) { const k = key(fact), e = byKey.get(k) ?? { books: [], twoB: [] }; e.books.push(fact); byKey.set(k, e); }
  for (const fact of twoB) { const k = key(fact), e = byKey.get(k) ?? { books: [], twoB: [] }; e.twoB.push(fact); byKey.set(k, e); }
  const lines: Line[] = [];
  for (const [k, entry] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [supplier = '', invoice = ''] = k.split('|');
    const pairs = Math.max(entry.books.length, entry.twoB.length);
    for (let i = 0; i < pairs; i++) {
      const b = entry.books[i] ?? null, t = entry.twoB[i] ?? null;
      const booksMinor = b ? amount(b, 'amountMinor') : null, twoBMinor = t ? amount(t, 'amountMinor') : null;
      // A missing tax amount is no tax recorded on that side; the taxable amount is never missing here.
      const booksTax = b ? amount(b, 'taxMinor') ?? 0n : 0n, twoBTax = t ? amount(t, 'taxMinor') ?? 0n : 0n;
      let group: Gst2bGroup;
      if (!t) group = 'books-only';
      else if (!b) group = 'in-2b-only';
      else if (booksMinor === twoBMinor && booksTax === twoBTax) group = 'matched';
      else group = abs(booksMinor! - twoBMinor!) <= tolerance && abs(booksTax - twoBTax) <= tolerance ? 'differs-inside' : 'differs-outside';
      lines.push({ id: `gst_${hash([k, i]).slice(0, 24)}`, group, supplier, invoice, books: b, twoB: t, booksMinor, twoBMinor, booksTax, twoBTax, key: k });
    }
  }
  return lines;
}

function scope(ctx: Context, payload: unknown, host: ModuleHost, extra: string[] = [], required: string[] = []) {
  const request = input(payload, ['period', 'periodId', 'today', 'registerSourceId', 'gstr2bSourceId', ...extra], required);
  const p: Period = request.period !== undefined ? period(request.period) : namedPeriod(request.periodId ?? 'last-month', businessToday(host, request.today));
  for (const name of ['registerSourceId', 'gstr2bSourceId']) if (request[name] !== undefined) requireId(request[name]);
  return { request, p };
}
function legacy(ctx: Context, host: ModuleHost, p: Period, currency: string) {
  const state = host.store.read(), within = (f: Fact) => !f.deletedAt && !f.supersededAt && f.validFrom >= p.from && f.validFrom <= p.to && canSeeFact(host.store, ctx, f);
  const books = state.facts.filter(f => f.kind === BOOK_KIND && within(f)), twoB = state.facts.filter(f => TWO_B_KINDS.includes(f.kind) && within(f));
  const ok = (f: Fact) => matchable(f, currency);
  return { books: books.filter(ok), twoB: twoB.filter(ok), leftOut: [...books, ...twoB].filter(f => !ok(f)).length, anyTwoB: twoB.length > 0 };
}
const tolerance = (host: ModuleHost) => BigInt(peekAsk(host.store.read()).gst.toleranceMinor);

/** The GSTR-2B sources the connectors lane read, and the other sources holding purchases. */
async function sourcesOf(ctx: Context, host: ModuleHost, p: Period) {
  let envelopes: { sourceId?: unknown; recipeId?: unknown }[] = [];
  try { envelopes = await host.call('connectorsx.envelopes', { limit: 400 }) as typeof envelopes; }
  catch (error) { if (!['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(codeOf(error))) throw translate(error); }
  const gstr2b = [...new Set(envelopes.filter(e => typeof e?.recipeId === 'string' && e.recipeId.startsWith('gst.gstr2b') && typeof e.sourceId === 'string').map(e => e.sourceId as string))].sort();
  const register = [...new Set(host.store.read().facts.filter(f => f.kind === BOOK_KIND && !f.deletedAt && !gstr2b.includes(f.sourceId)
    && f.validFrom >= p.from && f.validFrom <= p.to && canSeeFact(host.store, ctx, f)).map(f => f.sourceId))].sort();
  return { gstr2b, register };
}

type Chosen = { via: 'connectors'; registerSourceId: string; gstr2bSourceId: string } | { via: 'facts' };
type Matched = { lines: Line[]; leftOut: number };
/** The current version of a fact a match line names, if this seat may see it. */
function factOf(ctx: Context, host: ModuleHost, sourceId: string, entityId: string): Fact | null {
  return host.store.read().facts.filter(f => f.sourceId === sourceId && f.entityId === entityId && !f.deletedAt && !f.supersededAt && canSeeFact(host.store, ctx, f)).at(-1) ?? null;
}
const minorOrNull = (value: unknown) => typeof value === 'string' && MONEY.test(value) ? BigInt(value) : null;
const fyOf = (date: string) => { const y = Number(date.slice(0, 4)), start = Number(date.slice(5, 7)) >= 4 ? y : y - 1; return `${start}-${String((start + 1) % 100).padStart(2, '0')}`; };

/** Maps the connectors lane's match result onto this page's lines. Tolerance applies only to amounts that differ. */
export function fromConnectors(result: any, find: (side: 'register' | 'gstr2b', entityId: string) => Fact | null, tol: bigint): Matched {
  check(result && result.mode === 'matched' && Array.isArray(result.matched) && Array.isArray(result.amountMismatch) && Array.isArray(result.inBooksOnly)
    && Array.isArray(result.in2bOnly) && Array.isArray(result.probable) && Array.isArray(result.invalid), 'ASK_REFUSED', 'The GSTR-2B match came back in a shape this page does not read.');
  const lines: Line[] = [];
  const push = (group: Gst2bGroup, supplier: string, invoice: string, fy: string, register: { entityId: string } | null, gstr2b: { entityId: string } | null,
    books: [bigint | null, bigint | null] | null, twoB: [bigint | null, bigint | null] | null) => {
    const key = `${supplier}|${invoice}|${fy}`;
    lines.push({ id: `gst_${hash([key, group, register?.entityId ?? '', gstr2b?.entityId ?? '']).slice(0, 24)}`, group, supplier, invoice, key,
      books: register ? find('register', register.entityId) : null, twoB: gstr2b ? find('gstr2b', gstr2b.entityId) : null,
      booksMinor: books?.[0] ?? null, booksTax: books?.[1] ?? null, twoBMinor: twoB?.[0] ?? null, twoBTax: twoB?.[1] ?? null });
  };
  for (const m of result.matched) push('matched', m.supplierGstin, m.invoiceNumber, m.financialYear, m.receipt.register, m.receipt.gstr2b,
    [minorOrNull(m.taxableMinor), minorOrNull(m.taxMinor)], [minorOrNull(m.taxableMinor), minorOrNull(m.taxMinor)]);
  for (const m of result.amountMismatch) {
    const taxable = minorOrNull(m.difference?.taxableMinor), tax = minorOrNull(m.difference?.taxMinor);
    // An unknown tax difference cannot be shown to be inside the tolerance.
    const inside = taxable !== null && abs(taxable) <= tol && tax !== null && abs(tax) <= tol;
    push(inside ? 'differs-inside' : 'differs-outside', m.supplierGstin, m.invoiceNumber, m.financialYear, m.receipt.register, m.receipt.gstr2b,
      [minorOrNull(m.register.taxableMinor), minorOrNull(m.register.taxMinor)], [minorOrNull(m.gstr2b.taxableMinor), minorOrNull(m.gstr2b.taxMinor)]);
  }
  for (const o of result.inBooksOnly) push('books-only', o.supplierGstin, o.invoiceNumber, fyOf(o.invoiceDate), o.receipt, null, [minorOrNull(o.taxableMinor), minorOrNull(o.taxMinor)], null);
  for (const o of result.in2bOnly) push('in-2b-only', o.supplierGstin, o.invoiceNumber, fyOf(o.invoiceDate), null, o.receipt, null, [minorOrNull(o.taxableMinor), minorOrNull(o.taxMinor)]);
  // A probable match is a suggestion only: never counted as matched, kept for a person to look at.
  for (const p of result.probable) push('probable', p.supplierGstin, p.register.invoiceNumber, fyOf(p.register.invoiceDate), p.register.receipt, p.gstr2b.receipt,
    [minorOrNull(p.register.taxableMinor), minorOrNull(p.register.taxMinor)], [minorOrNull(p.gstr2b.taxableMinor), minorOrNull(p.gstr2b.taxMinor)]);
  return { lines, leftOut: result.invalid.length };
}

type Prepared = { state: 'ready'; chosen: Chosen; matched: Matched; tol: bigint; p: Period }
  | Extract<Gst2bReply, { state: 'not-applicable' | 'not-loaded' | 'choose-sources' }>;
async function prepare(ctx: Context, request: Record<string, any>, p: Period, host: ModuleHost): Promise<Prepared> {
  const dictionary = currentDictionary(host, ctx);
  check(dictionary, 'ASK_NO_DICTIONARY', 'Publish what your words mean before asking for numbers.');
  if (dictionary.gstMode !== 'regular') return { state: 'not-applicable', reason: dictionary.gstMode };
  const tol = tolerance(host), found = await sourcesOf(ctx, host, p);
  const local = () => {
    const facts = legacy(ctx, host, p, dictionary.currency);
    return facts.anyTwoB ? { state: 'ready' as const, chosen: { via: 'facts' as const }, matched: { lines: matchLines(facts.books, facts.twoB, tol), leftOut: facts.leftOut }, tol, p } : { state: 'not-loaded' as const, period: p };
  };
  let registerSourceId = request.registerSourceId as string | undefined, gstr2bSourceId = request.gstr2bSourceId as string | undefined;
  if (registerSourceId !== undefined) check(found.register.includes(registerSourceId), 'ASK_NOT_FOUND', 'This source holds no purchases you can see in the period.');
  if (gstr2bSourceId !== undefined) check(found.gstr2b.includes(gstr2bSourceId), 'ASK_NOT_FOUND', 'This source is not a GSTR-2B read you can see.');
  if (!found.gstr2b.length) return local();
  registerSourceId ??= found.register.length === 1 ? found.register[0] : undefined;
  gstr2bSourceId ??= found.gstr2b.length === 1 ? found.gstr2b[0] : undefined;
  if (registerSourceId === undefined || gstr2bSourceId === undefined) {
    if (!found.register.length) return { state: 'not-loaded', period: p };
    return { state: 'choose-sources', period: p, registerSources: found.register, gstr2bSources: found.gstr2b };
  }
  let result: unknown;
  try { result = await host.call('connectorsx.gstMatch', { registerSourceId, gstr2bSourceId, period: p }); }
  catch (error) {
    const code = codeOf(error);
    if (code === 'GST_MATCH_SOURCES_EMPTY') return { state: 'not-loaded', period: p };
    if (['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(code)) return local();
    throw translate(error);
  }
  const sourceFor = { register: registerSourceId, gstr2b: gstr2bSourceId };
  return { state: 'ready', chosen: { via: 'connectors', registerSourceId, gstr2bSourceId }, tol, p,
    matched: fromConnectors(result, (side, entityId) => factOf(ctx, host, sourceFor[side], entityId), tol) };
}

/** Receipts for the match and each line, from the core lane, when it serves them. */
async function receiptsFor(host: ModuleHost, prepared: Extract<Prepared, { state: 'ready' }>): Promise<{ matchReceiptId: string | null; byKey: Map<string, string> }> {
  if (prepared.chosen.via !== 'connectors') return { matchReceiptId: null, byKey: new Map() };
  try {
    const reply = await host.call('coredata.gst2bReceipt', { registerSourceId: prepared.chosen.registerSourceId, gstr2bSourceId: prepared.chosen.gstr2bSourceId,
      period: prepared.p, toleranceMinor: String(prepared.tol) }) as { receiptId?: unknown; lines?: unknown };
    check(identifier(reply?.receiptId) && Array.isArray(reply.lines) && reply.lines.every((l: any) => typeof l?.key === 'string' && identifier(l.receiptId)), 'ASK_REFUSED', 'The match receipt came back in a shape this page does not read.');
    return { matchReceiptId: reply.receiptId as string, byKey: new Map((reply.lines as { key: string; receiptId: string }[]).map(l => [l.key, l.receiptId])) };
  } catch (error) {
    if (['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(codeOf(error))) return { matchReceiptId: null, byKey: new Map() };
    throw translate(error);
  }
}

const GROUPS: readonly Gst2bGroup[] = ['matched', 'differs-inside', 'differs-outside', 'probable', 'in-2b-only', 'books-only'];
export async function gst2b(ctx: Context, payload: unknown, host: ModuleHost): Promise<Gst2bReply> {
  const { request, p } = scope(ctx, payload, host);
  const prepared = await prepare(ctx, request, p, host);
  if (prepared.state !== 'ready') return prepared;
  const { lines, leftOut } = prepared.matched, receipts = await receiptsFor(host, prepared);
  const groups = GROUPS.map(group => {
    const these = lines.filter(l => l.group === group);
    // A group's amount is the books' side where it exists, else the 2B side. Unknown tax is counted, never added as zero.
    const tax = these.map(l => l.books ? l.booksTax : l.twoBTax);
    return { group, count: these.length, taxableMinor: String(these.reduce((s, l) => s + (l.booksMinor ?? l.twoBMinor ?? 0n), 0n)),
      taxMinor: String(tax.reduce<bigint>((s, t) => s + (t ?? 0n), 0n)), unknownTax: tax.filter(t => t === null).length };
  });
  return {
    state: 'ready', period: p, toleranceMinor: String(prepared.tol), via: prepared.chosen.via, leftOut, groups,
    sources: prepared.chosen.via === 'connectors' ? { register: prepared.chosen.registerSourceId, gstr2b: prepared.chosen.gstr2bSourceId } : null,
    matchReceiptId: receipts.matchReceiptId,
    lines: lines.map(l => ({ id: l.id, group: l.group, supplier: l.supplier, invoice: l.invoice, booksMinor: l.booksMinor === null ? null : String(l.booksMinor), twoBMinor: l.twoBMinor === null ? null : String(l.twoBMinor),
      differenceMinor: l.booksMinor !== null && l.twoBMinor !== null ? String(l.twoBMinor - l.booksMinor) : null, bookRowId: l.books?.id ?? null, twoBRowId: l.twoB?.id ?? null,
      receiptId: receipts.byKey.get(l.key) ?? null })),
    ims: lines.filter(l => l.twoBMinor !== null || l.twoB).map(l => ({ lineId: l.id,
      action: l.group === 'in-2b-only' || l.group === 'probable' ? 'pending' as const : l.group === 'differs-outside' ? 'reject' as const : 'accept' as const,
      reason: l.group === 'in-2b-only' ? 'not-in-books' as const : l.group === 'probable' ? 'probable-match' as const : l.group === 'differs-outside' ? 'amount-differs' as const : 'matched' as const })),
  };
}

export async function setTolerance(_ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['toleranceMinor'], ['toleranceMinor']);
  const value = minorString(request.toleranceMinor);
  check(BigInt(value) >= 0n && BigInt(value) <= 100_000_00n, 'ASK_INVALID', 'Choose a tolerance from nothing up to one lakh rupees.');
  await host.store.update(state => { askState(state).gst.toleranceMinor = value; });
  return { toleranceMinor: value };
}

const cellsOf = (fact: Fact) => Object.entries(fact.fields).filter(([name]) => !name.startsWith('_')).map(([name, value]) => ({ name, value: asText(value).slice(0, 500) }));
export async function line(ctx: Context, payload: unknown, host: ModuleHost): Promise<Gst2bLineReply> {
  const { request, p } = scope(ctx, payload, host, ['lineId'], ['lineId']);
  const prepared = await prepare(ctx, request, p, host);
  check(prepared.state === 'ready', 'ASK_NOT_FOUND', 'There is no GSTR-2B match for this period.');
  const id = requireId(request.lineId), found = prepared.matched.lines.find(l => l.id === id);
  check(found, 'ASK_NOT_FOUND', 'This line is no longer in the match.');
  const side = (f: Fact | null) => f ? { rowId: f.id, sourceId: f.sourceId, sourceRow: f.sourceRow ?? null, cells: cellsOf(f) } : null;
  return { id, group: found.group, books: side(found.books), twoB: side(found.twoB),
    rule: { toleranceMinor: String(prepared.tol), key: prepared.chosen.via === 'connectors' ? 'supplier-gstin-invoice-and-financial-year' : 'supplier-gstin-and-invoice' } };
}

/** The IMS list as CSV for a person to act on in the portal. Cells from files are quoted, and a
 *  leading formula character is neutralised so a spreadsheet cannot run it. */
export async function exportIms(ctx: Context, payload: unknown, host: ModuleHost) {
  const reply = await gst2b(ctx, payload, host);
  check(reply.state === 'ready', 'ASK_NOT_FOUND', 'There is no IMS list for this period.');
  // Text from files is neutralised; the paise columns are digits written by Chausar and stay exact.
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replaceAll('"', '""')}"`, digits = (v: string) => `"${v}"`;
  const byId = new Map(reply.lines.map(l => [l.id, l]));
  const rows = [['supplier_gstin', 'invoice', 'action', 'reason', 'books_taxable_paise', 'gstr2b_taxable_paise'].join(','),
    ...reply.ims.map(entry => { const l = byId.get(entry.lineId)!; return [cell(l.supplier), cell(l.invoice), cell(entry.action), cell(entry.reason), digits(l.booksMinor ?? ''), digits(l.twoBMinor ?? '')].join(','); })];
  return { fileName: `ims-${reply.period.from}-to-${reply.period.to}.csv`, csv: rows.join('\r\n') + '\r\n' };
}
