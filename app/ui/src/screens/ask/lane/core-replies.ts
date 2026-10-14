/**
 * Reply shapes and validators for the core Ask screens: the menu, a typed question, an answer,
 * its receipt, its rows, what was sent, saved answers and the wanted list. The shapes follow
 * platform/runtime/ask/contracts.ts; the UI cannot import from the platform, so they are
 * written out here. Each validator throws for anything outside the contract.
 */
import { bool, date, fail, id, int, list, minor, obj, oneOf, optMinor, optPeriod, optStr, period, str, type Period } from './client.ts';

export const TOPICS = ['sales', 'collections', 'cash', 'stock', 'tax', 'other'] as const;
export type Topic = (typeof TOPICS)[number];
export const PERIOD_IDS = ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year'] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];
const NEEDS = ['period', 'comparePeriod', 'onDate', 'priceChange'] as const;
export type Need = (typeof NEEDS)[number];
const LABELS = ['seed', 'what-if', 'stale'] as const;
export type AnswerLabel = (typeof LABELS)[number];
export const GAPS = ['unreconciled', 'conflicts', 'missing-amounts', 'empty', 'costs-only'] as const;
export type Gap = (typeof GAPS)[number];
const COMPLETENESS = ['reconciled-imports', 'unreconciled-facts', 'empty', 'partial'] as const;
export type Completeness = (typeof COMPLETENESS)[number];
export type Unit = 'money' | 'basis-points';

export interface PeriodChoice { readonly id: PeriodId; readonly period: Period }
const periodChoice = (v: unknown): PeriodChoice => { const o = obj(v); return { id: oneOf(o.id, PERIOD_IDS), period: period(o.period) }; };
const label = (v: unknown) => str(v, 400);
const opRef = (v: unknown) => { const o = obj(v); return { operationId: id(o.operationId), label: label(o.label) }; };

export interface MenuItem { readonly operationId: string; readonly label: string; readonly type: string; readonly topic: Topic; readonly needs: readonly Need[]; readonly meaning: string | null }
export interface MenuReply {
  readonly state: 'ready' | 'no-dictionary';
  readonly seed: boolean;
  readonly dictionary: { readonly version: number; readonly pack: string; readonly label: string; readonly gstMode: 'regular' | 'composition' | 'unregistered' } | null;
  readonly topics: readonly { readonly topic: Topic; readonly items: readonly MenuItem[] }[];
  readonly gst2b: 'offered' | 'not-applicable';
  readonly today: string;
  readonly periods: readonly PeriodChoice[];
}
export function menuReply(value: unknown): MenuReply {
  const v = obj(value);
  const d = v.dictionary === null ? null : obj(v.dictionary);
  return {
    state: oneOf(v.state, ['ready', 'no-dictionary'] as const), seed: bool(v.seed),
    dictionary: d === null ? null : { version: int(d.version), pack: str(d.pack, 200), label: label(d.label), gstMode: oneOf(d.gstMode, ['regular', 'composition', 'unregistered'] as const) },
    topics: list(v.topics, t => {
      const o = obj(t), topic = oneOf(o.topic, TOPICS);
      return { topic, items: list(o.items, i => {
        const m = obj(i);
        return { operationId: id(m.operationId), label: label(m.label), type: str(m.type, 100), topic: oneOf(m.topic, TOPICS), needs: list(m.needs, n => oneOf(n, NEEDS), 8), meaning: optStr(m.meaning, 2000) };
      }, 500) };
    }, 20),
    gst2b: oneOf(v.gst2b, ['offered', 'not-applicable'] as const), today: date(v.today), periods: list(v.periods, periodChoice, 20),
  };
}

export interface Suggestion { readonly operationId: string; readonly label: string; readonly periodId: PeriodId; readonly asked: number; readonly why: 'asked-before' | 'starter' }
export function suggestReply(value: unknown): readonly Suggestion[] {
  return list(obj(value).suggestions, s => {
    const o = obj(s);
    return { operationId: id(o.operationId), label: label(o.label), periodId: oneOf(o.periodId, PERIOD_IDS), asked: int(o.asked), why: oneOf(o.why, ['asked-before', 'starter'] as const) };
  }, 50);
}

export interface Proposal { readonly operationId: string; readonly label: string; readonly period: Period; readonly periodId: PeriodId | null; readonly branch: string | null; readonly needs: readonly Need[] }
export type UnderstandReply =
  | { readonly kind: 'proposal'; readonly proposal: Proposal; readonly options: { readonly operations: readonly { operationId: string; label: string }[]; readonly periods: readonly PeriodChoice[]; readonly branches: readonly string[] } }
  | { readonly kind: 'choose'; readonly choices: readonly { operationId: string; label: string; meaning: string | null }[]; readonly periodId: PeriodId | null }
  | { readonly kind: 'no-match'; readonly reason: 'no-calculation' | 'unknown-word' | 'action'; readonly word: string | null; readonly nearby: readonly { operationId: string; label: string }[] }
  | { readonly kind: 'refused'; readonly code: string };
const code = (v: unknown) => { const c = str(v, 64); if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(c)) fail(); return c; };
const optPeriodId = (v: unknown): PeriodId | null => v === null ? null : oneOf(v, PERIOD_IDS);
export function understandReply(value: unknown): UnderstandReply {
  const v = obj(value);
  switch (v.kind) {
    case 'proposal': {
      const p = obj(v.proposal), o = obj(v.options);
      return {
        kind: 'proposal',
        proposal: { operationId: id(p.operationId), label: label(p.label), period: period(p.period), periodId: optPeriodId(p.periodId), branch: optStr(p.branch, 200), needs: list(p.needs, n => oneOf(n, NEEDS), 8) },
        options: { operations: list(o.operations, opRef, 50), periods: list(o.periods, periodChoice, 20), branches: list(o.branches, b => str(b, 200), 100) },
      };
    }
    case 'choose':
      return { kind: 'choose', choices: list(v.choices, c => { const o = obj(c); return { ...opRef(o), meaning: optStr(o.meaning, 2000) }; }, 10), periodId: optPeriodId(v.periodId) };
    case 'no-match':
      return { kind: 'no-match', reason: oneOf(v.reason, ['no-calculation', 'unknown-word', 'action'] as const), word: optStr(v.word, 200), nearby: list(v.nearby, opRef, 10) };
    case 'refused': return { kind: 'refused', code: code(v.code) };
    default: return fail();
  }
}

export interface AnswerFigure { readonly key: string; readonly label: string; readonly minor: string; readonly unit: Unit }
export type GuardMatch = { readonly figureKey: string } | { readonly field: 'rows' | 'excluded' | 'date' } | null;
export interface AnswerReply {
  readonly kind: 'answer';
  readonly answerId: string | null;
  readonly receiptId: string;
  readonly operationId: string;
  readonly label: string;
  readonly period: Period | null;
  readonly comparePeriod: Period | null;
  readonly branch: string | null;
  readonly asOf: string;
  readonly headline: string;
  readonly figures: readonly AnswerFigure[];
  readonly rows: { readonly read: number; readonly counted: number; readonly excluded: number };
  readonly completeness: Completeness;
  readonly gaps: readonly Gap[];
  readonly monthsNotLoaded: readonly string[];
  readonly labels: readonly AnswerLabel[];
  readonly explanation: { readonly source: 'template' | 'model'; readonly text: string; readonly replaced: boolean };
  readonly guard: { readonly status: 'passed' | 'replaced'; readonly lines: readonly { readonly number: string; readonly matched: GuardMatch }[] };
}
const figures = (v: unknown) => list(v, f => { const o = obj(f); return { key: str(o.key, 100), label: label(o.label), minor: minor(o.minor), unit: oneOf(o.unit, ['money', 'basis-points'] as const) }; }, 100);
const labels = (v: unknown) => list(v, l => oneOf(l, LABELS), 3);
const gaps = (v: unknown) => list(v, g => oneOf(g, GAPS), 5);
const month = (v: unknown) => { const m = str(v, 7); if (!/^\d{4}-\d{2}$/.test(m)) fail(); return m; };
const guardMatch = (v: unknown): GuardMatch => {
  if (v === null) return null;
  const o = obj(v);
  return 'figureKey' in o ? { figureKey: str(o.figureKey, 100) } : { field: oneOf(o.field, ['rows', 'excluded', 'date'] as const) };
};
const count = (v: unknown) => { const n = int(v); if (n < 0) fail(); return n; };
export function answerReply(value: unknown): AnswerReply {
  const v = obj(value);
  if (v.kind !== 'answer') fail();
  const r = obj(v.rows), e = obj(v.explanation), g = obj(v.guard);
  if (v.sent !== 'nothing') fail();
  return {
    kind: 'answer', answerId: v.answerId === null ? null : id(v.answerId), receiptId: id(v.receiptId), operationId: id(v.operationId), label: label(v.label),
    period: optPeriod(v.period), comparePeriod: optPeriod(v.comparePeriod), branch: optStr(v.branch, 200), asOf: date(v.asOf), headline: str(v.headline, 400),
    figures: figures(v.figures), rows: { read: count(r.read), counted: count(r.counted), excluded: count(r.excluded) },
    completeness: oneOf(v.completeness, COMPLETENESS), gaps: gaps(v.gaps), monthsNotLoaded: list(v.monthsNotLoaded, month, 240), labels: labels(v.labels),
    explanation: { source: oneOf(e.source, ['template', 'model'] as const), text: str(e.text, 8000), replaced: bool(e.replaced) },
    guard: { status: oneOf(g.status, ['passed', 'replaced'] as const), lines: list(g.lines, l => { const o = obj(l); return { number: str(o.number, 100), matched: guardMatch(o.matched) }; }, 200) },
  };
}

export type RunReply = AnswerReply | { readonly kind: 'refused'; readonly code: string } | { readonly kind: 'not-applicable'; readonly reason: 'composition' | 'unregistered' };
export function runReply(value: unknown): RunReply {
  const v = obj(value);
  if (v.kind === 'refused') return { kind: 'refused', code: code(v.code) };
  if (v.kind === 'not-applicable') return { kind: 'not-applicable', reason: oneOf(v.reason, ['composition', 'unregistered'] as const) };
  return answerReply(v);
}

export interface ReceiptReply {
  readonly receiptId: string; readonly operationId: string; readonly label: string;
  readonly chain: { readonly question: string | null; readonly calculation: string; readonly rowsRead: number; readonly totalChecked: boolean };
  readonly figures: readonly AnswerFigure[];
  readonly period: Period | null; readonly comparePeriod: Period | null; readonly asOf: string; readonly createdAt: string; readonly branch: string | null;
  readonly definitions: readonly { name: string; label: string; meaning: string; kind: string; field: string }[];
  readonly exclusions: readonly { reason: string; rows: number }[];
  readonly completeness: Completeness; readonly gaps: readonly Gap[];
  readonly sources: readonly { sourceId: string; wayIn: 'file' | 'interface' | 'entered'; format: string | null; recipe: { id: string; state: 'tested' | 'not-yet-tested'; hash: string } | null; rows: number }[];
  readonly versions: { readonly app: string | null; readonly dictionary: number; readonly dictionaryHash: string; readonly definitionHash: string; readonly recipes: readonly string[]; readonly calculator: string };
  readonly allowedBy: { readonly memberId: string; readonly role: string; readonly device: 'desktop' | 'phone' | 'mcp'; readonly at: string };
  readonly labels: readonly AnswerLabel[];
  readonly notCounted: number;
  readonly fx: readonly { from: string; to: string; rate: string; on: string | null }[];
  readonly sent: { readonly kind: 'nothing' } | { readonly kind: 'model'; readonly available: boolean };
}
export function receiptReply(value: unknown): ReceiptReply {
  const v = obj(value), c = obj(v.chain), ver = obj(v.versions), a = obj(v.allowedBy), s = obj(v.sent);
  return {
    receiptId: id(v.receiptId), operationId: id(v.operationId), label: label(v.label),
    chain: { question: optStr(c.question, 2000), calculation: label(c.calculation), rowsRead: count(c.rowsRead), totalChecked: bool(c.totalChecked) },
    figures: figures(v.figures), period: optPeriod(v.period), comparePeriod: optPeriod(v.comparePeriod), asOf: date(v.asOf), createdAt: date(v.createdAt), branch: optStr(v.branch, 200),
    definitions: list(v.definitions, d => { const o = obj(d); return { name: str(o.name, 200), label: label(o.label), meaning: str(o.meaning, 4000), kind: str(o.kind, 100), field: str(o.field, 200) }; }, 200),
    exclusions: list(v.exclusions, x => { const o = obj(x); return { reason: str(o.reason, 200), rows: count(o.rows) }; }, 100),
    completeness: oneOf(v.completeness, COMPLETENESS), gaps: gaps(v.gaps),
    sources: list(v.sources, x => {
      const o = obj(x), r = o.recipe === null ? null : obj(o.recipe);
      return { sourceId: id(o.sourceId), wayIn: oneOf(o.wayIn, ['file', 'interface', 'entered'] as const), format: optStr(o.format, 100), recipe: r === null ? null : { id: id(r.id), state: oneOf(r.state, ['tested', 'not-yet-tested'] as const), hash: str(r.hash, 200) }, rows: count(o.rows) };
    }, 200),
    versions: { app: optStr(ver.app, 100), dictionary: int(ver.dictionary), dictionaryHash: str(ver.dictionaryHash, 200), definitionHash: str(ver.definitionHash, 200), recipes: list(ver.recipes, r => str(r, 200), 100), calculator: str(ver.calculator, 100) },
    allowedBy: { memberId: str(a.memberId, 200), role: str(a.role, 100), device: oneOf(a.device, ['desktop', 'phone', 'mcp'] as const), at: date(a.at) },
    labels: labels(v.labels), notCounted: count(v.notCounted),
    fx: list(v.fx, x => { const o = obj(x); return { from: str(o.from, 10), to: str(o.to, 10), rate: str(o.rate, 60), on: o.on === null ? null : date(o.on) }; }, 50),
    sent: s.kind === 'nothing' ? { kind: 'nothing' } : s.kind === 'model' ? { kind: 'model', available: bool(s.available) } : fail(),
  };
}

export interface SourceRow { readonly rowId: string; readonly sourceId: string; readonly sourceRow: number | null; readonly cells: readonly { name: string; value: string }[]; readonly amountMinor: string | null; readonly reason: string | null }
export interface SourceRowsReply { readonly tab: 'counted' | 'left-out'; readonly total: number; readonly offset: number; readonly rows: readonly SourceRow[]; readonly hidden: boolean }
export function sourceRowsReply(value: unknown): SourceRowsReply {
  const v = obj(value);
  return {
    tab: oneOf(v.tab, ['counted', 'left-out'] as const), total: count(v.total), offset: count(v.offset), hidden: bool(v.hidden),
    rows: list(v.rows, r => {
      const o = obj(r);
      return { rowId: id(o.rowId), sourceId: id(o.sourceId), sourceRow: o.sourceRow === null ? null : count(o.sourceRow), cells: list(o.cells, c => { const x = obj(c); return { name: str(x.name, 200), value: str(x.value, 4000) }; }, 200), amountMinor: optMinor(o.amountMinor), reason: optStr(o.reason, 200) };
    }, 500),
  };
}

export type SentReply =
  | { readonly kind: 'nothing'; readonly why: 'menu' | 'no-model-record' }
  | { readonly kind: 'sent'; readonly routeId: string; readonly sendLevel: string; readonly bytes: number; readonly costMinor: string | null; readonly text: string | null; readonly digest: string; readonly removed: boolean; readonly at: string; readonly boundary: string };
export function sentReply(value: unknown): SentReply {
  const v = obj(value);
  if (v.kind === 'nothing') return { kind: 'nothing', why: oneOf(v.why, ['menu', 'no-model-record'] as const) };
  if (v.kind !== 'sent') fail();
  return { kind: 'sent', routeId: str(v.routeId, 200), sendLevel: str(v.sendLevel, 100), bytes: count(v.bytes), costMinor: optMinor(v.costMinor), text: optStr(v.text, 200000), digest: str(v.digest, 200), removed: bool(v.removed), at: date(v.at), boundary: str(v.boundary, 200) };
}

export const SAVED_KINDS = ['answer', 'why', 'what-if', 'forecast'] as const;
export type SavedKind = (typeof SAVED_KINDS)[number];
export type StaleReason = 'meaning-changed' | 'books-changed' | 'access-changed' | 'new-rows';
export interface SavedEntry {
  readonly id: string; readonly kind: SavedKind; readonly question: string | null; readonly operationId: string | null; readonly savedAt: string;
  readonly receiptId: string | null; readonly refId: string | null; readonly headline: { readonly kind: Unit; readonly minor: string } | null; readonly workedOutAt: string | null;
  readonly deletedOn: string | null; readonly stale: null | { readonly reason: StaleReason; readonly since: string | null }; readonly rebuildable: boolean;
}
export function savedReply(value: unknown): readonly SavedEntry[] {
  return list(obj(value).items, i => {
    const o = obj(i), h = o.headline === null ? null : obj(o.headline), st = o.stale === null ? null : obj(o.stale);
    return {
      id: id(o.id), kind: oneOf(o.kind, SAVED_KINDS), question: optStr(o.question, 2000), operationId: o.operationId === null ? null : id(o.operationId), savedAt: date(o.savedAt),
      receiptId: o.receiptId === null ? null : id(o.receiptId), refId: o.refId === null ? null : id(o.refId),
      headline: h === null ? null : { kind: oneOf(h.kind, ['money', 'basis-points'] as const), minor: minor(h.minor) }, workedOutAt: o.workedOutAt === null ? null : date(o.workedOutAt),
      deletedOn: o.deletedOn === null ? null : date(o.deletedOn),
      stale: st === null ? null : { reason: oneOf(st.reason, ['meaning-changed', 'books-changed', 'access-changed', 'new-rows'] as const), since: st.since === null ? null : date(st.since) },
      rebuildable: bool(o.rebuildable),
    };
  }, 2000);
}

export interface WantedReply {
  readonly calculations: readonly { text: string; count: number; lastAt: string }[];
  readonly actions: readonly { text: string; count: number; lastAt: string }[];
  readonly words: readonly { word: string; count: number; lastAt: string }[];
}
export function wantedReply(value: unknown): WantedReply {
  const v = obj(value);
  const entry = (x: unknown) => { const o = obj(x); return { text: str(o.text, 2000), count: count(o.count), lastAt: date(o.lastAt) }; };
  return { calculations: list(v.calculations, entry, 1000), actions: list(v.actions, entry, 1000), words: list(v.words, x => { const o = obj(x); return { word: str(o.word, 200), count: count(o.count), lastAt: date(o.lastAt) }; }, 1000) };
}

export const savedId = (value: unknown) => ({ id: id(obj(value).id) });
export const rebuilt = (value: unknown) => { const v = obj(value); return { id: id(v.id), receiptId: id(v.receiptId) }; };
