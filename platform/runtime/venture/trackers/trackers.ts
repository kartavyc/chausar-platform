// C7 task 17: trackers the owner makes (a content calendar, GST due dates), kept as records of this business. Making,
// changing and removing a tracker is standing configuration: approve, in the app. Rows are the owner's to add, edit and
// remove; agents that keep a tracker may add rows only (agent-rows.ts), each marked with the agent's name and an Undo.
// Limits: 20 trackers, 12 columns, 1,000 rows. Money gets in only as a receipt cell or an estimate cell (cells.ts).
import { check, type Context, type State } from '../../contracts.ts';
import type { RecordBase, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, identifier, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { removeRecords } from '../network/people.ts';
import { teamAgents } from '../chief/routing.ts';
import { TRACKER_LIMITS, cellView, checkCell, checkColumns, type CellView, type TrackerCell, type TrackerColumn } from './cells.ts';

export type TrackerRecord = RecordBase<'venture-tracker'> & { name: string; columns: TrackerColumn[]; boardBy: string | null; keptBy: string[] };
export type TrackerRowRecord = RecordBase<'venture-tracker-row'> & { trackerId: string; cells: Record<string, TrackerCell>; addedBy: string; undoneAt: string | null };

export type TrackerView = { id: string; name: string; columns: TrackerColumn[]; boardBy: string | null; keptBy: string[]; rows: number };
export type TrackerRowView = { id: string; at: string; cells: CellView[]; addedBy: string; addedByName: string | null; canUndo: boolean };
export type TrackerStarter = { id: 'content-calendar' | 'gst-due-dates'; name: string; columns: TrackerColumn[]; boardBy: string | null };
export type TrackersView = { trackers: TrackerView[]; starters: TrackerStarter[] };
export type TrackerDetail = { tracker: TrackerView; rows: TrackerRowView[] };

/** The starters. GST due dates only for a business with tax fields (it is registered for tax). */
const CONTENT_CALENDAR: TrackerStarter = { id: 'content-calendar', name: 'Content calendar', boardBy: 'stage', columns: [
  { id: 'title', name: 'Title', kind: 'text' }, { id: 'due', name: 'Due', kind: 'date' },
  { id: 'stage', name: 'Stage', kind: 'choice', options: ['Idea', 'Drafting', 'Ready', 'Out'] },
] };
const GST_DUE_DATES: TrackerStarter = { id: 'gst-due-dates', name: 'GST due dates', boardBy: null, columns: [
  { id: 'form', name: 'Form', kind: 'text' }, { id: 'due', name: 'Due', kind: 'date' }, { id: 'filed', name: 'Filed', kind: 'check' },
] };
export function trackerStarters(venture: VentureRecord, state: State): TrackerStarter[] {
  const plan = listRecords(state, 'venture-blueprint', venture.id).at(-1);
  const taxed = plan?.backOffice?.taxRegistered?.value === true;
  return taxed ? [CONTENT_CALENDAR, GST_DUE_DATES] : [CONTENT_CALENDAR];
}

const live = (state: State, ventureId: string) => listRecords(state, 'venture-tracker', ventureId);
const rowsOf = (state: State, ventureId: string, trackerId: string) => listRecords(state, 'venture-tracker-row', ventureId).filter(row => row.trackerId === trackerId && row.undoneAt === null);

function trackerView(state: State, ventureId: string, tracker: TrackerRecord): TrackerView {
  return { id: tracker.id, name: tracker.name, columns: structuredClone(tracker.columns), boardBy: tracker.boardBy, keptBy: [...tracker.keptBy], rows: rowsOf(state, ventureId, tracker.id).length };
}

function rowView(state: State, venture: VentureRecord, tracker: TrackerRecord, row: TrackerRowRecord): TrackerRowView {
  const agent = row.addedBy === 'owner' ? null : teamAgents(state, venture).find(item => item.id === row.addedBy);
  return {
    id: row.id, at: row.at, cells: tracker.columns.map(column => cellView(state, venture.id, column, row.cells[column.id] ?? null)),
    addedBy: row.addedBy, addedByName: row.addedBy === 'owner' ? null : agent?.name ?? row.addedBy, canUndo: row.addedBy !== 'owner',
  };
}

/** venture.trackers.list {} (read): the trackers, each with its row count, and the starters this business may use. */
export async function trackersListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TrackersView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return { trackers: live(state, venture.id).map(tracker => trackerView(state, venture.id, tracker)), starters: trackerStarters(venture, state) };
}

/** venture.trackers.get { id } (read): one tracker with its rows, oldest first. */
export async function trackerGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TrackerDetail> {
  const body = exactPayload(payload, ['id'], ['id']);
  const { state, venture } = readVenture(deps, ctx);
  const tracker = found(live(state, venture.id), identifier(body.id, 'Tracker'));
  return { tracker: trackerView(state, venture.id, tracker), rows: rowsOf(state, venture.id, tracker.id).map(row => rowView(state, venture, tracker, row)) };
}

function found(trackers: readonly TrackerRecord[], id: string): TrackerRecord {
  const tracker = trackers.find(item => item.id === id);
  check(tracker, 'TRACKER_NOT_FOUND', 'That tracker was not found.');
  return tracker;
}

/** The agents that may keep a tracker: on this team. */
function checkKeptBy(state: State, venture: VentureRecord, raw: unknown): string[] {
  check(raw === undefined || Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Name the agents that keep this tracker as a list.');
  const ids = [...new Set((raw ?? []) as unknown[])];
  const team = teamAgents(state, venture).map(agent => agent.id);
  check(ids.every(id => typeof id === 'string' && team.includes(id)), 'AGENT_NOT_FOUND', 'Choose agents on this team to keep the tracker.');
  return ids as string[];
}

/** venture.trackers.set { tracker: { id?, name, columns, boardBy?, keptBy? } } (approve, app only): makes or changes one. */
export async function trackerSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ tracker: TrackerView }> {
  requireAppChannel(ctx, 'venture.trackers.set');
  const body = exactPayload(payload, ['tracker'], ['tracker']);
  const input = exactPayload(body.tracker, ['id', 'name', 'columns', 'boardBy', 'keptBy'], ['name', 'columns']);
  check(typeof input.name === 'string' && input.name.trim() !== '' && input.name.length <= TRACKER_LIMITS.name, 'INVALID_VENTURE_REQUEST', `Name the tracker in ${TRACKER_LIMITS.name} characters or fewer.`);
  const columns = checkColumns(input.columns);
  const boardBy = input.boardBy === undefined || input.boardBy === null ? null : input.boardBy;
  check(boardBy === null || columns.some(column => column.id === boardBy && column.kind === 'choice'), 'INVALID_VENTURE_REQUEST', 'A board groups by a choice column of this tracker.');
  return ventureAction(deps, ctx, 'approve', 'trackers.set', tx => {
    const venture = tx.venture!, keptBy = checkKeptBy(tx.state, venture, input.keptBy), name = (input.name as string).trim();
    const trackers = tx.list('venture-tracker');
    let record: TrackerRecord;
    if (input.id !== undefined) {
      const before = found(trackers, identifier(input.id, 'Tracker'));
      record = tx.replace<TrackerRecord>({ ...before, name, columns, boardBy: boardBy as string | null, keptBy });
    } else {
      check(trackers.length < TRACKER_LIMITS.trackers, 'TRACKER_LIMIT', `A business keeps at most ${TRACKER_LIMITS.trackers} trackers. Remove one first.`);
      record = tx.put<TrackerRecord>({ ...tx.base('venture-tracker'), name, columns, boardBy: boardBy as string | null, keptBy });
    }
    tx.emit('queue.changed', {});
    return { tracker: trackerView(tx.state, venture.id, record) };
  });
}

/** venture.trackers.remove { id } (approve, app only): the tracker and its rows go. */
export async function trackerRemoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ removed: true }> {
  requireAppChannel(ctx, 'venture.trackers.remove');
  const id = identifier(exactPayload(payload, ['id'], ['id']).id, 'Tracker');
  return ventureAction(deps, ctx, 'approve', 'trackers.remove', tx => {
    found(tx.list('venture-tracker'), id);
    removeRecords(tx, record => (record.kind === 'venture-tracker' && record.id === id) || (record.kind === 'venture-tracker-row' && record.trackerId === id));
    tx.emit('queue.changed', {});
    return { removed: true as const };
  });
}

/** A row's cells, each checked against its column; a cell for a column the tracker does not have refuses. */
export function checkCells(state: State, ventureId: string, tracker: TrackerRecord, raw: unknown): Record<string, TrackerCell> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send the row as its columns.');
  const given = raw as Record<string, unknown>;
  check(Object.keys(given).every(key => tracker.columns.some(column => column.id === key)), 'INVALID_VENTURE_REQUEST', 'That row names a column this tracker does not have.');
  return Object.fromEntries(tracker.columns.map(column => [column.id, checkCell(state, ventureId, column, given[column.id])]));
}

/** Keeps one row, inside the caller's transaction, under the row limit. */
export function putRow(tx: VentureTx, tracker: TrackerRecord, cells: Record<string, TrackerCell>, addedBy: string): TrackerRowRecord {
  check(rowsOf(tx.state, tx.venture!.id, tracker.id).length < TRACKER_LIMITS.rows, 'TRACKER_LIMIT', `A tracker keeps at most ${TRACKER_LIMITS.rows} rows. Remove some first.`);
  const row = tx.put<TrackerRowRecord>({ ...tx.base('venture-tracker-row'), trackerId: tracker.id, cells, addedBy, undoneAt: null });
  tx.emit('queue.changed', {});
  return row;
}

/** venture.trackers.rows.add { trackerId, cells } (prepare, app only): the owner adds a row. */
export async function rowAddHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ row: TrackerRowView }> {
  requireAppChannel(ctx, 'venture.trackers.rows.add');
  const body = exactPayload(payload, ['trackerId', 'cells'], ['trackerId', 'cells']);
  return ventureAction(deps, ctx, 'prepare', 'trackers.rows.add', tx => {
    const tracker = found(tx.list('venture-tracker'), identifier(body.trackerId, 'Tracker'));
    const row = putRow(tx, tracker, checkCells(tx.state, tx.venture!.id, tracker, body.cells), 'owner');
    return { row: rowView(tx.state, tx.venture!, tracker, row) };
  });
}

function rowOf(tx: VentureTx, id: string): TrackerRowRecord {
  const row = tx.find('venture-tracker-row', id);
  check(row && row.undoneAt === null, 'TRACKER_NOT_FOUND', 'That row was not found.');
  return row;
}

/** venture.trackers.rows.edit { rowId, cells } (prepare, app only): the owner changes a row; only the cells sent change. */
export async function rowEditHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ row: TrackerRowView }> {
  requireAppChannel(ctx, 'venture.trackers.rows.edit');
  const body = exactPayload(payload, ['rowId', 'cells'], ['rowId', 'cells']);
  return ventureAction(deps, ctx, 'prepare', 'trackers.rows.edit', tx => {
    const row = rowOf(tx, identifier(body.rowId, 'Row'));
    const tracker = found(tx.list('venture-tracker'), row.trackerId);
    const merged = checkCells(tx.state, tx.venture!.id, tracker, { ...row.cells, ...(body.cells as Record<string, unknown>) });
    const next = tx.replace<TrackerRowRecord>({ ...row, cells: merged });
    tx.emit('queue.changed', {});
    return { row: rowView(tx.state, tx.venture!, tracker, next) };
  });
}

/** venture.trackers.rows.remove { rowId } (prepare, app only): the owner removes a row for good. */
export async function rowRemoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ removed: true }> {
  requireAppChannel(ctx, 'venture.trackers.rows.remove');
  const id = identifier(exactPayload(payload, ['rowId'], ['rowId']).rowId, 'Row');
  return ventureAction(deps, ctx, 'prepare', 'trackers.rows.remove', tx => {
    const row = rowOf(tx, id);
    removeRecords(tx, record => record.kind === 'venture-tracker-row' && record.id === id);
    tx.emit('queue.changed', {});
    return { removed: true as const };
  });
}

/** venture.trackers.rows.undo { rowId } (prepare, app only): the owner undoes a row an agent added. */
export async function rowUndoHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ undone: true }> {
  requireAppChannel(ctx, 'venture.trackers.rows.undo');
  const id = identifier(exactPayload(payload, ['rowId'], ['rowId']).rowId, 'Row');
  return ventureAction(deps, ctx, 'prepare', 'trackers.rows.undo', tx => {
    const row = rowOf(tx, id);
    check(row.addedBy !== 'owner', 'INVALID_VENTURE_REQUEST', 'Only a row an agent added has Undo. Remove your own row instead.');
    tx.replace<TrackerRowRecord>({ ...row, undoneAt: tx.now });
    tx.emit('queue.changed', {});
    return { undone: true as const };
  });
}

export const TRACKER_HANDLERS = {
  'venture.trackers.list': trackersListHandler, 'venture.trackers.get': trackerGetHandler, 'venture.trackers.set': trackerSetHandler, 'venture.trackers.remove': trackerRemoveHandler,
  'venture.trackers.rows.add': rowAddHandler, 'venture.trackers.rows.edit': rowEditHandler, 'venture.trackers.rows.remove': rowRemoveHandler, 'venture.trackers.rows.undo': rowUndoHandler,
};
