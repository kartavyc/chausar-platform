// Chausar delivery harness: when a draft may say work was done. A done claim ("we matched each payment", "your
// books are reconciled") is allowed only when a tool run in the same run proves that kind of work. Sending, filing
// and posting are never proven: this build does no outside writes, so those claims always fail.
import type { ClaimProof, ClaimProofKind } from '../../contracts.ts';

const WORK: readonly ClaimProofKind[] = ['transformed', 'totals', 'reconciled'];
/** The proof kinds that back each claimed verb; null means no tool run can ever back it. */
export const CLAIM_PROOFS: Readonly<Record<string, readonly ClaimProofKind[] | null>> = Object.freeze({
  matched: ['matched'], reconciled: ['reconciled'], closed: ['balanced'], verified: ['balanced'],
  sorted: ['transformed', 'totals'], tidied: ['transformed'], cleaned: ['transformed'],
  reviewed: ['file-read'], checked: ['file-read'], analysed: ['file-read'], analyzed: ['file-read'],
  prepared: WORK, completed: WORK, finished: WORK,
  sent: null, filed: null, posted: null, uploaded: null, submitted: null, fixed: null,
});

/** The verb a done-claim phrase ends with ('we have matched' gives 'matched'). */
export function claimVerb(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).at(-1) ?? '';
}

/** True when a proof of a kind that backs the claimed verb exists. */
export function claimBacked(phrase: string, proofs: readonly ClaimProof[]): boolean {
  const kinds = CLAIM_PROOFS[claimVerb(phrase)];
  return !!kinds && proofs.some(proof => kinds.includes(proof.kind));
}
