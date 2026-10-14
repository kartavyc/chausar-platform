/**
 * AS-19: purchases against GSTR-2B. The purchase register (facts of kind `purchase`) is matched
 * with the suppliers' filed lines (facts of kind `gstr2b`, as imported from the GSTR-2B file) by
 * supplier GSTIN and invoice number. Each pair is matched, differs inside or outside the
 * tolerance you set, or is on one side only. The IMS list says what a person should accept,
 * reject or keep pending in the GST portal, with the reason.
 *
 * Chausar never acts in the GST portal. Amounts are exact paise; the difference is a BigInt.
 */
import { check, hash, type Context, type Fact } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canSeeFact, type Period } from '../memory.ts';
import type { Gst2bGroup, Gst2bLineReply, Gst2bReply } from './contracts.ts';
import { askState, asText, businessToday, currentDictionary, input, minorString, namedPeriod, peekAsk, period, requireId } from './shared.ts';

export const BOOK_KIND = 'purchase';
export const TWO_B_KINDS: readonly string[] = ['gstr2b', 'gstr-2b'];
const MONEY = /^-?\d+$/;

type Line = { id: string; group: Gst2bGroup; supplier: string; invoice: string; books: Fact | null; twoB: Fact | null; booksMinor: bigint | null; twoBMinor: bigint | null; booksTax: bigint; twoBTax: bigint };

const key = (fact: Fact) => `${asText(fact.fields.gstin ?? fact.fields.supplierGstin).trim().toUpperCase()}|${asText(fact.fields.invoiceId ?? fact.fields.invoiceNumber).trim().toUpperCase()}`;
const amount = (fact: Fact, field: string) => { const value = fact.fields[field]; return typeof value === 'string' && MONEY.test(value) ? BigInt(value) : 0n; };
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
      const booksTax = b ? amount(b, 'taxMinor') : 0n, twoBTax = t ? amount(t, 'taxMinor') : 0n;
      let group: Gst2bGroup;
      if (!t) group = 'books-only';
      else if (!b) group = 'in-2b-only';
      else if (booksMinor === twoBMinor && booksTax === twoBTax) group = 'matched';
      else group = abs(booksMinor! - twoBMinor!) <= tolerance && abs(booksTax - twoBTax) <= tolerance ? 'differs-inside' : 'differs-outside';
      lines.push({ id: `gst_${hash([k, i]).slice(0, 24)}`, group, supplier, invoice, books: b, twoB: t, booksMinor, twoBMinor, booksTax, twoBTax });
    }
  }
  return lines;
}

function scope(ctx: Context, payload: unknown, host: ModuleHost, extra: string[] = []) {
  const request = input(payload, ['period', 'periodId', 'today', ...extra], extra);
  const p: Period = request.period !== undefined ? period(request.period) : namedPeriod(request.periodId ?? 'last-month', businessToday(host, request.today));
  return { request, p };
}
function load(ctx: Context, host: ModuleHost, p: Period) {
  const state = host.store.read(), within = (f: Fact) => !f.deletedAt && !f.supersededAt && f.validFrom >= p.from && f.validFrom <= p.to && canSeeFact(host.store, ctx, f);
  return { books: state.facts.filter(f => f.kind === BOOK_KIND && within(f)), twoB: state.facts.filter(f => TWO_B_KINDS.includes(f.kind) && within(f)), tolerance: BigInt(peekAsk(state).gst.toleranceMinor) };
}

export function gst2b(ctx: Context, payload: unknown, host: ModuleHost): Gst2bReply {
  const { p } = scope(ctx, payload, host);
  const dictionary = currentDictionary(host, ctx);
  check(dictionary, 'ASK_NO_DICTIONARY', 'Publish what your words mean before asking for numbers.');
  if (dictionary.gstMode !== 'regular') return { state: 'not-applicable', reason: dictionary.gstMode };
  const { books, twoB, tolerance } = load(ctx, host, p);
  if (!twoB.length) return { state: 'not-loaded', period: p };
  const lines = matchLines(books, twoB, tolerance);
  const groups = (['matched', 'differs-inside', 'differs-outside', 'in-2b-only', 'books-only'] as const).map(group => {
    const these = lines.filter(l => l.group === group);
    // A group's amount is the books' side where it exists, else the 2B side.
    return { group, count: these.length, taxableMinor: String(these.reduce((s, l) => s + (l.booksMinor ?? l.twoBMinor ?? 0n), 0n)), taxMinor: String(these.reduce((s, l) => s + (l.books ? l.booksTax : l.twoBTax), 0n)) };
  });
  return {
    state: 'ready', period: p, toleranceMinor: String(tolerance), via: 'facts', groups,
    lines: lines.map(l => ({ id: l.id, group: l.group, supplier: l.supplier, invoice: l.invoice, booksMinor: l.booksMinor === null ? null : String(l.booksMinor), twoBMinor: l.twoBMinor === null ? null : String(l.twoBMinor),
      differenceMinor: l.booksMinor !== null && l.twoBMinor !== null ? String(l.twoBMinor - l.booksMinor) : null, bookRowId: l.books?.id ?? null, twoBRowId: l.twoB?.id ?? null })),
    ims: lines.filter(l => l.twoB).map(l => ({ lineId: l.id, action: l.group === 'in-2b-only' ? 'pending' as const : l.group === 'differs-outside' ? 'reject' as const : 'accept' as const,
      reason: l.group === 'in-2b-only' ? 'not-in-books' as const : l.group === 'differs-outside' ? 'amount-differs' as const : 'matched' as const })),
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
export function line(ctx: Context, payload: unknown, host: ModuleHost): Gst2bLineReply {
  const { request, p } = scope(ctx, payload, host, ['lineId']);
  const id = requireId(request.lineId), { books, twoB, tolerance } = load(ctx, host, p);
  const found = matchLines(books, twoB, tolerance).find(l => l.id === id);
  check(found, 'ASK_NOT_FOUND', 'This line is no longer in the match.');
  const side = (f: Fact | null) => f ? { rowId: f.id, sourceId: f.sourceId, sourceRow: f.sourceRow ?? null, cells: cellsOf(f) } : null;
  return { id, group: found.group, books: side(found.books), twoB: side(found.twoB), rule: { toleranceMinor: String(tolerance), key: 'supplier-gstin-and-invoice' } };
}

/** The IMS list as CSV for a person to act on in the portal. Cells from files are quoted, and a
 *  leading formula character is neutralised so a spreadsheet cannot run it. */
export function exportIms(ctx: Context, payload: unknown, host: ModuleHost) {
  const reply = gst2b(ctx, payload, host);
  check(reply.state === 'ready', 'ASK_NOT_FOUND', 'There is no IMS list for this period.');
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replaceAll('"', '""')}"`;
  const byId = new Map(reply.lines.map(l => [l.id, l]));
  const rows = [['supplier_gstin', 'invoice', 'action', 'reason', 'books_taxable_paise', 'gstr2b_taxable_paise'].join(','),
    ...reply.ims.map(entry => { const l = byId.get(entry.lineId)!; return [l.supplier, l.invoice, entry.action, entry.reason, l.booksMinor ?? '', l.twoBMinor ?? ''].map(cell).join(','); })];
  return { fileName: `ims-${reply.period.from}-to-${reply.period.to}.csv`, csv: rows.join('\r\n') + '\r\n' };
}
