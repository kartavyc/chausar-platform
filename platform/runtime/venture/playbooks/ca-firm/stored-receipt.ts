// AI-native CA firm: stored CA receipts, worked again (Ink v2 wave 2, package 2A2). A tax tool keeps the engine's whole
// receipt on its work receipt, inputs included (delivery/harness/tools-ca.ts). Here the engine runs again on those
// inputs with the exact rate-table versions the receipt stamped, looked up by id and version, never by date, and the
// answer is compared with what the vault holds: every figure, every step, the receipt id and the record's own digest.
// 'same' only when all of it agrees; 'differs' names the first key that does not; 'table-gone' when a stamped version
// is no longer kept as it was, which is never read as 'same'. Also the check that every difference from the portal
// carries the CA's explanation (portal-diff-explained), read by the draft checks and again when the CA explains one.
import { ChausarError } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import type { WorkReceiptRecord } from '../../contracts.ts';
import { advanceTax, type AdvanceInput } from './advance-tax.ts';
import { computeIncomeTax, type IncomeTaxInput } from './income-tax.ts';
import { computeInterest234, type InterestInput } from './interest.ts';
import { gstWorking, type GstWorkingInput } from './gst.ts';
import { tdsWorking, type TdsWorkingInput } from './tds.ts';
import { closeBankMonth, reconcileTaxStatements, type StatementEntry } from './reconcile.ts';
import { portalDiffReceipt, type OurFigure, type PortalDiff, type PortalFigure } from './portal.ts';
import { inr } from './money.ts';
import { RATE_TABLE_HISTORY, RATE_TABLES, rateTableHash, type RateConfirmation, type RateUse, type TableStamp } from './rates.ts';
import type { CaEngine, CaReceipt } from './receipt.ts';

export type Rederived = { rederived: 'same' | 'differs' | 'table-gone'; differs: { key: string; line: string } | null };

/** Each engine, run on a stored receipt's inputs. The reconcile, month close and portal diff use no rate table. */
const ENGINES: Readonly<Record<CaEngine, (inputs: unknown, use: RateUse) => CaReceipt>> = Object.freeze({
  'advance-tax': (inputs, use) => advanceTax(inputs as AdvanceInput, use),
  'income-tax': (inputs, use) => computeIncomeTax(inputs as IncomeTaxInput, use),
  'interest-234': (inputs, use) => computeInterest234(inputs as InterestInput, use),
  'gst-working': (inputs, use) => gstWorking(inputs as GstWorkingInput, use),
  'tds-working': (inputs, use) => tdsWorking(inputs as TdsWorkingInput, use),
  reconcile: inputs => reconcileTaxStatements(inputs as { entries: StatementEntry[] }),
  'books-close': inputs => closeBankMonth(inputs as Parameters<typeof closeBankMonth>[0]),
  'portal-diff': inputs => portalDiffReceipt(inputs as { ours: OurFigure[]; portal: PortalFigure[] }),
});

const CONFIRMED_BY = /^(.+) \(ICAI (\d{1,12})\)$/;

/**
 * The confirmations as the receipt stamped them, so the engine stamps each table the same way again: confirmed by the
 * same CA, or not confirmed. In rehearsal mode an unconfirmed table is used and says so, as it was.
 */
function useAsStamped(stamps: readonly TableStamp[]): RateUse {
  const confirmations: RateConfirmation[] = stamps.flatMap(stamp => {
    const match = stamp.confirmed && stamp.confirmedBy ? CONFIRMED_BY.exec(stamp.confirmedBy) : null;
    return match ? [{ tableId: stamp.id, version: stamp.version, hash: stamp.hash, caName: match[1], membershipNumber: match[2], at: '' }] : [];
  });
  return { mode: 'rehearsal', confirmations };
}

/** Why a stamped version can't be worked on again as it was, or null when it is kept unchanged among the current tables. */
function tableGone(stamp: TableStamp): string | null {
  const current = RATE_TABLES.find(table => table.id === stamp.id && table.version === stamp.version);
  if (current) return rateTableHash(current) === stamp.hash ? null : `${stamp.title}, version ${stamp.version}, changed since this was worked. Work it again on the table as it is now.`;
  const replaced = RATE_TABLE_HISTORY.some(table => table.id === stamp.id && table.version === stamp.version);
  return replaced
    ? `${stamp.title}, version ${stamp.version}, was replaced by a correction. Work it again on the current version.`
    : `${stamp.title}, version ${stamp.version}, is no longer kept. Work it again on a current table.`;
}

/** A work receipt's digest covers everything but its record fields: recomputing it shows nobody edited the receipt. */
function receiptHolds(receipt: WorkReceiptRecord): boolean {
  const { id: _id, kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, digest: stored, ...covered } = receipt;
  try { return digest(covered) === stored; } catch { return false; }
}

type Line = { key: string; label: string; minor: string; display: string; section?: string | null };

/**
 * The first line two lists disagree on, by key: a figure missing on one side, a different amount, a different label
 * ("labels differ", when only the words changed) or a different section.
 */
function firstDifference(stored: readonly Line[], again: readonly Line[]): { key: string; line: string } | null {
  for (const item of stored) {
    const other = again.find(line => line.key === item.key);
    if (!other) return { key: item.key, line: `${item.label}: the stored receipt has ${inr(item.minor)}; worked again there is no such figure.` };
    if (other.minor !== item.minor) return { key: item.key, line: `${item.label}: the stored receipt has ${inr(item.minor)}; worked again it is ${other.display}.` };
    if (other.label !== item.label) return { key: item.key, line: `${item.key}: the amounts agree but the labels differ: the stored receipt says "${item.label}"; worked again it says "${other.label}".` };
    if ((item.section ?? null) !== (other.section ?? null) && 'section' in item) return { key: item.key, line: `${item.label}: the stored receipt rests on section ${item.section ?? 'none'}; worked again it is ${other.section ?? 'none'}.` };
  }
  const extra = again.find(line => !stored.some(item => item.key === line.key));
  return extra ? { key: extra.key, line: `${extra.label}: worked again it is ${extra.display}; the stored receipt has no such figure.` } : null;
}

/**
 * A stored CA receipt worked again from its inputs on the table versions it stamped, and compared with the vault.
 * Throws when the receipt is not a CA engine's; venture.ca.receipt checks that first.
 */
export function rederiveCaReceipt(record: WorkReceiptRecord): Rederived {
  const ca = record.ca;
  if (record.operation !== 'ca.engine' || !ca) throw new ChausarError('CA_RECEIPT_NOT_FOUND', 'That is not a receipt of the CA firm\'s calculator.');
  for (const stamp of ca.tables) {
    const gone = tableGone(stamp);
    if (gone) return { rederived: 'table-gone', differs: { key: `${stamp.id}@${stamp.version}`, line: gone } };
  }
  if (digest(ca.inputs) !== ca.inputsDigest) return { rederived: 'differs', differs: { key: 'inputs', line: 'The stored inputs are not the ones this receipt was worked from.' } };
  let again: CaReceipt;
  try {
    again = ENGINES[ca.engine as CaEngine](ca.inputs, useAsStamped(ca.tables));
  } catch (error) {
    const code = error instanceof ChausarError ? error.code : '';
    const message = error instanceof Error ? error.message : 'The engine refused it.';
    if (code === 'RATE_TABLE_MISSING' || code === 'RATE_TABLE_STALE') return { rederived: 'table-gone', differs: { key: 'table', line: message } };
    return { rederived: 'differs', differs: { key: 'engine', line: `Worked again, the calculator refused it: ${message}` } };
  }
  const figures = firstDifference(record.figures, again.figures);
  if (figures) return { rederived: 'differs', differs: figures };
  const steps = ca.steps ? firstDifference(ca.steps, again.steps) : null;
  if (steps) return { rederived: 'differs', differs: steps };
  if (again.id !== ca.caReceiptId) return { rederived: 'differs', differs: { key: 'receipt', line: 'Worked again, the tables, assumptions or working differ from the stored receipt.' } };
  if (!receiptHolds(record)) return { rederived: 'differs', differs: { key: 'receipt', line: 'The stored receipt no longer matches its own digest: it was changed after it was made.' } };
  return { rederived: 'same', differs: null };
}

// ---------------------------------------------------------------------------
// portal-diff-explained
// ---------------------------------------------------------------------------

export type PortalCheck = { check: 'portal-diff-explained'; outcome: 'pass' | 'fail' | 'not-run'; detail: string };
type ReceiptLike = { id: string; ca?: { engine: string; working: unknown; inputs?: unknown } | null };
type Explanation = { receiptId: string; key: string; note: string };

/**
 * Each portal key as it stands now: the newest comparison that has it decides, among the comparisons of the same
 * receipts (the same ours set). An earlier difference stays open only while no later comparison of those receipts
 * looked at that key again. receipts are in run order, oldest first.
 */
export function currentPortalRows(receipts: readonly ReceiptLike[]): { receiptId: string; row: PortalDiff['rows'][number] }[] {
  const decided = new Map<string, { receiptId: string; row: PortalDiff['rows'][number] }>();
  for (const receipt of receipts) {
    if (receipt.ca?.engine !== 'portal-diff') continue;
    const ours = ((receipt.ca.inputs as { ours?: { receiptId?: unknown }[] } | undefined)?.ours ?? []).map(item => String(item?.receiptId ?? ''));
    const set = JSON.stringify([...new Set(ours)].sort());
    for (const row of (receipt.ca.working as PortalDiff).rows) decided.set(`${set}|${row.key}`, { receiptId: receipt.id, row });
  }
  return [...decided.values()];
}

/**
 * Every portal difference that stands now (currentPortalRows) carries the CA's explanation on the comparison that
 * decides it. Explanations are the CA of record's, per receipt and key (signoff.ts diffExplanations). Not run when no
 * portal figures were compared.
 */
export function portalDiffExplained(receipts: readonly ReceiptLike[], explanations: readonly Explanation[]): PortalCheck {
  const check = 'portal-diff-explained' as const;
  if (!receipts.some(receipt => receipt.ca?.engine === 'portal-diff')) return { check, outcome: 'not-run', detail: 'not run: no portal figures were compared with the receipts in this run.' };
  const differing = currentPortalRows(receipts).filter(item => item.row.state !== 'same');
  const noted = (item: { receiptId: string; row: { key: string } }) => explanations.some(note => note.receiptId === item.receiptId && note.key === item.row.key && note.note.trim());
  const open = [...new Set(differing.filter(item => !noted(item)).map(item => item.row.key))].sort();
  if (open.length) {
    return { check, outcome: 'fail', detail: `The portal's figures differ from the receipts on ${open.join(', ')}, and your CA has not explained ${open.length === 1 ? 'it' : 'them'}. Your CA accepts or explains each difference before anything is filed.` };
  }
  return { check, outcome: 'pass', detail: differing.length ? `Your CA explained every difference from the portal (${differing.length}).` : "The portal's figures agree with the receipts on every key." };
}
