// Chausar venture launcher, money (Ink v2 wave 4, package 4I1; W3's U1 ranking): the next best step and the morning
// briefing, from Today's waiting rows. A row's money at stake comes only from a stored receipt in the business's own
// currency (its change, then its price, then its paper preview): never from a model, an estimate or text on the row.
// Rows rank by that money, most first; then by the nearest real deadline; then in Today's own order. Rows without money
// come after rows with money. The step is the first ranked row whose primary action the owner takes (never Not now,
// Read or Watch in its place), said as that action inside the app; Chausar does nothing on its own here. "Goal after"
// is code: what the month's goal reads once that draft invoice is issued.
import { type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { listRecords } from '../records.ts';
import type { MoneyFigureView, NextBestStep, QueueAction, QueueRow, VentureRecord } from '../contracts.ts';
import { beforeTax } from './goal-plans.ts';

/** The most rows the briefing names before it says how many more there are. */
export const BRIEFING_MAX = 6;

/** What a row puts at stake, from its receipt: the amount in minor units and the figure the screen shows. */
export type Stake = { amount: bigint; figure: MoneyFigureView };
export type RankedRow = { row: QueueRow; stake: Stake | null; deadline: number | null };
/** The month's goal and what it has invoiced so far, before tax, for "Goal after". */
export type GoalProgress = { month: string; goalMinor: bigint; invoicedMinor: bigint };

/** The amount behind one receipt id, when it is a price receipt or a sum receipt in minor units of the business's currency. */
function receiptAmount(state: State, venture: VentureRecord, receiptId: string): Stake | null {
  const currency = venture.country.currency;
  const price = listRecords(state, 'venture-price-receipt', venture.id).find(record => record.id === receiptId);
  if (price) {
    if (price.currency !== currency || price.stale) return null;
    const amount = BigInt(price.totalMinor);
    return amount > 0n ? { amount, figure: { display: formatMinor(amount, currency), receiptId } } : null;
  }
  const sum = listRecords(state, 'venture-sum-receipt', venture.id).find(record => record.id === receiptId);
  if (!sum || sum.unit !== 'minor' || sum.currency !== currency || sum.estimate) return null;
  const amount = BigInt(sum.totalMinor);
  return amount > 0n ? { amount, figure: { display: formatMinor(amount, currency), receiptId } } : null;
}

/** A row's money at stake: its change's receipt (not an estimate), else its price's, else its paper preview's total; or null. */
export function stakeOf(state: State, venture: VentureRecord, row: QueueRow): Stake | null {
  const ids: string[] = [];
  if (row.change?.receiptId && row.change.estimate !== true) ids.push(row.change.receiptId);
  if (row.price?.receiptId) ids.push(row.price.receiptId);
  // 4J3: only an invoice's paper has a total; a CA paper's working figures are not money the owner is paid.
  if (row.preview?.kind === 'paper' && row.preview.paper === 'invoice') ids.push(row.preview.total.receiptId);
  for (const id of ids) {
    const stake = receiptAmount(state, venture, id);
    if (stake) return stake;
  }
  return null;
}

/** A row's real deadline as milliseconds: only the expiry its meta carries (4J1 sets it from a real expiry, never invented). */
function deadlineOf(row: QueueRow): number | null {
  const at = row.meta?.expiresAt ? Date.parse(row.meta.expiresAt) : NaN;
  return Number.isFinite(at) ? at : null;
}

/** Today's rows in the order the next step reads them: money at stake, most first; then the nearest deadline; then Today's order. */
export function rankedRows(state: State, venture: VentureRecord, rows: readonly QueueRow[]): RankedRow[] {
  const ranked = rows.map((row, index) => ({ row, stake: stakeOf(state, venture, row), deadline: deadlineOf(row), index }));
  ranked.sort((a, b) => {
    if ((a.stake === null) !== (b.stake === null)) return a.stake === null ? 1 : -1;
    if (a.stake && b.stake && a.stake.amount !== b.stake.amount) return a.stake.amount > b.stake.amount ? -1 : 1;
    if ((a.deadline === null) !== (b.deadline === null)) return a.deadline === null ? 1 : -1;
    if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline) return a.deadline - b.deadline;
    return a.index - b.index;
  });
  return ranked.map(({ row, stake, deadline }) => ({ row, stake, deadline }));
}

/** Primary actions that are not a step the owner takes: putting it off, reading it, watching it run. */
const NOT_A_STEP: readonly QueueAction['id'][] = ['later', 'read', 'watch'];

/** The row's primary action when it is one the owner takes; never another action in its place. */
function stepAction(row: QueueRow): QueueAction | null {
  const primary = row.actions.find(action => action.primary);
  return primary && !NOT_A_STEP.includes(primary.id) ? primary : null;
}

/**
 * The owner's action on the row, in one plain sentence: open it first when there is something to look at. Approvals
 * happen inside the app, so off the app channel (the phone, MCP) it says to open it in the app.
 */
function actionLine(row: QueueRow, primary: QueueAction, inApp: boolean): string {
  if (!inApp) return `Open it in the app, then choose ${primary.label}.`;
  return primary.requiresView || row.viewRef ? `Open it, then choose ${primary.label}.` : `Choose ${primary.label}.`;
}

/** The goal's whole percent once a draft invoice dated in the goal's month is issued, floored; or null. */
function goalAfterPercent(state: State, venture: VentureRecord, row: QueueRow, progress: GoalProgress | null): number | null {
  if (!progress || progress.goalMinor <= 0n || row.kind !== 'invoice' || row.viewRef?.kind !== 'file') return null;
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === row.viewRef!.id);
  if (!invoice || invoice.status !== 'draft' || invoice.currency !== venture.country.currency || invoice.issueDate?.slice(0, 7) !== progress.month) return null;
  const after = progress.invoicedMinor + beforeTax(invoice);
  return after > 0n ? parseInt((after * 100n / progress.goalMinor).toString(), 10) : 0;
}

/**
 * The next best step (the first ranked row whose primary action the owner takes) and the briefing (the first six
 * ranked rows, with how many more there are). No rows gives neither; rows with no such action give a briefing only.
 */
export function nextBestStep(
  state: State, venture: VentureRecord, rows: readonly QueueRow[], progress: GoalProgress | null, options: { inApp: boolean },
): { next: NextBestStep | null; briefing: { rowIds: string[]; more: number } | null } {
  const ranked = rankedRows(state, venture, rows);
  if (!ranked.length) return { next: null, briefing: null };
  const chosen = ranked.find(item => stepAction(item.row) !== null);
  const after = chosen ? goalAfterPercent(state, venture, chosen.row, progress) : null;
  const next: NextBestStep | null = chosen ? {
    rowId: chosen.row.id, title: chosen.row.title, agent: chosen.row.agent ?? null, line: actionLine(chosen.row, stepAction(chosen.row)!, options.inApp),
    figure: chosen.stake?.figure ?? null, goalAfter: after === null ? null : `Goal after: ${after}%`, goalAfterPercent: after,
  } : null;
  const named = ranked.slice(0, BRIEFING_MAX).map(item => item.row.id);
  return { next, briefing: { rowIds: named, more: ranked.length - named.length } };
}
