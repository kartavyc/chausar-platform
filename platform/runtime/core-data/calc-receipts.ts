/**
 * Calculator-issued receipts for figures that are not a published dictionary sum: connector bank totals, GSTR-3B
 * turnover and the GSTR-2B match (RP-02, AS-19). Each is a full `CalculationReceipt` stored in `state.receipts`
 * with its answer, so the ordinary receipt read path (`receipts.get`, `calculator.receipt`) opens it under the same
 * checks: same member and epoch, the requested sources still readable, every row still visible, branch access.
 *
 * Such a receipt has no definitions (`definitions: []`); its operation names what was worked out. Its answer keeps
 * `request.calc` (never `request.operation`), so a history rebuild refuses it plainly instead of running a sum.
 * An identical receipt (same member, epoch, dictionary, source facts and content) is reused, not stored again.
 */
import { audit, check, hash, newId, now, type Context, type Fact, type State, type StateStore } from '../contracts.ts';
import { canSeeFact, currentAccess, type Period } from '../memory.ts';
import { assertSourceAccess } from '../trust.ts';
import { numberGuard, ratesOf, type CalculationReceipt, type CalculatorService, type Figure, type MissingFigure, type ReceiptRow } from '../calculator.ts';
import type { Dictionary } from '../ontology.ts';
import { moduleState } from '../modules/types.ts';

export type ReceiptDraft = {
  operation: string; requestedSourceIds: string[]; period: Period | null; branch: string | null; asOf: string;
  figures: Figure[]; missingFigures: MissingFigure[]; rows: { fact: Fact; amountMinor: string }[];
  exclusions: { rowId: string; reason: string }[]; selectedRows: number; conflicts: number; notCounted: number; partial: boolean;
  gaps: string[]; assumptions: Record<string, unknown>; valueMinor: string; request: Record<string, unknown>;
};
type Issued = { digest: string; receiptId: string };
const ISSUED_KEPT = 5000;
const numericTokens = (text: string) => [...text.matchAll(/(?<![\p{L}\d])[+-]?\d[\d,]*(?:\.\d+)?(?![\p{L}\d])/gu)].map(m => m[0].replaceAll(',', '').replace(/^\+/, ''));

/** The facts snapshot the calculator itself compares before storing: a change while working refuses `FACTS_CHANGED`. */
export const factsSnapshot = (state: State) => hash({ facts: state.facts, sourceRules: state.sourceRules, merges: state.merges, tombstones: state.tombstones, rates: ratesOf(state) });

export function buildReceipt(ctx: Context, state: State, dictionary: Dictionary, draft: ReceiptDraft): CalculationReceipt {
  const rowIds = draft.rows.map(r => r.fact.id), counted = new Set(rowIds);
  const importIds = state.imports.filter(i => i.rowIds?.some((id: string) => counted.has(id))).map(i => i.id);
  const reconciled = draft.rows.every(r => state.imports.some(i => i.coverage?.reconciled && i.rowIds?.includes(r.fact.id)));
  const gaps = [...draft.gaps];
  if (!reconciled && draft.rows.length) gaps.push('Some selected facts were entered directly and are not reconciled to a source report.');
  if (draft.conflicts) gaps.push('Unresolved source conflicts were excluded from this total.');
  if (draft.notCounted) gaps.push('Some amounts are in another currency and are not counted here. The receipt gives how many; they are not zero.');
  if (!draft.rows.length) gaps.push('No visible facts were counted. An empty selection is not proof that the business activity was zero.');
  const exclusions = [...new Map(draft.exclusions.map(e => [`${e.rowId}:${e.reason}`, e])).values()];
  const rows: ReceiptRow[] = draft.rows.map(({ fact, amountMinor }) => {
    const row: ReceiptRow = { factId: fact.id, entityId: fact.entityId, sourceId: fact.sourceId, sourceRow: fact.sourceRow, kind: fact.kind, amountMinor, validFrom: fact.validFrom, branch: fact.branch };
    for (const field of ['dueDate', 'invoiceId', 'customerId', 'orderId', 'status'] as const) if (typeof fact.fields[field] === 'string') row[field] = fact.fields[field];
    return row;
  });
  const missing = draft.missingFigures.map(m => `${m.label}: ${m.missing.replaceAll('-', ' ')}.`);
  const receipt: CalculationReceipt = {
    id: newId('receipt'), memberId: ctx.memberId, epoch: ctx.epoch, sourceIds: [...new Set(draft.rows.map(r => r.fact.sourceId))], requestedSourceIds: [...draft.requestedSourceIds],
    operation: draft.operation, createdAt: now(), asOf: draft.asOf, period: draft.period, comparePeriod: null, branch: draft.branch, currency: dictionary.currency,
    ontologyVersion: dictionary.version, dictionaryHash: dictionary.hash, definitionHash: hash([]), definitions: [], figures: draft.figures, valueMinor: draft.valueMinor, totalMinor: draft.valueMinor,
    rowIds, rows, exclusions,
    coverage: { selectedRows: draft.selectedRows, countedRows: rows.length, excludedRows: new Set(exclusions.map(e => e.rowId)).size, unresolvedConflicts: draft.conflicts, importIds,
      completeness: draft.conflicts || draft.notCounted || draft.partial ? 'partial' : !rows.length ? 'empty' : reconciled ? 'reconciled-imports' : 'unreconciled-facts', gaps, notCounted: draft.notCounted },
    assumptions: draft.assumptions, explanation: [...draft.figures.map(f => `${f.label}: ${f.display}.`), ...missing].join(' ') + (gaps.length ? ` Coverage: ${gaps.join(' ')}` : ''),
    stale: false, allowedNumbers: [], ...(draft.missingFigures.length ? { missingFigures: draft.missingFigures } : {}),
  };
  receipt.allowedNumbers = [...new Set([...draft.figures.flatMap(f => [f.minor, ...numericTokens(f.display), ...numericTokens(f.label)]), ...draft.missingFigures.flatMap(m => numericTokens(m.label)),
    String(rows.length), String(receipt.coverage.excludedRows), ...(draft.notCounted ? [String(draft.notCounted)] : []), ...numericTokens(JSON.stringify({ period: receipt.period, asOf: receipt.asOf }))])];
  numberGuard(receipt.explanation, receipt);
  return receipt;
}

const contentDigest = (receipt: CalculationReceipt, snapshot: string) => hash({ memberId: receipt.memberId, epoch: receipt.epoch, dictionaryHash: receipt.dictionaryHash, snapshot, operation: receipt.operation,
  requestedSourceIds: receipt.requestedSourceIds, period: receipt.period, branch: receipt.branch, figures: receipt.figures, missingFigures: receipt.missingFigures ?? [], rowIds: receipt.rowIds, rows: receipt.rows,
  exclusions: receipt.exclusions, coverage: receipt.coverage, assumptions: receipt.assumptions });

/**
 * Stores receipts atomically, rechecking access, the source facts and the dictionary inside the write. Returns the
 * stored (or reused) receipt id for each receipt, in order.
 */
export async function storeReceipts(ctx: Context, store: StateStore, calculator: CalculatorService | undefined, items: { receipt: CalculationReceipt; request: Record<string, unknown> }[], expect: { snapshot: string; dictionaryHash: string; sourceIds: string[]; branch: string | null }): Promise<string[]> {
  for (const { receipt } of items) calculator?.receiptGuard?.(ctx, structuredClone(receipt));
  return store.update(state => {
    const view: StateStore = { read: () => state, update: store.update.bind(store) };
    currentAccess(view, ctx, expect.branch ?? undefined); assertSourceAccess(state, ctx, expect.sourceIds);
    check(factsSnapshot(state) === expect.snapshot, 'FACTS_CHANGED', 'The source facts or identity rules changed during calculation. Recalculate.');
    const dictionary = state.ontology?.current ?? (state.ontology?.operations ? state.ontology : null);
    check(dictionary?.hash === expect.dictionaryHash, 'DICTIONARY_CHANGED', 'The dictionary changed; calculate again.');
    const lane = moduleState<Record<string, any>>(state, 'core-data', () => ({})); const calc = (lane.calc ??= { issued: [] as Issued[] }); const issued: Issued[] = calc.issued;
    const ids: string[] = [];
    const wanted = new Set(items.flatMap(item => item.receipt.rowIds)), facts = new Map(state.facts.filter(f => wanted.has(f.id)).map(f => [f.id, f]));
    for (const { receipt, request } of items) {
      calculator?.receiptGuard?.(ctx, structuredClone(receipt));
      for (const row of receipt.rows) { const fact = facts.get(row.factId); check(fact && !fact.deletedAt && canSeeFact(view, ctx, fact), 'ACCESS_REVOKED', 'Read permission changed while this number was being calculated.'); }
      const digest = contentDigest(receipt, expect.snapshot), prior = issued.find(item => item.digest === digest);
      const reusable = prior && state.receipts.find(r => r.id === prior.receiptId && !r.stale && r.memberId === ctx.memberId && r.epoch === ctx.epoch);
      if (reusable) { ids.push(reusable.id); continue; }
      state.receipts.push(structuredClone(receipt));
      state.answers.push({ id: newId('answer'), receiptId: receipt.id, request: structuredClone(request), at: receipt.createdAt, text: receipt.explanation, stale: false });
      audit(state, 'calculation.completed', { receiptId: receipt.id, operation: receipt.operation, rowCount: receipt.rows.length });
      issued.push({ digest, receiptId: receipt.id }); if (issued.length > ISSUED_KEPT) issued.splice(0, issued.length - ISSUED_KEPT);
      ids.push(receipt.id);
    }
    return ids;
  });
}
