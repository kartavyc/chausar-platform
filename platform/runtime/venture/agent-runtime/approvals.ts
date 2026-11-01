import { check, type Context, type State, type StateStore } from '../../contracts.ts';
import { canonical } from '../../portable.ts';
import type { VentureDeps } from '../contracts.ts';
import { digest, exactPayload, findRecord, identifier, requireAppChannel, ventureAction } from '../records.ts';
import { redactSecrets } from '../core/secrets.ts';
import { recordDecision } from '../journal/decisions.ts';
import type { AgentApprovalRequest } from './driver-types.ts';

type Options = { guard(state: State): void; signal: AbortSignal; secretValues?: readonly string[] };
/** W6 6F1: an owner's answer to an outside server's question. validate throws when the answer does not fit the question. */
type InputOptions = Options & { validate(content: unknown): Record<string, unknown> };
type Decision = { approved: boolean; content?: Record<string, unknown> };
type Waiter = { digest: string; jobId: string; guard(state: State): void; signal: AbortSignal; finish(decision: Decision): void; validate?: (content: unknown) => Record<string, unknown> };
const waiting = new WeakMap<StateStore, Map<string, Waiter>>();
const STALE = 'This AI step is no longer waiting for approval. Read the current job.';

function snapshot(raw: AgentApprovalRequest, secrets: readonly string[]): AgentApprovalRequest {
  const body = exactPayload(raw, ['kind', 'requestId', 'threadId', 'turnId', 'itemId', 'name', 'arguments', 'description'], ['kind', 'requestId', 'threadId', 'turnId', 'itemId', 'name', 'arguments']);
  check(['command', 'file-change', 'external-tool', 'external-input', 'connector-send'].includes(body.kind as string), 'INVALID_VENTURE_REQUEST', 'Choose a supported AI approval.');
  for (const key of ['requestId', 'threadId', 'turnId', 'itemId', 'name']) check(typeof body[key] === 'string' && body[key].length > 0 && !/[\x00-\x1f]/.test(body[key]), 'INVALID_VENTURE_REQUEST', 'The AI approval needs its exact request identity.');
  check(body.arguments !== null && typeof body.arguments === 'object' && !Array.isArray(body.arguments), 'INVALID_VENTURE_REQUEST', 'The AI approval needs complete arguments.');
  check(body.description === undefined || typeof body.description === 'string', 'INVALID_VENTURE_REQUEST', 'Use a text description for the AI step.');
  const text = canonical(body);
  const exact = JSON.parse(text) as AgentApprovalRequest;
  function containsSecret(value: unknown): boolean {
    if (typeof value === 'string') return secrets.some(secret => secret.length > 0 && value.includes(secret));
    if (Array.isArray(value)) return value.some(containsSecret);
    return value !== null && typeof value === 'object' && Object.entries(value).some(([key, child]) => containsSecret(key) || containsSecret(child));
  }
  check(redactSecrets(text) === text && !containsSecret(exact), 'SECRET_DETECTED', 'This AI step contains a secret and cannot be saved for approval.');
  return exact;
}

/** Only a current driver can wait here. A persisted request cannot grant a restarted process authority. */
export async function requestAgentApproval(deps: VentureDeps, ctx: Context, runId: string, raw: AgentApprovalRequest, options: Options): Promise<boolean> {
  check(raw?.kind !== 'external-input', 'INVALID_VENTURE_REQUEST', 'Ask a server question with requestAgentInput.');
  return (await waitForOwner(deps, ctx, runId, raw, options)).approved;
}
/** W6 6F1: the same exact card, answered with the owner's words. A decline or a stopped job answers nothing. */
export async function requestAgentInput(deps: VentureDeps, ctx: Context, runId: string, raw: AgentApprovalRequest, options: InputOptions): Promise<Decision> {
  check(raw?.kind === 'external-input', 'INVALID_VENTURE_REQUEST', 'Use an outside server question.');
  return waitForOwner(deps, ctx, runId, raw, options, options.validate);
}
async function waitForOwner(deps: VentureDeps, ctx: Context, runId: string, raw: AgentApprovalRequest, options: Options, validate?: (content: unknown) => Record<string, unknown>): Promise<Decision> {
  if (options.signal.aborted) return { approved: false };
  const request = snapshot(raw, options.secretValues ?? []);
  options.guard(deps.store.read());
  const initial = findRecord(deps.store.read(), 'venture-delivery-run', runId);
  check(initial?.agentJob, 'JOB_CLOSED', 'This AI job is no longer running.');
  const jobId = initial.agentJob.scope.jobId, bound = digest({ jobId, request });
  let jobs = waiting.get(deps.store); if (!jobs) { jobs = new Map(); waiting.set(deps.store, jobs); }
  check(!jobs.has(runId), 'JOB_BUSY', 'Review the current AI step first.');
  let finish!: (decision: Decision) => void;
  const decision = new Promise<Decision>(resolve => { finish = resolve; });
  const waiter: Waiter = { digest: bound, jobId, guard: options.guard, signal: options.signal, finish, ...(validate ? { validate } : {}) };
  jobs.set(runId, waiter);
  const abort = () => finish({ approved: false });
  options.signal.addEventListener('abort', abort, { once: true });
  async function clear() {
    await ventureAction(deps, ctx, 'prepare', 'agent.approval.clear', tx => {
      const run = tx.find('venture-delivery-run', runId);
      if (!run?.agentJob || run.agentJob.scope.jobId !== jobId || run.agentJob.pendingApproval?.digest !== bound) return;
      const { pendingApproval: _pending, ...job } = run.agentJob;
      tx.replace({ ...run, agentJob: job }); tx.emit('run.step', { runId }); tx.emit('queue.changed', {});
    });
  }
  try {
    await ventureAction(deps, ctx, 'prepare', 'agent.approval.request', tx => {
      options.guard(tx.state);
      const run = tx.find('venture-delivery-run', runId);
      check(!options.signal.aborted && run?.agentJob?.scope.jobId === jobId, 'JOB_CLOSED', 'This AI job is no longer running.');
      tx.replace({ ...run, agentJob: { ...run.agentJob, pendingApproval: { request, digest: bound } } });
      tx.emit('run.waiting', { runId });
      tx.emit('queue.changed', {}); tx.emit('run.step', { runId });
    });
    if (options.signal.aborted) finish({ approved: false });
    return await decision;
  } finally {
    options.signal.removeEventListener('abort', abort);
    if (jobs.get(runId) === waiter) jobs.delete(runId);
    await clear().catch(() => undefined);
  }
}

export async function decideAgentApproval(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ runId: string; decision: 'approve' | 'deny' }> {
  requireAppChannel(ctx, 'venture.agentApproval.decide');
  const body = exactPayload(payload, ['runId', 'digest', 'decision', 'content'], ['runId', 'digest', 'decision']);
  const runId = identifier(body.runId, 'AI job');
  check(body.decision === 'approve' || body.decision === 'deny', 'INVALID_VENTURE_REQUEST', 'Approve or decline this exact AI step.');
  const choice = body.decision, waiter = waiting.get(deps.store)?.get(runId);
  check(waiter && waiter.digest === body.digest && !waiter.signal.aborted, 'APPROVAL_STALE', STALE);
  // W6 6F1: only a server question takes an answer, and only when the owner sends it. A step approval never carries one.
  check(body.content === undefined || (waiter.validate && choice === 'approve'), 'INVALID_VENTURE_REQUEST', 'Only an outside server question takes an answer.');
  const content = waiter.validate && choice === 'approve' ? waiter.validate(body.content ?? {}) : undefined;
  let invalidated = false;
  try { await ventureAction(deps, ctx, 'approve', 'agent.approval.decide', tx => {
    try { waiter.guard(tx.state); } catch (error) { invalidated = true; throw error; }
    const run = tx.find('venture-delivery-run', runId), pending = run?.agentJob?.pendingApproval;
    check(!waiter.signal.aborted && run?.agentJob?.scope.jobId === waiter.jobId && pending && pending.digest === body.digest
      && digest({ jobId: waiter.jobId, request: pending.request }) === waiter.digest, 'APPROVAL_STALE', STALE);
    const { pendingApproval: _pending, ...job } = run.agentJob;
    tx.replace({ ...run, agentJob: job });
    recordDecision(tx, { subject: `agent-step:${runId}:${waiter.digest}`, action: choice, who: 'owner', ruleId: null,
      reason: choice === 'approve' ? 'Approved this exact AI step once.' : 'Declined this AI step.', rowId: null });
    tx.emit('queue.changed', {}); tx.emit('run.step', { runId });
  }); } catch (error) { if (invalidated) waiter.finish({ approved: false }); throw error; }
  const approved = choice === 'approve' && !waiter.signal.aborted;
  waiter.finish(approved && content ? { approved, content } : { approved });
  return { runId, decision: choice };
}
