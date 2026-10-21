// Chausar judge: the auditor role in the agent loop. A round runs as manager (the act turn plans which tools to call),
// executor (each tool call is one step) and auditor (this file). The auditor is code and read-only: it checks each
// step's real output, the receipts and tables now in the run and the client's files, instead of trusting what the
// step reported. Only audited steps count as progress, and only their proofs back a claim of finished work. A step
// that fails its audit is kept in the round ledger as evidence, not progress.
//
// Idea taken, code written here: AMAP-ML/LongHorizon-Harness (MIT, ideas only: the repo ships no harness code), whose
// loop has a manager, a one-step executor and a read-only auditor, counts only audited work, and keeps a round ledger.
import { canonical } from '../../../actions.ts';
import { digest } from '../../records.ts';
import type { AuditRound, AuditStep, ClaimProofKind, HarnessState, WorkReceiptRecord, WorkRunRef, WorkTableRecord } from '../../contracts.ts';
import { tablesOfFile } from '../harness/files.ts';
import type { ToolEnv, ToolOutcome } from '../harness/tools.ts';

export type { AuditRound, AuditStep };
export type AuditEnv = Pick<ToolEnv, 'ventureId' | 'runRef' | 'files' | 'tables' | 'receipts'>;
export type AuditVerdict = { audited: boolean; reason: string; evidence: string[] };

/** The proofs each tool can give. A proof of any other kind from that tool is refused. */
const PROOFS_BY_TOOL: Readonly<Record<string, readonly ClaimProofKind[]>> = Object.freeze({
  'files.read': ['file-read'], 'bills.pick': ['file-read'],
  'calc.sum': ['totals'], 'calc.totals': ['totals'],
  'books.reconcile': ['reconciled', 'matched', 'balanced'],
  'sandbox.transform': ['transformed'], 'sandbox.python': ['transformed'],
});

export const NOT_RUN_REASON = 'The step did not run.';
export const BEFORE_LEDGER_REASON = 'This run started before steps were audited.';
/** A heavy-work brief is audited again when it is settled (settleDelegation in the loop). */
export const WAITING_BRIEF_REASON = "The brief waits for the owner. It counts once the owner's tool has finished.";

const no = (reason: string, evidence: string[] = []): AuditVerdict => ({ audited: false, reason, evidence });
const sameRun = (a: WorkRunRef, b: WorkRunRef) => canonical(a) === canonical(b);

/** A receipt's digest covers everything but its record fields; recomputing it shows the receipt was not changed. */
function receiptHolds(receipt: WorkReceiptRecord): boolean {
  const { id: _id, kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, digest: stored, ...covered } = receipt;
  try { return digest(covered) === stored; } catch { return false; }
}

function tableHolds(table: WorkTableRecord): boolean {
  try { return digest(table.rows) === table.digest; } catch { return false; }
}

/** A file-read proof points at a client file, one of its sheets, or a table made earlier in this run. */
function readTarget(env: AuditEnv, tableId: string | null): string | null {
  if (!tableId) return null;
  const work = env.tables.find(table => table.id === tableId);
  if (work) return tableHolds(work) ? work.id : null;
  const file = env.files.find(item => tableId === item.id || tableId.startsWith(`${item.id}.s`));
  if (!file) return null;
  if (file.format === 'pdf') return tableId === file.id ? file.id : null;
  try { return tablesOfFile(file).some(table => table.id === tableId) ? file.id : null; } catch { return null; }
}

/**
 * The audit of one step, read-only. A step passes when it succeeded; every receipt and table it reported is in this
 * run and matches its own digest; and every proof it gave is one its tool can give, points at its own output, and
 * says what that output shows (a balanced proof needs a reconciliation that balanced).
 */
export function auditStep(env: AuditEnv, outcome: ToolOutcome): AuditVerdict {
  const { record } = outcome;
  if (record.outcome !== 'succeeded' || !record.envelope.ok) {
    return no(`The step did not succeed: ${record.envelope.ok ? record.outcome : record.envelope.error.message}`);
  }
  if (outcome.delegate) return no(WAITING_BRIEF_REASON);
  const evidence: string[] = [];
  for (const id of record.receiptIds) {
    const receipt = env.receipts.find(item => item.id === id);
    if (!receipt) return no(`The receipt ${id} the step reported is not in the run.`, evidence);
    if (receipt.ventureId !== env.ventureId || !sameRun(receipt.runRef, env.runRef)) return no(`The receipt ${id} belongs to another run.`, evidence);
    if (!receipt.figures.length) return no(`The receipt ${id} holds no figures.`, evidence);
    if (!receiptHolds(receipt)) return no(`The receipt ${id} does not match its own digest.`, evidence);
    evidence.push(id);
  }
  for (const id of record.tableIds) {
    const table = env.tables.find(item => item.id === id);
    if (!table) return no(`The table ${id} the step reported is not in the run.`, evidence);
    if (table.ventureId !== env.ventureId || !sameRun(table.runRef, env.runRef)) return no(`The table ${id} belongs to another run.`, evidence);
    if (!tableHolds(table)) return no(`The table ${id} does not match its own digest.`, evidence);
    evidence.push(id);
  }
  const allowed = PROOFS_BY_TOOL[record.tool] ?? [];
  for (const proof of outcome.proofs) {
    if (proof.toolCallId !== record.id) return no('A proof points at another step.', evidence);
    if (!allowed.includes(proof.kind)) return no(`${record.tool} cannot show ${proof.kind} work.`, evidence);
    if (proof.receiptId !== null && !record.receiptIds.includes(proof.receiptId)) return no(`The proof cites the receipt ${proof.receiptId}, which this step did not make.`, evidence);
    const receipt = proof.receiptId ? env.receipts.find(item => item.id === proof.receiptId) : undefined;
    const rec = receipt?.reconciliation ?? null;
    if (proof.kind === 'file-read') {
      const target = readTarget(env, proof.tableId);
      if (!target) return no(`${proof.tableId ?? 'The read'} is not a file or table of this run.`, evidence);
      if (!evidence.includes(target)) evidence.push(target);
    }
    if (proof.kind === 'transformed' && (!proof.tableId || !record.tableIds.includes(proof.tableId))) return no('The transform proof does not point at the table this step made.', evidence);
    if (proof.kind === 'totals' && !(receipt && (receipt.operation === 'work.sum' || receipt.operation === 'work.totals'))) return no('The totals proof has no totals receipt.', evidence);
    if (proof.kind === 'reconciled' && !(receipt?.operation === 'work.reconcile' && rec?.statementClosing)) return no('The reconciliation receipt could not check the closing balance.', evidence);
    if (proof.kind === 'matched' && !(rec && rec.matched.length > 0)) return no('The reconciliation receipt matched no payment to a bill.', evidence);
    if (proof.kind === 'balanced' && !(rec?.statementClosing && rec.balanced)) return no('The reconciliation receipt does not show a balance that agrees.', evidence);
  }
  const kinds = [...new Set(outcome.proofs.map(proof => proof.kind))];
  return {
    audited: true,
    reason: kinds.length ? `Checked ${kinds.join(', ')} against what the step really made.` : 'The step ran and returned its result.',
    evidence,
  };
}

/** A ledger entry for a step that never ran: cancelled by a hand-off, a brief or the run's limit. */
export function notRunStep(toolCallId: string, tool: string, why: string): AuditStep {
  return { toolCallId, tool, audited: false, reason: `${NOT_RUN_REASON.slice(0, -1)}: ${why}`, evidence: [] };
}

export type StepAudit = { stepId: string; tool: string; round: number; audited: boolean; reason: string };

/**
 * One line per tool call for the runs view: was the step audited, and why or why not. Every step the loop runs now
 * has a ledger entry, so a step without one ran before the ledger existed and counts as not audited.
 */
export function auditedSteps(harness: HarnessState | null | undefined): StepAudit[] {
  if (!harness) return [];
  const ledger = new Map<string, { round: number; step: AuditStep }>();
  for (const round of harness.rounds ?? []) for (const step of round.steps) ledger.set(step.toolCallId, { round: round.round, step });
  return harness.toolCalls.map(call => {
    const entry = ledger.get(call.id);
    return entry
      ? { stepId: call.id, tool: call.tool, round: entry.round, audited: entry.step.audited, reason: entry.step.reason }
      : { stepId: call.id, tool: call.tool, round: call.turn, audited: false, reason: BEFORE_LEDGER_REASON };
  });
}

/** True only when the auditor passed this step. The runs view sets RunStep.audited from this. */
export function isStepAudited(harness: HarnessState | null | undefined, stepId: string): boolean {
  return auditedSteps(harness).some(step => step.stepId === stepId && step.audited);
}

/** Progress as the runs view shows it: audited steps out of all steps. */
export function auditedProgress(harness: HarnessState | null | undefined): { done: number; total: number } {
  const steps = auditedSteps(harness);
  return { done: steps.filter(step => step.audited).length, total: steps.length };
}
