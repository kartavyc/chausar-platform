/**
 * C7 task 20: the fake engine's trackers, answered with the engine's codes, shapes and words
 * (platform/runtime/venture/trackers/trackers.ts and cells.ts). The sample business has one tracker its agent keeps, with
 * one row the agent added, so a screen shows "Added by" and Undo. GST due dates is offered only to a business with tax fields.
 */
import { HOLDS_MONEY } from '../../../../platform/shared/owner-format.ts';
import { EngineError, type TrackerCellLite, type TrackerColumnLite, type TrackerDetailLite, type TrackerLite, type TrackerRowLite, type TrackersLite, type TrackerStarterLite } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_TRACKER_METHODS: readonly string[] = ['venture.trackers.list', 'venture.trackers.get', 'venture.trackers.set', 'venture.trackers.remove', 'venture.trackers.rows.add', 'venture.trackers.rows.edit', 'venture.trackers.rows.remove', 'venture.trackers.rows.undo'];

const MONEY_WORDS = 'A tracker keeps no money of its own. Put an amount in a receipt column (from a receipt) or an estimate column (marked model estimate).';
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const CURRENCY = /\b(?:rupees?|rs\.?|inr|usd|dollars?|euros?|lakhs?|crores?|paise)\b/i;
const NOUNS = /\b(?:fees?|prices?|costs?|amounts?|salary|salaries|rent|earnings?|revenue|income)\b/i;
const statesMoney = (text: string) => HOLDS_MONEY.test(text) || (CURRENCY.test(text) && /\d/.test(text));
const countsMoney = (text: string) => statesMoney(text) || NOUNS.test(text);

const CONTENT: TrackerStarterLite = { id: 'content-calendar', name: 'Content calendar', boardBy: 'stage', columns: [
  { id: 'title', name: 'Title', kind: 'text' }, { id: 'due', name: 'Due', kind: 'date' }, { id: 'stage', name: 'Stage', kind: 'choice', options: ['Idea', 'Drafting', 'Ready', 'Out'] },
] };
const GST: TrackerStarterLite = { id: 'gst-due-dates', name: 'GST due dates', boardBy: null, columns: [
  { id: 'form', name: 'Form', kind: 'text' }, { id: 'due', name: 'Due', kind: 'date' }, { id: 'filed', name: 'Filed', kind: 'check' },
] };

type Row = { id: string; at: string; cells: Record<string, string | number | boolean | null>; addedBy: string; undoneAt: string | null };
type Held = { tracker: Omit<TrackerLite, 'rows'>; rows: Row[] };
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed) {
  if (Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(p, key))) throw invalid('Send the required fields and nothing else.');
}

export class FakeTrackers {
  private host: W4DeskHost;
  private byBusiness = new Map<string, Held[]>();
  private seq = 0;
  constructor(host: W4DeskHost) { this.host = host; }

  private held(): Held[] {
    const business = this.host.current();
    let held = this.byBusiness.get(business);
    if (!held) {
      held = [];
      this.byBusiness.set(business, held);
      const agent = this.agents()[0];
      if (agent) held.push({ tracker: { id: `tracker-${++this.seq}`, name: CONTENT.name, columns: CONTENT.columns, boardBy: CONTENT.boardBy, keptBy: [agent.id] },
        rows: [{ id: `trackerrow-${++this.seq}`, at: this.host.now(), cells: { title: 'Episode trailer', due: '2026-11-20', stage: 'Drafting' }, addedBy: agent.id, undoneAt: null }] });
    }
    return held;
  }
  private agents(): { id: string; name: string }[] {
    return (this.host.ask('venture.team.list', {}) as { agents: { id: string; name: string; kind?: string }[] }).agents.filter((agent) => agent.kind !== 'code');
  }
  private view(held: Held): TrackerLite { return { ...structuredClone(held.tracker), rows: held.rows.filter((row) => row.undoneAt === null).length }; }
  private rowView(held: Held, row: Row): TrackerRowLite {
    const name = row.addedBy === 'owner' ? null : this.agents().find((agent) => agent.id === row.addedBy)?.name ?? row.addedBy;
    return { id: row.id, at: row.at, addedBy: row.addedBy, addedByName: name, canUndo: row.addedBy !== 'owner', cells: held.tracker.columns.map((column): TrackerCellLite => {
      const value = row.cells[column.id] ?? null;
      if (value === null) return { column: column.id, value, display: '' };
      if (column.kind === 'estimate') return { column: column.id, value, display: String(value), label: 'model estimate' };
      if (column.kind === 'check') return { column: column.id, value, display: value ? 'Yes' : 'No' };
      return { column: column.id, value, display: String(value) };
    }) };
  }
  private find(id: unknown): Held {
    const held = this.held().find((item) => item.tracker.id === id);
    if (!held) throw new EngineError('TRACKER_NOT_FOUND', 'That tracker was not found.');
    return held;
  }
  private rowOf(id: unknown): { held: Held; row: Row } {
    for (const held of this.held()) { const row = held.rows.find((item) => item.id === id && item.undoneAt === null); if (row) return { held, row }; }
    throw new EngineError('TRACKER_NOT_FOUND', 'That row was not found.');
  }
  private appOnly() { if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.'); }
  private columns(raw: unknown): TrackerColumnLite[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 12) throw invalid('Give a tracker one to 12 columns.');
    return raw.map((column: TrackerColumnLite) => {
      if (column.kind === 'count' && countsMoney(`${column.name} 1`)) throw new EngineError('TRACKER_MONEY', MONEY_WORDS);
      return { ...column };
    });
  }
  private cells(held: Held, raw: unknown): Row['cells'] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Send the row as its columns.');
    const given = raw as Record<string, unknown>;
    if (Object.keys(given).some((key) => !held.tracker.columns.some((column) => column.id === key))) throw invalid('That row names a column this tracker does not have.');
    return Object.fromEntries(held.tracker.columns.map((column) => {
      const value = given[column.id];
      if (value === undefined || value === null || value === '') return [column.id, null];
      if (column.kind === 'text' && typeof value === 'string' && statesMoney(value)) throw new EngineError('TRACKER_MONEY', MONEY_WORDS);
      if (column.kind === 'count') {
        if (typeof value === 'string' && countsMoney(value)) throw new EngineError('TRACKER_MONEY', MONEY_WORDS);
        const count = typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : value;
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw invalid(`Give "${column.name}" as a whole number.`);
        return [column.id, count];
      }
      if (column.kind === 'choice' && !(column.options ?? []).includes(value as string)) throw invalid(`Choose one of the options for "${column.name}".`);
      if (column.kind === 'date' && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) throw invalid(`Give "${column.name}" as a date.`);
      return [column.id, value as string | number | boolean];
    }));
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.trackers.list': {
        exact(p, []);
        const taxed = this.host.taxFields?.() ?? false;
        return { trackers: this.held().map((held) => this.view(held)), starters: taxed ? [CONTENT, GST] : [CONTENT] } satisfies TrackersLite;
      }
      case 'venture.trackers.get': {
        exact(p, ['id']);
        const held = this.find(p.id);
        return { tracker: this.view(held), rows: held.rows.filter((row) => row.undoneAt === null).map((row) => this.rowView(held, row)) } satisfies TrackerDetailLite;
      }
      case 'venture.trackers.set': {
        this.appOnly(); exact(p, ['tracker']);
        const input = p.tracker as { id?: string; name?: string; columns?: unknown; boardBy?: string | null; keptBy?: string[] };
        if (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 60) throw invalid('Name the tracker in 60 characters or fewer.');
        const columns = this.columns(input.columns), boardBy = input.boardBy ?? null;
        if (boardBy !== null && !columns.some((column) => column.id === boardBy && column.kind === 'choice')) throw invalid('A board groups by a choice column of this tracker.');
        const tracker = { name: input.name.trim(), columns, boardBy, keptBy: [...(input.keptBy ?? [])] };
        if (input.id !== undefined) { const held = this.find(input.id); held.tracker = { id: held.tracker.id, ...tracker }; return { tracker: this.view(held) }; }
        if (this.held().length >= 20) throw new EngineError('TRACKER_LIMIT', 'A business keeps at most 20 trackers. Remove one first.');
        const held: Held = { tracker: { id: `tracker-${++this.seq}`, ...tracker }, rows: [] };
        this.held().push(held);
        return { tracker: this.view(held) };
      }
      case 'venture.trackers.remove': {
        this.appOnly(); exact(p, ['id']); this.find(p.id);
        this.byBusiness.set(this.host.current(), this.held().filter((item) => item.tracker.id !== p.id));
        return { removed: true };
      }
      case 'venture.trackers.rows.add': {
        this.appOnly(); exact(p, ['trackerId', 'cells']);
        const held = this.find(p.trackerId), row: Row = { id: `trackerrow-${++this.seq}`, at: this.host.now(), cells: this.cells(held, p.cells), addedBy: 'owner', undoneAt: null };
        held.rows.push(row);
        return { row: this.rowView(held, row) };
      }
      case 'venture.trackers.rows.edit': {
        this.appOnly(); exact(p, ['rowId', 'cells']);
        const { held, row } = this.rowOf(p.rowId);
        row.cells = this.cells(held, { ...row.cells, ...(p.cells as Record<string, unknown>) });
        return { row: this.rowView(held, row) };
      }
      case 'venture.trackers.rows.remove': {
        this.appOnly(); exact(p, ['rowId']);
        const { held, row } = this.rowOf(p.rowId);
        held.rows = held.rows.filter((item) => item !== row);
        return { removed: true };
      }
      case 'venture.trackers.rows.undo': {
        this.appOnly(); exact(p, ['rowId']);
        const { row } = this.rowOf(p.rowId);
        if (row.addedBy === 'owner') throw invalid('Only a row an agent added has Undo. Remove your own row instead.');
        row.undoneAt = this.host.now();
        return { undone: true };
      }
      default: throw new EngineError('METHOD_NOT_ALLOWED', "The sample business can't do that yet.");
    }
  }
}
