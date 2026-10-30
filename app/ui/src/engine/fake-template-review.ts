import { EngineError, type DeliveryLite } from './types';

const reasons = ['wrong-fact', 'missing-fact', 'missing-section', 'off-brief', 'tone', 'format', 'too-long', 'too-short', 'wrong-number', 'late', 'claims-work-not-done', 'other'];
const invalid = (line: string): never => { throw new EngineError('INVALID_VENTURE_REQUEST', line); };

/** Only the built-in outline path calls this. No AI job or specialized source report is accepted here. */
export function reviewTemplate(run: DeliveryLite, p: Record<string, unknown>, at: string): DeliveryLite {
  if (Object.keys(p).some(key => !['runId', 'verdict', 'reason', 'editedText'].includes(key)) || !Object.hasOwn(p, 'runId') || !Object.hasOwn(p, 'verdict')) invalid('Send the required fields and nothing else.');
  if (typeof p.runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(p.runId)) invalid('Draft reply must be a known identifier.');
  if (p.verdict !== 'accepted' && p.verdict !== 'edited' && p.verdict !== 'rejected') invalid('Choose accept, edit or reject.');
  const verdict = p.verdict as 'accepted' | 'edited' | 'rejected';
  if (p.reason !== undefined && (typeof p.reason !== 'string' || !reasons.includes(p.reason))) invalid('Choose a reason from the list.');
  let editedText: string | null = null;
  if (verdict === 'edited') {
    if (typeof p.editedText !== 'string') invalid('Edited draft must be text.');
    editedText = (p.editedText as string).replace(/\r\n/g, '\n').trim();
    if (!editedText.length || editedText.length > 20000) invalid('Edited draft must be between 1 and 20000 characters.');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(editedText)) invalid('Edited draft contains characters Chausar cannot keep.');
  } else if (p.editedText !== undefined) invalid('Only an edit carries new text.');
  if (verdict === 'rejected' && p.reason === undefined) invalid('Choose why you reject this draft.');
  if (verdict === 'accepted' && p.reason !== undefined) invalid('An accepted draft needs no reason.');
  if (run.status !== 'ready-for-review') throw new EngineError('DELIVERY_NOT_READY', 'This draft reply is not ready for review.');
  if (verdict === 'accepted' && run.checks?.some(check => !check.passed && !check.notChecked)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Fix the failed check first.');
  return { ...run, status: verdict, verdict: { choice: verdict, reason: typeof p.reason === 'string' ? p.reason : null, at }, editedText, awaitingYou: false, canAccept: false };
}
