// Chausar delivery (Ink v2 wave 4, 4J14, catalogue Q6): coverage that can't be faked. Work over many items is a
// worklist (harness/files.ts): files.read marks the rows, lines and pages code really handed over, from its own stored
// answer. Coverage leads as a fraction ("1,204 of 1,210 lines matched"); a result is partial unless coverage is
// complete; what was never observed is null, never 0. A work receipt carries its own fraction: bank lines matched for a
// reconciliation, rows used for a sum or totals.
//
// Ideas taken, code written here: Open Security's worklist that the read tool marks, Pinloop's coverage first, and
// OpenQodex's "partial unless complete".
import type { State } from '../../contracts.ts';
import type { CoverageView, ToolCallRecord, WorkReceiptRecord } from '../contracts.ts';
import { findRecord } from '../records.ts';
import { readMarks, tablesOfFile, worklistOf, type FileLike } from './harness/files.ts';
import { previewedCalls } from './harness/hygiene.ts';

export type { CoverageView };
export type CoverageUnit = CoverageView['unit'];
export type CoverageVerb = CoverageView['verb'];

const UNIT_WORDS: Readonly<Record<CoverageUnit, readonly [string, string]>> = Object.freeze({
  rows: ['row', 'rows'], lines: ['line', 'lines'], pages: ['page', 'pages'], items: ['item', 'items'], 'bank-lines': ['bank line', 'bank lines'],
});
const count = (value: number) => value.toLocaleString('en-US');

/** A coverage line, fraction first: "1,204 of 1,210 lines matched". Complete only when every item counted was seen. */
export function coverageView(done: number | null, total: number | null, unit: CoverageUnit, verb: CoverageVerb, unitWords?: string): CoverageView {
  const [one, many] = UNIT_WORDS[unit];
  const words = (n: number | null) => unitWords ?? (n === 1 ? one : many);
  const line = done === null ? `${many.charAt(0).toUpperCase()}${many.slice(1)} ${verb}: not observed`
    : total === null ? `${count(done)} ${words(done)} ${verb}; how many there are is not known`
      : `${count(done)} of ${count(total)} ${words(total)} ${verb}`;
  return { done, total, unit, verb, complete: done !== null && total !== null && done >= total, line };
}

/** A result is partial unless its coverage is complete. No coverage at all is not complete either. */
export function resultOf(coverage: CoverageView | null): 'complete' | 'partial' {
  return coverage?.complete ? 'complete' : 'partial';
}

export type ReadCoverage = { coverage: CoverageView; files: (CoverageView & { target: string; name: string })[] };

/**
 * What a run read of its client files: per table, transcript or PDF, the items its files.read calls marked, each counted
 * once however often it was read, and only from answers the agent saw whole. A PDF never read leaves its count, and so the whole count, unknown. Null when the run
 * has no client files.
 */
export function readCoverage(files: readonly FileLike[], calls: readonly ToolCallRecord[]): ReadCoverage | null {
  const list = worklistOf(files);
  if (!list.length) return null;
  const seen = new Map<string, Set<string>>();
  const totals = new Map<string, number>();
  // What the agent never saw whole is not read: a result its turn's history showed only as a preview (hygiene.ts),
  // over the single-result limit or past the turn's batch. The stored call keeps it whole, but that is not reading.
  const shown = new Set<string>();
  for (const turn of new Set(calls.map(call => call.turn))) {
    const ofTurn = calls.filter(call => call.turn === turn);
    const previewed = previewedCalls(ofTurn);
    for (const call of ofTurn) if (!previewed.has(call.id)) shown.add(call.id);
  }
  for (const call of calls.filter(item => shown.has(item.id))) {
    for (const mark of readMarks(call, files)) {
      const set = seen.get(mark.target) ?? new Set<string>();
      for (const id of mark.ids) set.add(id);
      seen.set(mark.target, set);
      if (mark.total !== undefined) totals.set(mark.target, Math.max(totals.get(mark.target) ?? 0, mark.total));
    }
  }
  const each = list.map(item => {
    const known = item.ids ? new Set(item.ids) : null;
    const marked = seen.get(item.target);
    const total = known ? known.size : totals.get(item.target) ?? null;
    const done = known ? [...(marked ?? [])].filter(id => known.has(id)).length : marked ? marked.size : null;
    return { ...coverageView(done, total, item.unit, 'read'), target: item.target, name: item.name };
  });
  const units = [...new Set(each.map(item => item.unit))];
  const done = each.every(item => item.done === null) ? null : each.reduce((sum, item) => sum + (item.done ?? 0), 0);
  const total = each.some(item => item.total === null) ? null : each.reduce((sum, item) => sum + item.total!, 0);
  const unit: CoverageUnit = units.length === 1 ? units[0] : 'items';
  const words = units.length === 1 ? undefined : units.map(item => UNIT_WORDS[item][1]).join(' and ');
  const coverage = coverageView(done, total, unit, 'read', words);
  return { coverage: units.length > 1 ? { ...coverage, units: units as NonNullable<CoverageView['units']> } : coverage, files: each };
}

/** How many rows a table a receipt read has: a client file's sheet, or a table a tool made. Null when it is not here. */
function rowsIn(state: State, files: readonly FileLike[], tableId: string): number | null {
  const fileId = tableId.replace(/\.s\d{1,2}$/, '');
  const file = files.find(item => item.id === fileId) ?? findRecord(state, 'venture-upload', fileId);
  if (file && file.format !== 'pdf' && file.format !== 'transcript') {
    try { return tablesOfFile(file).find(table => table.id === tableId)?.rows.length ?? null; } catch { return null; }
  }
  return findRecord(state, 'venture-work-table', tableId)?.rows.length ?? null;
}

/**
 * A work receipt's coverage, fraction first: a reconciliation's bank money-out lines matched to a bill, or the rows a
 * sum or totals used of the tables it read (each row once). A CA engine's or a platform report's receipt has its own
 * inputs and no worklist here: null.
 */
export function workReceiptCoverage(state: State, files: readonly FileLike[], receipt: WorkReceiptRecord): CoverageView | null {
  if (receipt.operation === 'work.reconcile' && receipt.reconciliation) {
    const matched = receipt.reconciliation.matched.length;
    return coverageView(matched, matched + receipt.reconciliation.unmatchedBank.length, 'bank-lines', 'matched');
  }
  if (receipt.operation !== 'work.sum' && receipt.operation !== 'work.totals') return null;
  const used = new Set(receipt.inputs?.rowIds ?? []).size;
  const sizes = (receipt.inputs?.tables ?? []).map(table => rowsIn(state, files, table.id));
  const total = sizes.length && sizes.every(size => size !== null) ? sizes.reduce((sum: number, size) => sum + size!, 0) : null;
  return coverageView(used, total, 'rows', 'used');
}
