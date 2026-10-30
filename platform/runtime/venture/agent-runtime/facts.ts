import { check, type Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { plainText, requireAppChannel, ventureAction } from '../records.ts';
import { redactSecrets, screenReadback } from '../core/secrets.ts';
import { assertAgentAnswerCurrent } from './native-job.ts';
import { stopAgentJob } from './lifecycle.ts';
import { waitForAgentWork } from './runner.ts';

/** Today has already bound the complete question digest. No model tool can answer it. */
export async function answerAgentFacts(deps: VentureDeps, ctx: Context, runId: string, questionDigest: string, raw: string): Promise<void> {
  requireAppChannel(ctx, 'venture.queue.decide');
  check(!ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Answer this question inside the Chausar app.');
  const answer = screenReadback(redactSecrets(plainText(raw, 'Your answer', { min: 1, max: 2000 })), { keep: ['pan'] }).text;
  await ventureAction(deps, ctx, 'approve', 'agent.facts.answer', tx => {
    const run = tx.find('venture-delivery-run', runId), pending = run?.agentJob?.pendingFacts;
    check(run?.ventureId === tx.venture!.id && run.status === 'needs-answer' && pending?.digest === questionDigest,
      'APPROVAL_STALE', 'This question changed. Read the current question.');
    assertAgentAnswerCurrent(tx.state, run);
    const call = run.agentJob!.calculations?.find(row => row.id === pending.callId);
    check(call && !call.envelope.ok && call.envelope.error.code === 'NEEDS_FACTS', 'JOB_SOURCE_CHANGED', 'This question no longer has its calculator refusal.');
    const { pendingFacts: _pending, ...job } = run.agentJob!;
    tx.replace({ ...run, status: 'stopped', agentJob: { ...job,
      ownerNotes: [...(job.ownerNotes ?? []), { text: pending.question+'\nOwner answer: '+answer, at: tx.now, by: ctx.memberId }],
      factAnswers: [...(job.factAnswers ?? []), { digest: pending.digest, question: pending.question, answer, at: tx.now, by: ctx.memberId, turn: call.turn }] } });
    tx.emit('run.step', { runId }); tx.emit('queue.changed', {});
  });
  stopAgentJob(deps.store, runId);
  await waitForAgentWork(deps.store, runId);
}
