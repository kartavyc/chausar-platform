// One-shot A3 (S2, after review): the owner's own edit of a draft from Today, and which of the agent's checks it lifts.
// Only a real edit counts: the same words with only spaces changed are no edit, and neither is an edit back to the
// agent's own text. Only the owner's edit lifts anything (a cofounder may edit, but the checks stay until the owner's
// own edit), as only the owner chooses which Codex runs (A2). It lifts only the checks that read the agent's authorship:
// the rules judge, the claim check and the house style. The checks that read the words themselves run again on the
// owner's version (claims of work not done, words meant for the AI, money nobody worked out); every other check of the
// run, and every flagship playbook check, stays as it was. An amount the agent's draft showed from a receipt may stay in
// the owner's words; any other amount is money no calculator made. Numbers the owner writes are theirs, never shown as
// receipted figures (the edited text is plain words).
import type { State } from '../../contracts.ts';
import type { CheckId, CheckResult, Deliverable, DeliveryRunRecord, DraftEditRecord } from '../contracts.ts';
import type { AnyReceipt } from './deliverable.ts';
import { copiedTokens, findRecord, listRecords } from '../records.ts';
import { runChecks } from './checks.ts';
import { ventureReceipts } from './shared.ts';

/** The agent's checks an owner's edit lifts: they read who wrote the words, not what the words say. */
export const LIFTED_BY_OWNER_EDIT: readonly CheckId[] = Object.freeze(['rules-judge', 'claims-grounded', 'house-style']);
/** The checks that read the words themselves, run again on the owner's version. */
export const RECHECKED_ON_OWNER_EDIT: readonly CheckId[] = Object.freeze(['no-done-claims', 'prompt-leak', 'no-numeric-prose']);

/** The words with every run of spaces, tabs and line breaks folded to one space. */
export const foldedWords = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** Whether two texts say the same words, spaces aside. */
export const sameWords = (a: string | null | undefined, b: string | null | undefined): boolean => foldedWords(a ?? '') === foldedWords(b ?? '');

/**
 * The owner's own edit in force on this run, or null: the newest edit not undone is the run's text, made by the owner,
 * no agent revision is waiting or merged into it, and it is not the agent's own words again.
 */
export function ownerEditOf(state: State, run: DeliveryRunRecord): DraftEditRecord | null {
  if (typeof run.editedText !== 'string' || run.merge || run.revision) return null;
  const edit = listRecords(state, 'venture-draft-edit', run.ventureId).filter(item => item.runId === run.id && !item.undoneAt).at(-1);
  if (!edit || edit.text !== run.editedText || edit.role !== 'owner') return null;
  return sameWords(edit.text, run.renderedText) ? null : edit;
}

/** The receipts this run's figures may come from: the venture's price receipts and this run's own work receipts. */
function runReceipts(state: State, run: DeliveryRunRecord): AnyReceipt[] {
  const work = listRecords(state, 'venture-work-receipt', run.ventureId).filter(row => row.runRef.kind === 'delivery' && row.runRef.runId === run.id);
  return [...ventureReceipts(state, run.ventureId), ...work] as AnyReceipt[];
}

/** What the agent's draft showed from its receipts, as the rendered draft says it ("Total: INR 1,000.00", then "INR 1,000.00"). */
function receiptedDisplays(run: DeliveryRunRecord, receipts: readonly AnyReceipt[]): string[] {
  const shown: string[] = [];
  for (const section of run.deliverable?.sections ?? []) for (const part of section.parts) {
    if (part.kind !== 'figure') continue;
    const receipt = receipts.find(item => item.id === part.receiptId);
    const figure = (receipt?.figures as readonly { key: string; label: string; display: string }[] | undefined)?.find(item => item.key === part.figureKey);
    if (figure) shown.push(`${figure.label}: ${figure.display}`, figure.display);
  }
  return [...new Set(shown)].sort((a, b) => b.length - a.length);
}

/** The checks that read the words, run on the owner's version of the draft. */
export function ownerEditChecks(state: State, run: DeliveryRunRecord, text: string): CheckResult[] {
  const receipts = runReceipts(state, run);
  let words = text;
  for (const display of receiptedDisplays(run, receipts)) words = words.split(display).join(' ');
  const order = findRecord(state, 'venture-order', run.orderId);
  const venture = listRecords(state, 'venture-record').find(row => row.id === run.ventureId);
  const deliverable: Deliverable = { title: '', sections: [{ heading: '', parts: [{ kind: 'text', text: words }] }], questionsForClient: [] };
  return runChecks({
    checks: RECHECKED_ON_OWNER_EDIT, deliverable, renderedText: text, serviceType: 'consulting' as never, flagship: null,
    allowed: copiedTokens(order?.request ?? '', venture?.idea ?? ''), receipts, ventureId: run.ventureId,
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: false,
  });
}

/** The run's checks with the owner's edit in force: the lifted ones gone, the word checks the owner's version's. */
export function checksWithOwnerEdit(state: State, run: DeliveryRunRecord, edit: DraftEditRecord): CheckResult[] {
  const kept = run.checks.filter(result => !LIFTED_BY_OWNER_EDIT.includes(result.check) && !RECHECKED_ON_OWNER_EDIT.includes(result.check));
  return [...kept, ...ownerEditChecks(state, run, edit.text)];
}
