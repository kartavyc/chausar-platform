/**
 * Round 4 Today reads and their projection (TD-01, TD-02, TD-03, PH-05).
 *
 * Reads `todayx.review`, `todayx.closeStatus` and `todayx.cash.week` once per authorized context,
 * checks each reply against its contract and keeps only a reply that passes; a missing method or a
 * reply that fails leaves that read `null`, so Today keeps its missing words. `projectRound4` joins
 * the checked replies into Today's data:
 *
 * - review: the approvals this seat may act on now and the documents from the phone join the core
 *   `today.*` rows, one per item; a summary row counts its items. Items the core already lists keep
 *   the core row (the duplicate is dropped), unless the core review list is unavailable. The count
 *   adds only when the core count is known; otherwise it stays unknown. In Books the joined items are
 *   the queue table instead, so nothing shows twice.
 * - waiting: the one quiet line for what waits on another person.
 * - close: the month's four close rows, each in the state the read model gave.
 * - cash: today's cash told by the owner and the week's seven bars; a day not told is
 *   "cash sales not captured", never zero.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, ChartValue, Count, Figure, Language, Mark, RowItem, View } from '../app/presentation.ts';
import type { PlaceRpc } from '../places/types.ts';
import type { BooksQueueRow, CloseStep, CloseStepState, TodayData } from '../screens/today/TodayData.ts';
import {
  CLOSE_STATUS_PARTS, isCashWeekReply, isCloseStatusReply, isTodayReviewReply,
  type CashWeekReply, type CloseStatusReply, type TodayReviewGroup, type TodayReviewItem, type TodayReviewReply,
} from '../bridge/todayx-contract.ts';
import { date } from '../format/dates.ts';
import { money } from '../format/money.ts';
import { count as countText } from '../format/counts.ts';
import en from '../text/en.json' with { type: 'json' };
import hi from '../text/hi.json' with { type: 'json' };
import { words as laneWords } from '../text/lanes/frame-today.ts';

export interface Round4Reads {
  readonly review: TodayReviewReply | null;
  readonly close: CloseStatusReply | null;
  readonly cash: CashWeekReply | null;
}
const EMPTY: Round4Reads = { review: null, close: null, cash: null };
const READS = [
  ['review', 'todayx.review', isTodayReviewReply],
  ['close', 'todayx.closeStatus', isCloseStatusReply],
  ['cash', 'todayx.cash.week', isCashWeekReply],
] as const;

/** The three reads for `key` (the authorized context). `reread` reads them again; `setCash` keeps a checked save reply. */
export function useRound4Reads(rpc: PlaceRpc, key: string): { reads: Round4Reads; reread: () => void; setCash: (reply: unknown) => boolean } {
  const [reads, setReads] = useState<Round4Reads>(EMPTY);
  const generation = useRef(0);
  const read = useCallback(() => {
    const mine = ++generation.current;
    for (const [field, method, valid] of READS) {
      rpc.request(method, {}).then(
        reply => { if (generation.current === mine) setReads(current => ({ ...current, [field]: valid(reply) ? reply : null })); },
        () => { if (generation.current === mine) setReads(current => ({ ...current, [field]: null })); },
      );
    }
  }, [rpc]);
  useEffect(() => { setReads(EMPTY); read(); return () => { generation.current++; }; }, [read, key]);
  const setCash = useCallback((reply: unknown) => { if (!isCashWeekReply(reply)) return false; setReads(current => ({ ...current, cash: reply })); return true; }, []);
  return { reads, reread: read, setCash };
}

/* ------------------------------------------------------------------ words */

const CATALOGUE: Readonly<Record<Language, Readonly<Record<string, string>>>> = { en: { ...en, ...laneWords.en }, hi: { ...hi, ...laneWords.hi } };
export function say(language: Language, key: string, values: Readonly<Record<string, string>> = {}): string {
  const template = CATALOGUE[language][key];
  if (template === undefined) throw new TypeError(`TEXT_KEY_MISSING ${key}`);
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token, name: string) => values[name] ?? token);
}

/* ------------------------------------------------------------------ row ids */

/** Row ids Today hands back through `onReview` / `onOpenQueueRow`. Kept apart from the core rows' ids. */
export const ROUND4_ROW = { approval: 'r4:approval:', group: 'r4:group:', document: 'r4:document:' } as const;
export type Round4Open =
  | { readonly kind: 'approval'; readonly id: string }
  | { readonly kind: 'group'; readonly ids: readonly string[] }
  | { readonly kind: 'document'; readonly documentId: string; readonly channel: 'whatsapp' | 'telegram' };
/** What a joined row opens, from the checked reply only. An id the reply does not hold opens nothing. */
export function round4Open(review: TodayReviewReply | null, rowId: string): Round4Open | null {
  if (review === null) return null;
  if (rowId.startsWith(ROUND4_ROW.approval)) {
    const id = rowId.slice(ROUND4_ROW.approval.length);
    return review.items.some(item => item.id === id) ? { kind: 'approval', id } : null;
  }
  if (rowId.startsWith(ROUND4_ROW.group)) {
    const group = review.groups.find(g => g.id === rowId.slice(ROUND4_ROW.group.length));
    return group ? { kind: 'group', ids: group.ids } : null;
  }
  if (rowId.startsWith(ROUND4_ROW.document)) {
    const doc = review.phoneDocuments.find(d => d.documentId === rowId.slice(ROUND4_ROW.document.length));
    return doc ? { kind: 'document', documentId: doc.documentId, channel: doc.channel } : null;
  }
  return null;
}

/* ------------------------------------------------------------------ projection */

export function groupWords(group: Pick<TodayReviewGroup, 'source' | 'kind' | 'ids'>, language: Language): string {
  const key = group.source === 'bill' ? 'FT4.group.bill' : group.kind === 'message' ? 'FT4.group.message' : group.kind === 'record-change' ? 'FT4.group.record-change' : 'FT4.group.other';
  return say(language, key, { count: countText(String(group.ids.length)) });
}
const sinceOf = (iso: string, language: Language) => date(iso.slice(0, 10), 'short', language);

/** Joined rows in two parts: `lead` (summary rows and documents, reachable only from Today) goes before the
 *  core rows; `tail` (single approvals, also listed in Work, Approvals) after them. At rest the screen shows
 *  four, so what only Today can open is never the part cut. */
function joinedRows(review: TodayReviewReply, withCore: boolean, language: Language): { lead: RowItem[]; tail: RowItem[] } {
  const lead: RowItem[] = [], tail: RowItem[] = [];
  for (const group of review.groups) lead.push({ id: `${ROUND4_ROW.group}${group.id}`, mark: 'you', what: groupWords(group, language), note: sinceOf(group.since, language), detail: say(language, 'FT4.group.detail'), can: ['review'] });
  for (const doc of review.phoneDocuments) lead.push({ id: `${ROUND4_ROW.document}${doc.documentId}`, mark: 'you', what: say(language, `FT4.review.document.${doc.channel}`),
    note: say(language, 'FT4.review.document.note'), detail: say(language, 'FT4.review.document.detail'), can: ['review'] });
  for (const i of review.items) if (withCore || !i.core) tail.push({ id: `${ROUND4_ROW.approval}${i.id}`, mark: 'you', what: i.title, note: say(language, 'FT4.review.approval.note'),
    ...(i.touches !== null ? { asWritten: i.touches } : {}), detail: say(language, 'FT4.review.approval.detail'), can: ['review'] });
  return { lead, tail };
}

function queueRows(review: TodayReviewReply, withCore: boolean, language: Language): BooksQueueRow[] {
  const rows: BooksQueueRow[] = [];
  for (const group of review.groups) rows.push({ id: `${ROUND4_ROW.group}${group.id}`, mark: 'you', what: groupWords(group, language), since: sinceOf(group.since, language), then: 'you' });
  for (const i of review.items) if (withCore || !i.core)
    rows.push({ id: `${ROUND4_ROW.approval}${i.id}`, mark: 'you', what: i.title, ...(i.touches !== null ? { party: i.touches } : { partyMissing: 'none' as const }), since: sinceOf(i.since, language), then: 'you' });
  for (const doc of review.phoneDocuments) rows.push({ id: `${ROUND4_ROW.document}${doc.documentId}`, mark: 'you', what: say(language, `FT4.review.document.${doc.channel}`), since: sinceOf(doc.receivedAt, language), then: 'you' });
  return rows;
}

const digits = (value: string | null | undefined): bigint | null => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
const countOf = (value: bigint): Count => ({ exact: value.toString(), display: countText(value.toString()) });

const CLOSE_MARK: Readonly<Record<CloseStepState, Mark>> = { done: 'cha', 'in-progress': 'busy', 'not-started': 'off', 'needs-you': 'you', 'not-applicable': 'off', 'not-loaded-yet': 'off', failed: 'unsure' };
const CLOSE_OPENS: Readonly<Record<(typeof CLOSE_STATUS_PARTS)[number], Address>> = {
  bank: { place: 'books', sub: 'sources' }, gstr2b: { place: 'ask', sub: 'saved', sheet: 'gst2b' }, tds: { place: 'books', sub: 'sources' }, 'trial-balance': { place: 'books', sub: 'sources' },
};
function monthName(month: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
}

function cashOf(cash: CashWeekReply, language: Language): NonNullable<TodayData['cash']> {
  const figure = (paise: string, entryId: string): Figure => ({ kind: 'money', exact: paise, display: money(paise), receiptId: entryId, labels: [] });
  const values: ChartValue[] = cash.days.map(d => ({
    id: `cash-${d.day}`, label: String(Number(d.day.slice(8))),
    value: d.paise !== null && d.entryId !== null ? figure(d.paise, d.entryId) : { kind: 'missing', missing: 'cash-not-captured' },
    ...(d.day === cash.day ? { emphasis: true } : {}),
  }));
  const today = cash.days[cash.days.length - 1];
  return { ...(today && today.paise !== null && today.entryId !== null ? { entered: figure(today.paise, today.entryId) } : {}), week: { form: 'columns', sentence: say(language, 'FT4.cash.week'), values } };
}

export interface Round4Context {
  readonly language: Language;
  readonly view: View;
  readonly role: 'owner' | 'cofounder' | 'accountant' | 'viewer';
  /** Opens a close row's page. */
  readonly navigate: (address: Address) => void;
}

export function projectRound4(base: TodayData, reads: Round4Reads, context: Round4Context): TodayData {
  const { language, view } = context;
  let data: TodayData = base;
  const review = reads.review;
  if (review !== null && (review.approvals === 'ready' || review.documents === 'ready')) {
    // The core list cannot be read: the approvals it would have listed are joined instead, so none is lost.
    const coreUnavailable = base.review.rows.length === 0 && (base.review.scoped === undefined ? base.review.count?.exact === null || base.review.count === undefined : base.review.scoped.completeness === 'unavailable');
    const coreJoined = coreUnavailable ? BigInt(review.items.filter(i => i.core).length) : 0n;
    const added = BigInt(review.count) + coreJoined;
    const known = base.review.scoped !== undefined ? (base.review.scoped.count === null ? null : BigInt(base.review.scoped.count)) : digits(base.review.count?.exact ?? null);
    const total = coreUnavailable ? added : known === null ? null : known + added;
    const count: Count | undefined = total === null ? base.review.count : countOf(total);
    if (view === 'books') {
      const { queueMissing: _queue, ...rest } = data;
      data = { ...rest, queue: queueRows(review, coreUnavailable, language), review: { ...base.review, ...(count ? { count } : {}) } };
    } else {
      const joined = joinedRows(review, coreUnavailable, language);
      data = { ...data, review: { ...base.review, rows: [...joined.lead, ...base.review.rows, ...joined.tail], ...(count ? { count } : {}) } };
    }
    const waiting = digits(review.waiting);
    if (waiting !== null && waiting > 0n) {
      data = { ...data, waiting: { holder: say(language, context.role === 'accountant' || context.role === 'viewer' ? 'FT4.waiting.owner' : 'FT4.waiting.other'), what: say(language, 'FT4.waiting.items', { count: countText(waiting.toString()) }) } };
    }
  }
  if (reads.close !== null) {
    const close = reads.close;
    const steps: CloseStep[] = CLOSE_STATUS_PARTS.map(part => {
      const state = close.parts[part];
      const opens = state === 'needs-you' || state === 'not-loaded-yet' || state === 'not-started' ? CLOSE_OPENS[part] : null;
      return { id: `close:${part}`, mark: CLOSE_MARK[state], step: part, state,
        ...(part === 'gstr2b' && close.notApplicable === 'composition' ? { notApplicable: 'composition' as const } : {}),
        ...(opens ? { action: { label: say(language, 'FT4.close.open'), onPress: () => context.navigate(opens) } } : {}) };
    });
    const { closeMissing: _close, ...rest } = data;
    data = { ...rest, close: { month: monthName(close.month, language), steps } };
  }
  if (reads.cash !== null) {
    const { cashMissing: _cash, ...rest } = data;
    data = { ...rest, cash: cashOf(reads.cash, language) };
  }
  return data;
}

/** The rail's count for Today: the joined count, only when it is known. */
export function todayRailCount(data: TodayData): Count | undefined {
  return data.review.count?.exact !== null && data.review.count !== undefined ? data.review.count : undefined;
}

/** Rupees as typed to whole paise; null when it is not a plain amount. No floating point. */
export { rupeesToPaise } from '../screens/first-run/journey-contracts.ts';
