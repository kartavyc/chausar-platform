// C5 task 17: the monthly pack for the CA, a standing order the owner approves once and can turn off. On the 1st, from
// the journal sweep (build/journal-sweep.ts), last month's CA files go into Chausar's own exports folder, a local write
// only, and one Today row says they are ready, with Send to my CA (money/accountant.ts, app/desktop/pack-share.cjs) and
// Show in folder. Nothing leaves this computer until the owner sends it. A month that turned while Chausar was closed is
// made once, the newest only; a host with no folder (the hosted app) makes none.
import { check, type Context, type State } from '../../contracts.ts';
import type { CaPackOrderRecord, CaPackRecord, QueueAction, VentureDeps, VentureRecord } from '../contracts.ts';
import { nextOccurrence, occurrencesBetween, wall, type RoutineSchedule } from '../agents/routine-time.ts';
import { recordDecision } from '../journal/decisions.ts';
import { ventureTimeZone } from '../local-day.ts';
import { currentVenture, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { monthFile } from './export.ts';
import { monthText } from './goal-plans.ts';

export type CaPackScheduleView = { on: boolean; at: string | null; next: string | null };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Midnight on the 1st in the business's own zone. */
const scheduleOf = (venture: Pick<VentureRecord, 'country'>): RoutineSchedule => ({ kind: 'monthly', day: 1, time: '00:00', timeZone: ventureTimeZone(venture.country) });

const orderOf = (state: State, venture: VentureRecord) => listRecords(state, 'venture-ca-pack-order', venture.id).at(-1);

function scheduleView(state: State, venture: VentureRecord, nowMs: number): CaPackScheduleView {
  const order = orderOf(state, venture);
  const on = order?.on === true;
  return { on, at: order?.at ?? null, next: on ? nextOccurrence(scheduleOf(venture), nowMs) : null };
}

/** venture.accountant.schedule.get {} (read). */
export async function caPackScheduleGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaPackScheduleView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return scheduleView(state, venture, deps.clock().getTime());
}

/** venture.accountant.schedule.set { on } (approve, app only): the standing order, recorded as the owner's decision. */
export async function caPackScheduleSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaPackScheduleView> {
  requireAppChannel(ctx, 'venture.accountant.schedule.set');
  const body = exactPayload(payload, ['on'], ['on']);
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'Send on as true or false.');
  return ventureAction(deps, ctx, 'approve', 'accountant.schedule', tx => {
    const venture = tx.venture!;
    if ((orderOf(tx.state, venture)?.on === true) !== body.on) {
      tx.put<CaPackOrderRecord>({ ...tx.base('venture-ca-pack-order'), on: body.on as boolean });
      recordDecision(tx, { subject: 'ca-pack:schedule', action: 'monthly pack for your CA', ruleId: null, rowId: null,
        reason: body.on ? 'Save last month\'s files for your CA on the 1st of each month.' : 'Stop saving a monthly pack for your CA.' });
    }
    return scheduleView(tx.state, venture, deps.clock().getTime());
  });
}

/** venture.accountant.pack.done { month } (prepare, app only): the owner sent that month, so its row leaves Today. */
export async function caPackDone(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ done: boolean }> {
  requireAppChannel(ctx, 'venture.accountant.pack.done');
  const body = exactPayload(payload, ['month'], ['month']);
  const month = monthText(body.month);
  const { state, venture } = readVenture(deps, ctx);
  if (!listRecords(state, 'venture-ca-pack', venture.id).some(pack => pack.month === month && pack.doneAt === null)) return { done: false };
  return ventureAction(deps, ctx, 'prepare', 'accountant.pack.done', tx => {
    const pack = tx.list('venture-ca-pack').find(item => item.month === month && item.doneAt === null);
    if (!pack) return { done: false };
    tx.replace<CaPackRecord>({ ...pack, doneAt: tx.now });
    tx.emit('queue.changed', { packId: pack.id });
    return { done: true };
  });
}

/** The month before the occurrence, as YYYY-MM in the business's own zone. */
function monthBefore(atMs: number, timeZone: string): string {
  const { y, m } = wall(atMs, timeZone);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** From the sweep: makes the pack that is due, once. Never throws: a pack that can't be made now is tried at the next sweep. */
export async function runCaPackDue(deps: VentureDeps, ctx: Context): Promise<void> {
  try {
    const state = deps.store.read();
    const venture = currentVenture(state);
    const keepFile = deps.workspace?.keepFile;
    if (!venture || !keepFile) return;
    const order = orderOf(state, venture);
    if (order?.on !== true) return;
    const schedule = scheduleOf(venture);
    const { latest } = occurrencesBetween(schedule, Date.parse(order.at), deps.clock().getTime());
    if (!latest) return;
    const month = monthBefore(Date.parse(latest), ventureTimeZone(venture.country));
    if (listRecords(state, 'venture-ca-pack', venture.id).some(pack => pack.month === month)) return;
    const made = await monthFile(deps, ctx, month);
    const file = await keepFile(`ca-${month}.csv`, made.file.csv);
    if (file === null) return;
    if (made.file.receipts) await keepFile(`ca-${month}-receipts.json`, `${JSON.stringify(made.file.receipts, null, 2)}\n`);
    await ventureAction(deps, ctx, 'prepare', 'accountant.pack', tx => {
      if (tx.list('venture-ca-pack').some(pack => pack.month === month)) return;
      tx.put<CaPackRecord>({ ...tx.base('venture-ca-pack'), month, file, what: made.what, doneAt: null });
      tx.emit('queue.changed', { month });
    });
  } catch { /* The next sweep tries again; the pack is never half recorded, since the record goes last. */ }
}

/** Today's row: the newest pack the owner has not sent. */
export function caPackRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const pack = listRecords(state, 'venture-ca-pack', venture.id).at(-1);
  if (!pack || pack.doneAt !== null) return [];
  const name = MONTH_NAMES[parseInt(pack.month.slice(5, 7), 10) - 1];
  const action = (id: QueueAction['id'], label: string, primary: boolean): QueueAction => ({ id, label, primary });
  return [{
    kind: 'notice', subject: `ca-pack:${pack.month}`, version: pack.id, createdAt: pack.at,
    title: `${name}'s pack for your CA is ready`,
    line: `${pack.what.charAt(0).toUpperCase()}${pack.what.slice(1)}. It is saved on this computer. Nothing goes to your CA until you send it.`,
    notice: { probe: 'ca-pack', severity: 'low', link: `#/money?sheet=accountant:${pack.month}`, file: pack.file },
    actions: [action('later', 'Not now', false), action('show-file', 'Show in folder', false), action('open', 'Send to my CA', true)],
    navigate: 'Open Send to my CA from the row.',
  }];
}
