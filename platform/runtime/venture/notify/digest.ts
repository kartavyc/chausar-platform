// Chausar venture launcher, notify (Ink v2 wave 4, package 4G1; spec 5.7, catalogue O12): the daily digest. Code, never
// a model, writes one a day at the hour the owner chose, in the business's time zone: "Today: 5 need you (3 to approve,
// 2 questions). 2 runs finished. INR 18,880.00 is ready to invoice." or "Nothing needs you today.". Counts are counted
// from records the digest names (the notifications it lists, the runs that finished); money comes only from a sum
// receipt (money/sums.ts), and a figure with no receipt is left out. An item already in an earlier digest is not listed
// again, only counted as still waiting. The centre (centre.ts) decides when one is due and writes it.
import { type State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import { localDayAt, localTimeAt } from '../local-day.ts';
import { currentPlan, planEstimate, planTotal, type SumPlan } from '../money/sums.ts';
import type {
  CountryProfile, IsoDate, IsoTime, NotificationRecord, NotificationView, NotifyDigestRecord, NotifyDigestView, QueueActionId, QueueKind, VentureRecord,
} from '../contracts.ts';
import type { NotifySettings } from './settings.ts';

/** What one waiting item counts as in the digest line. */
export type DigestKind = 'approve' | 'question' | 'setup' | 'look';

const DECISIONS: ReadonlySet<QueueActionId> = new Set<QueueActionId>(['approve', 'issue', 'send-to-ca', 'sent', 'continue', 'resume', 'stop']);
const SETUP: ReadonlySet<QueueActionId> = new Set<QueueActionId>(['connect', 'set-prices', 'keep']);
const ORDER: readonly DigestKind[] = ['approve', 'question', 'setup', 'look'];
const PART: Readonly<Record<DigestKind, (n: number) => string>> = {
  approve: n => `${n} to approve`, question: n => `${n} ${n === 1 ? 'question' : 'questions'}`, setup: n => `${n} to set up`, look: n => `${n} to look at`,
};
const DAY_MS = 24 * 3_600_000;

/** A row the owner answers is a question; setup is setup; a row with a decision is to approve; the rest is to look at. */
export function digestKind(row: { kind: QueueKind; actions: readonly { id: QueueActionId }[] }): DigestKind {
  const ids = row.actions.map(action => action.id);
  if (row.kind === 'question' || ids.includes('answer')) return 'question';
  if (row.kind === 'setup' || ids.some(id => SETUP.has(id))) return 'setup';
  if (ids.some(id => DECISIONS.has(id))) return 'approve';
  return 'look';
}

/** The digest's words, from counts code made and a money figure already on a receipt. */
export function digestLine(input: { kinds: readonly DigestKind[]; stillWaiting: number; runsFinished: number; ready: string | null }): string {
  const total = input.kinds.length;
  const sentences: string[] = [];
  if (!total) sentences.push('Nothing needs you today.');
  else {
    const parts = ORDER.map(kind => [kind, input.kinds.filter(item => item === kind).length] as const).filter(([, n]) => n > 0).map(([kind, n]) => PART[kind](n));
    sentences.push(`Today: ${total} ${total === 1 ? 'needs' : 'need'} you (${parts.join(', ')}).`);
    if (input.stillWaiting > 0) sentences.push(input.stillWaiting === 1 ? '1 of them is still waiting from before.' : `${input.stillWaiting} of them are still waiting from before.`);
  }
  if (input.runsFinished > 0) sentences.push(`${input.runsFinished} ${input.runsFinished === 1 ? 'run' : 'runs'} finished.`);
  if (input.ready) sentences.push(`${input.ready} is ready to invoice.`);
  return sentences.join(' ');
}

/**
 * The day a digest is due for, or null: the owner keeps a digest hour, that hour has come on the owner's calendar,
 * today has none yet, and the business was not made today.
 */
export function digestDueDay(settings: Pick<NotifySettings, 'digest'>, now: IsoTime, country: Pick<CountryProfile, 'code'>, ventureAt: IsoTime, digests: readonly NotifyDigestRecord[]): IsoDate | null {
  if (!settings.digest) return null;
  const today = localDayAt(now, country);
  if (localDayAt(ventureAt, country) === today || digests.some(record => record.day === today)) return null;
  return Number(localTimeAt(now, country).slice(11, 13)) >= settings.digest.hour ? today : null;
}

/** The newest digest, or null. */
export function latestDigest(digests: readonly NotifyDigestRecord[]): NotifyDigestRecord | null {
  return [...digests].sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
}

/** The runs that finished (run.done in the event log) after one moment and up to another, each once. */
export function finishedRuns(state: State, ventureId: string, after: IsoTime, upTo: IsoTime): string[] {
  const ids = listRecords(state, 'venture-event', ventureId)
    .filter(event => event.name === 'run.done' && event.at > after && event.at <= upTo)
    .sort((a, b) => a.seq - b.seq)
    .map(event => (event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? (event.data as { runId?: unknown }).runId : undefined))
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)];
}

/** Since when the digest counts finished runs: the last digest, else one day back. */
export function digestSince(previous: NotifyDigestRecord | null, now: IsoTime): IsoTime {
  return previous?.at ?? new Date(Date.parse(now) - DAY_MS).toISOString();
}

/**
 * Money ready to invoice this month before tax (4I1's invoiced plan, drafts ready to issue), as a plan for a sum
 * receipt; null when it is nothing, holds an estimate, or its plan is not built yet.
 */
export function readyToInvoicePlan(state: State, venture: VentureRecord, month: string): SumPlan | null {
  try {
    const plan = currentPlan(state, venture, { type: 'invoiced', month, which: 'ready' });
    return planTotal(plan) > 0n && !planEstimate(plan) ? plan : null;
  } catch {
    return null;
  }
}

/** One notification as the centre shows it. */
export function notificationView(record: NotificationRecord): NotificationView {
  return { id: record.id, rowId: record.rowId, kind: record.rowKind, title: record.title, at: record.at, read: record.readAt !== null };
}

/** A digest as the centre shows it: the items it listed for the first time, and the receipts behind its money. */
export function digestView(record: NotifyDigestRecord, notifications: readonly NotificationRecord[]): NotifyDigestView {
  const byId = new Map(notifications.map(item => [item.id, item]));
  return {
    id: record.id, day: record.day, at: record.at, line: record.line,
    items: record.listed.map(id => byId.get(id)).filter((item): item is NotificationRecord => !!item).map(notificationView),
    stillWaiting: record.stillWaiting, receiptIds: record.ready ? [record.ready.receiptId] : [],
  };
}
