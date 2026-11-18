// The delivery run's one state machine (venture/delivery/run-machine.ts): every state, every move, what each refuses,
// the fields that must agree with the state, the sets other code reads, and runs an older build stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, DeliveryRunStatus } from '../runtime/venture/contracts.ts';
import * as machine from '../runtime/venture/delivery/run-machine.ts';
import { normaliseRun, RUN_STATUSES, RUN_TRANSITIONS, type RunEvent } from '../runtime/venture/delivery/run-machine.ts';

const AT = '2026-11-14T10:00:00.000Z';
const LATER = '2026-11-14T11:00:00.000Z';
const job = (extra: Record<string, unknown> = {}) => ({
  scope: { jobId: 'agentjob_1', runId: 'run_1', ventureId: 'venture_1', orderId: 'order_1', clientId: 'client_1', agentId: 'delivery', memberId: 'm', epoch: 1, consentId: 'c', consentRevision: 1, generation: 1 },
  sourceDigest: 'src', draftDigest: 'draft', proposal: null, messages: [], tools: [{ id: 't1', name: 'read', status: 'done' }], ...extra,
});
const seed = (extra: Record<string, unknown> = {}) => ({
  id: 'run_1', kind: 'venture-delivery-run', ventureId: 'venture_1', memberId: 'm', epoch: 1, at: AT, orderId: 'order_1', playbookId: 'p', playbookHash: 'h',
  servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null, renderedText: 'Draft text', checks: [], editedText: null, ...extra,
}) as unknown as machine.RunSeed;
const question = { digest: 'q1', missing: [], question: 'Which year?', callId: 'calculation-1', at: AT };
const approval = { request: { kind: 'command' }, digest: 'a1' } as unknown as NonNullable<NonNullable<DeliveryRunRecord['agentJob']>['pendingApproval']>;

/** One run in each state, reached only through the machine's own events. */
function runIn(status: DeliveryRunStatus, extra: Record<string, unknown> = {}): DeliveryRunRecord {
  const working = machine.startJob(seed({ agentJob: job(), ...extra }));
  const finishing = () => machine.handOver(working);
  const ready = () => machine.finishJob(finishing());
  switch (status) {
    case 'working': return working;
    case 'finishing': return finishing();
    case 'needs-answer': return machine.askOwner(working, question);
    case 'ready-for-review': return ready();
    case 'accepted': return machine.accept(ready(), AT);
    case 'edited': return machine.edit({ ...ready(), editedText: 'Mine' }, 'tone', AT);
    case 'rejected': return machine.reject(ready(), 'tone', AT);
    case 'failed': return machine.failJob(working);
    case 'stopped': return machine.stopByOwner(working, AT);
    default: return machine.assertNever(status);
  }
}

/** What each event does from each state: the state it ends in, or the refusal's code. Written from the handlers it replaced. */
const EXPECTED: Record<RunEvent, Partial<Record<DeliveryRunStatus, DeliveryRunStatus>> & { refuses: string }> = {
  saveDraft: { working: 'working', finishing: 'working', refuses: 'JOB_CLOSED' },
  handOver: { working: 'finishing', finishing: 'finishing', refuses: 'DELIVERY_NOT_READY' },
  askApproval: { working: 'working', finishing: 'finishing', refuses: 'JOB_CLOSED' },
  settleApproval: Object.fromEntries(RUN_STATUSES.map(status => [status, status])) as Record<DeliveryRunStatus, DeliveryRunStatus> & { refuses: string },
  askOwner: { working: 'needs-answer', finishing: 'needs-answer', refuses: 'JOB_CLOSED' },
  ownerAnswered: { 'needs-answer': 'stopped', refuses: 'APPROVAL_STALE' },
  finishJob: { finishing: 'ready-for-review', refuses: 'JOB_CLOSED' },
  failJob: { working: 'failed', finishing: 'failed', refuses: 'JOB_CLOSED' },
  interrupt: { working: 'stopped', finishing: 'stopped', refuses: 'JOB_CLOSED' },
  stopByOwner: { working: 'stopped', finishing: 'stopped', 'needs-answer': 'stopped', 'ready-for-review': 'stopped', refuses: 'RUN_NOT_RUNNING' },
  accept: { 'ready-for-review': 'accepted', refuses: 'DELIVERY_NOT_READY' },
  edit: { 'ready-for-review': 'edited', refuses: 'DELIVERY_NOT_READY' },
  reject: { finishing: 'rejected', 'ready-for-review': 'rejected', refuses: 'DELIVERY_NOT_READY' },
  undoReject: { rejected: 'ready-for-review', refuses: 'UNDO_TOO_LATE' },
  reopen: { accepted: 'ready-for-review', edited: 'ready-for-review', refuses: 'DELIVERY_NOT_READY' },
  requestRevision: { 'ready-for-review': 'working', refuses: 'DELIVERY_NOT_READY' },
  undoRevision: { refuses: 'UNDO_TOO_LATE' },
  erase: Object.fromEntries(RUN_STATUSES.map(status => [status, 'stopped'])) as Record<DeliveryRunStatus, DeliveryRunStatus> & { refuses: string },
  supersede: { working: 'stopped', finishing: 'stopped', 'needs-answer': 'stopped', 'ready-for-review': 'stopped', stopped: 'stopped', refuses: 'JOB_CLOSED' },
};
const revision = { by: 'send-back' as const, words: 'Revise this to: shorter', rowId: null, at: AT, callId: '', base: 'Draft text', prior: { callId: null } };
const APPLY: Record<RunEvent, (run: DeliveryRunRecord) => DeliveryRunRecord> = {
  saveDraft: machine.saveDraft, handOver: machine.handOver, askApproval: run => machine.askApproval(run, approval), settleApproval: machine.settleApproval,
  askOwner: run => machine.askOwner(run, question), ownerAnswered: run => machine.ownerAnswered(run, LATER), finishJob: machine.finishJob, failJob: machine.failJob,
  interrupt: run => machine.interrupt(run, LATER), stopByOwner: run => machine.stopByOwner(run, LATER), accept: run => machine.accept(run, LATER),
  edit: run => machine.edit(run, 'tone', LATER), reject: run => machine.reject(run, 'tone', LATER), undoReject: machine.undoReject, reopen: machine.reopen,
  requestRevision: run => machine.requestRevision(run, revision), undoRevision: machine.undoRevision, erase: run => machine.erase(run, LATER), supersede: run => machine.supersede(run, LATER),
};

/** The fields that qualify a state agree with it, whatever path led there. */
function assertAgrees(run: DeliveryRunRecord, where: string) {
  const isDecided = ['accepted', 'edited', 'rejected'].includes(run.status);
  assert.equal(run.verdict?.choice ?? null, isDecided ? run.status : null, `${where}: the verdict is the status's own word, or none`);
  assert.equal(!!run.stopped, run.status === 'stopped', `${where}: a stop exactly when stopped`);
  if (run.status === 'stopped') assert.ok(run.stopped!.reason && run.stopped!.line && run.stopped!.at, `${where}: a stop says why, when and in words`);
  assert.equal(run.lifecycle, 2, `${where}: stamped by the machine`);
  if (!['working', 'finishing'].includes(run.status)) assert.equal(run.agentJob?.pendingApproval, undefined, `${where}: a step waits only while the job is alive`);
  if (run.status !== 'needs-answer') assert.equal(run.agentJob?.pendingFacts, undefined, `${where}: a question is pending only in needs-answer`);
  if (run.status === 'stopped') assert.equal(run.preview, null, `${where}: a stop drops the preview`);
  if (run.status === 'stopped' && !where.startsWith('stored:')) assert.equal(run.callId, null, `${where}: a stop drops the call`);
}

test('every event, from every state: it ends where the table says, or refuses with its code and words', () => {
  for (const event of Object.keys(EXPECTED) as RunEvent[]) {
    for (const status of RUN_STATUSES) {
      const run = runIn(status);
      const to = EXPECTED[event][status];
      const where = `${event} from ${status}`;
      if (to) {
        const next = APPLY[event](run);
        assert.equal(next.status, to, where);
        assertAgrees(next, where);
        assert.ok(RUN_TRANSITIONS[event].from.includes(status) && RUN_TRANSITIONS[event].to.includes(to), `${where}: the table lists it`);
        assert.equal(machine.allows(event, run), true, where);
      } else {
        assert.throws(() => APPLY[event](run), (error: any) => typeof error.code === 'string' && error.message.length > 10 && !/undefined|\[object/.test(error.message), where);
        assert.equal(machine.allows(event, run), false, where);
        assert.ok(machine.refusal(event, run)!.line.length > 10, where);
      }
    }
    if (!['settleApproval', 'erase'].includes(event)) {
      const refused = RUN_STATUSES.find(status => !EXPECTED[event][status])!;
      const code = machine.refusal(event, runIn(refused))!.code;
      assert.ok([EXPECTED[event].refuses, 'DELIVERY_NOT_READY', 'RUN_ALREADY_STOPPED', 'RUN_NOT_RUNNING', 'JOB_CLOSED'].includes(code), `${event}: ${code}`);
    }
  }
});

test('the table and the states are whole: every status is described, every row moves between known states', () => {
  assert.deepEqual([...RUN_STATUSES].sort(), ['accepted', 'edited', 'failed', 'finishing', 'needs-answer', 'ready-for-review', 'rejected', 'stopped', 'working']);
  for (const status of RUN_STATUSES) assert.ok(machine.RUN_STATES[status].length > 20, status);
  for (const [event, rule] of Object.entries(RUN_TRANSITIONS)) {
    assert.ok(rule.from.length && rule.to.length && rule.guard && rule.code && rule.line, event);
    for (const status of [...rule.from, ...rule.to]) assert.ok(RUN_STATUSES.includes(status), `${event}: ${status}`);
    assert.doesNotMatch(rule.line + rule.guard, /—/, event);
  }
  for (const reason of Object.keys(machine.STOP_LINES)) assert.ok(machine.STOP_LINES[reason as keyof typeof machine.STOP_LINES].length > 20, reason);
  assert.throws(() => machine.assertNever('brief-waiting' as never, 'job state'), /brief-waiting/);
});

test('a new run starts working or ready, and never anywhere else', () => {
  const working = machine.startJob(seed());
  assert.deepEqual([working.status, working.verdict, working.stopped, working.lifecycle], ['working', null, undefined, 2]);
  const ready = machine.startReady(seed({ servedBy: 'template' }));
  assert.deepEqual([ready.status, ready.verdict, ready.lifecycle], ['ready-for-review', null, 2]);
});

test('the stop says why: owner, interruption, watchdog, answer, erasure and replacement are told apart', () => {
  assert.equal(machine.stopByOwner(runIn('working'), LATER).stopped!.reason, 'owner');
  const cut = machine.interrupt(runIn('working'), LATER, 'interrupted', [{ callId: 't1', state: 'done' }]);
  assert.deepEqual([cut.stopped!.reason, cut.stopped!.line, cut.stopped!.callId, cut.stopped!.steps], ['interrupted', machine.STOP_LINES.interrupted, 'agentjob_1', [{ callId: 't1', state: 'done' }]]);
  assert.equal(machine.interrupt(runIn('finishing'), LATER, 'quiet').stopped!.line, machine.STOP_LINES.quiet);
  assert.equal(machine.interrupt(runIn('working'), LATER, 'overtime').stopped!.reason, 'overtime');
  assert.equal(machine.ownerAnswered(runIn('needs-answer'), LATER).stopped!.reason, 'answered');
  assert.equal(machine.erase(runIn('accepted'), LATER).stopped!.reason, 'erased');
  const replaced = machine.supersede(runIn('stopped'), LATER);
  assert.equal(replaced.stopped!.reason, 'superseded');
  assert.equal(machine.superseded(replaced), true);
  assert.equal(machine.superseded(runIn('stopped')), false);
  assert.equal(machine.stopReason(runIn('working')), null);
});

test('a step approval is a sub-state of an alive job, and leaves with it', () => {
  const asking = machine.askApproval(runIn('working'), approval);
  assert.equal(asking.status, 'working');
  assert.equal(machine.awaitingApproval(asking), true);
  assert.equal(machine.waitingOnOwner(asking), true);
  assert.equal(machine.waitingOnOwner(runIn('working')), false);
  assert.equal(machine.handOver(asking).agentJob!.pendingApproval!.digest, 'a1', 'handing over keeps the pending step');
  assert.equal(machine.settleApproval(asking).agentJob!.pendingApproval, undefined);
  for (const leave of [machine.stopByOwner(asking, LATER), machine.failJob(asking), machine.interrupt(asking, LATER), machine.askOwner(asking, question), machine.erase(asking, LATER)]) {
    assert.equal(leave.agentJob!.pendingApproval, undefined, leave.status);
  }
  const decidedRun = runIn('accepted');
  assert.deepEqual(machine.settleApproval(decidedRun), decidedRun, 'settling changes no state');
  const stoppedRun = runIn('stopped');
  assert.deepEqual(machine.settleApproval(stoppedRun), stoppedRun);
});

test('a reject keeps what it changed, and its undo puts the draft back with no verdict', () => {
  const ready = { ...runIn('ready-for-review'), editedText: 'My words' };
  const rejected = machine.reject(ready, 'tone', LATER);
  assert.deepEqual(rejected.rejectedFrom, { status: 'ready-for-review', editedText: 'My words', practice: false });
  const back = machine.undoReject(rejected);
  assert.deepEqual([back.status, back.verdict, back.editedText, back.rejectedFrom], ['ready-for-review', null, 'My words', null]);
  const early = machine.undoReject(machine.reject(runIn('finishing'), 'tone', LATER));
  assert.equal(early.status, 'finishing', 'a reject while the job finished goes back to finishing');
  assert.throws(() => machine.undoReject(machine.forgetReject(rejected)), (error: any) => error.code === 'UNDO_TOO_LATE');
});

test('a revision keeps the verdict it replaced, and its undo restores status and verdict together', () => {
  const ready = runIn('ready-for-review');
  const sentBack = machine.requestRevision(ready, revision);
  assert.deepEqual([sentBack.status, sentBack.verdict, sentBack.revision!.prior.verdict], ['working', null, null]);
  assert.equal(machine.undoRevision(sentBack).status, 'ready-for-review');
  const accepted = runIn('accepted');
  assert.throws(() => machine.requestRevision(accepted, revision), (error: any) => error.code === 'DELIVERY_NOT_READY');
  const post = machine.requestRevision(accepted, { ...revision, socialPost: { postId: 'p1', n: 1, posts: [], prior: { rounds: {}, decisions: {}, charges: [] } as any } });
  assert.deepEqual([post.status, post.verdict], ['working', null]);
  const undone = machine.undoRevision(post);
  assert.deepEqual([undone.status, undone.verdict], ['accepted', accepted.verdict], 'never accepted with no verdict');
  assert.throws(() => machine.undoRevision({ ...post, revision: { ...post.revision!, callId: 'agentjob_2' } }), (error: any) => error.code === 'UNDO_TOO_LATE');
});

test('erasing a run removes the client words it held; erasing a question keeps the draft', () => {
  const ready = { ...runIn('ready-for-review'), deliverable: { sections: [] } as any, editedText: 'Mine', judge: { status: 'done', callId: 'c', preview: null, at: AT } as any, checks: [{ check: 'x', passed: true, detail: 'd' }] as any };
  const gone = machine.erase(ready, LATER);
  assert.deepEqual([gone.status, gone.deliverable, gone.renderedText, gone.editedText, gone.checks, gone.judge, gone.verdict, gone.harness, gone.agentJob!.proposal, gone.agentJob!.draftDigest],
    ['stopped', null, null, null, [], undefined, null, null, null, null]);
  const asked = machine.erase(runIn('needs-answer'), LATER, 'question');
  assert.deepEqual([asked.status, asked.renderedText, asked.agentJob!.pendingFacts], ['stopped', 'Draft text', undefined]);
});

test('the sets are defined once and say what they mean', () => {
  const by = (pick: (run: DeliveryRunRecord) => boolean) => RUN_STATUSES.filter(status => pick(runIn(status))).sort();
  assert.deepEqual(by(machine.jobAlive), ['finishing', 'working']);
  assert.deepEqual(by(machine.runOpen), ['finishing', 'needs-answer', 'ready-for-review', 'working']);
  assert.deepEqual(by(machine.stoppable), ['finishing', 'needs-answer', 'ready-for-review', 'working']);
  assert.equal(machine.stoppable(machine.startReady(seed({ servedBy: 'template' }))), false, 'a template draft has no job to stop');
  assert.deepEqual(by(machine.inReview), ['finishing', 'ready-for-review']);
  assert.deepEqual(by(machine.decided), ['accepted', 'edited', 'rejected']);
  assert.deepEqual(by(machine.handedOver), ['accepted', 'edited']);
  assert.deepEqual(by(machine.drafted), ['accepted', 'edited', 'finishing', 'ready-for-review', 'rejected']);
  assert.deepEqual(by(machine.waitingOnOwner), ['needs-answer', 'ready-for-review']);
  assert.deepEqual(Object.values(machine.OWNER_WAIT_LIMIT_MS), [null, null, null], 'every wait on the owner lasts as long as it takes, on purpose');
});

// ---------------------------------------------------------------------------
// Runs an older build stored
// ---------------------------------------------------------------------------

const old = (fields: Record<string, unknown>) => ({ ...seed(), verdict: null, ...fields }) as unknown as DeliveryRunRecord;

test('a run an older build stored opens in one definite state of today', () => {
  const cases: [string, Record<string, unknown>, DeliveryRunStatus, string | null][] = [
    ['an AI job that was running', { status: 'waiting-for-you', agentJob: job() }, 'working', null],
    ['an AI job not opened yet', { status: 'waiting-for-you' }, 'working', null],
    ['a one-step draft with its call out', { status: 'waiting-for-you', callId: 'call_1' }, 'working', null],
    ['an AI job waiting on a step', { status: 'waiting-for-you', agentJob: job({ pendingApproval: approval }) }, 'working', null],
    ['the old loop waiting on a turn', { status: 'waiting-for-you', callId: 'call_1', preview: { callId: 'call_1' }, harness: { phase: 'act' } }, 'stopped', 'old-build'],
    ['a draft whose job had not finished', { status: 'ready-for-review', agentJob: job() }, 'finishing', null],
    ['a draft whose job had not finished, marked so', { status: 'ready-for-review', agentJob: job({ reviewReady: false }) }, 'finishing', null],
    ['a draft ready for review', { status: 'ready-for-review', agentJob: job({ reviewReady: true }) }, 'ready-for-review', null],
    ['a template draft', { status: 'ready-for-review', servedBy: 'template' }, 'ready-for-review', null],
    ['a question for a fact', { status: 'needs-answer', agentJob: job({ pendingFacts: question }) }, 'needs-answer', null],
    ['the old loop asking a question', { status: 'needs-answer', harness: { phase: 'needs-answer' } }, 'stopped', 'old-build'],
    ['a heavy-work brief, which nothing ever wrote', { status: 'brief-waiting', harness: { phase: 'brief' } }, 'stopped', 'old-build'],
    ['stopped by the owner', { status: 'stopped', agentJob: job() }, 'stopped', 'owner'],
    ['stopped by a crash', { status: 'stopped', agentJob: job(), interrupted: { at: LATER, line: 'Interrupted: Chausar stopped while this ran. Nothing was sent again.', callId: 'agentjob_1', steps: [{ callId: 't1', state: 'done' }] } }, 'stopped', 'interrupted'],
    ['stopped by the watchdog', { status: 'stopped', agentJob: job({ quiet: true }) }, 'stopped', 'quiet'],
    ['stopped past its time', { status: 'stopped', agentJob: job({ quiet: true, overtime: true }) }, 'stopped', 'overtime'],
    ['the old loop, stopped', { status: 'stopped', harness: { phase: 'act', control: { line: 'No answer by 17 Oct 2026, 3:30 pm. Go on without it, or stop.', stoppedAt: LATER } } }, 'stopped', 'old-build'],
    ['accepted', { status: 'accepted', verdict: { choice: 'accepted', reason: null, at: LATER } }, 'accepted', null],
    ['accepted with no verdict kept', { status: 'accepted', verdict: null }, 'accepted', null],
    ['ready again with a stale verdict', { status: 'ready-for-review', servedBy: 'template', verdict: { choice: 'rejected', reason: 'tone', at: LATER } }, 'ready-for-review', null],
    ['failed', { status: 'failed', agentJob: job() }, 'failed', null],
    ['a word no build wrote', { status: 'paused' }, 'stopped', 'old-build'],
  ];
  for (const [name, fields, status, reason] of cases) {
    const run = normaliseRun(old(fields));
    assert.equal(run.status, status, name);
    assert.equal(run.stopped?.reason ?? null, reason, name);
    assertAgrees(run, `stored: ${name}`);
    for (const gone of ['interrupted', 'lease']) assert.equal(gone in run, false, `${name}: ${gone} is dropped`);
    for (const gone of ['reviewReady', 'quiet', 'overtime']) assert.equal(run.agentJob ? gone in run.agentJob : false, false, `${name}: ${gone} is dropped`);
    assert.equal(normaliseRun(run), run, `${name}: a run of today comes back as it is`);
  }
});

test('an older run keeps what its state needs: the interruption, the old line, the pending step, the undo of a reject and of a revision', () => {
  const cut = normaliseRun(old({ status: 'stopped', agentJob: job(), lease: { token: 'l' }, interrupted: { at: LATER, line: 'Interrupted: Chausar stopped while this ran. Nothing was sent again.', callId: 'agentjob_1', steps: [{ callId: 't1', state: 'done' }] } }));
  assert.deepEqual(cut.stopped, { reason: 'interrupted', at: LATER, line: machine.STOP_LINES.interrupted, callId: 'agentjob_1', steps: [{ callId: 't1', state: 'done' }] });
  const timedOut = normaliseRun(old({ status: 'stopped', harness: { phase: 'act', control: { line: 'No answer by 17 Oct 2026.', stoppedAt: LATER } } }));
  assert.deepEqual([timedOut.stopped!.line, timedOut.stopped!.at], ['No answer by 17 Oct 2026.', LATER], 'the line the old run showed stays');
  const turnOut = normaliseRun(old({ status: 'waiting-for-you', callId: 'call_9', preview: { callId: 'call_9' }, harness: { phase: 'act' } }));
  assert.deepEqual([turnOut.stopped!.reason, turnOut.callId, turnOut.preview], ['old-build', 'call_9', null], 'its last call is still found by its id');
  assert.equal(normaliseRun(old({ status: 'waiting-for-you', agentJob: job({ pendingApproval: approval }) })).agentJob!.pendingApproval!.digest, 'a1');
  assert.equal(normaliseRun(old({ status: 'stopped', agentJob: job({ pendingApproval: approval, pendingFacts: question }) })).agentJob!.pendingFacts, undefined);
  const rejected = normaliseRun(old({ status: 'rejected', verdict: { choice: 'rejected', reason: 'tone', at: LATER }, rejectedFrom: { verdict: null, editedText: 'Mine', practice: true } }));
  assert.deepEqual(rejected.rejectedFrom, { status: 'ready-for-review', editedText: 'Mine', practice: true });
  assert.equal(machine.undoReject(rejected).status, 'ready-for-review');
  const revised = normaliseRun(old({ status: 'waiting-for-you', agentJob: job(), revision: { ...revision, prior: { callId: null, phase: null, status: 'accepted' } } }));
  assert.deepEqual(revised.revision!.prior, { callId: null, verdict: { choice: 'accepted', reason: null, at: AT } });
  const restored = machine.undoRevision(revised);
  assert.deepEqual([restored.status, restored.verdict?.choice], ['accepted', 'accepted'], 'the older build restored accepted with no verdict');
  const plain = normaliseRun(old({ status: 'waiting-for-you', revision: { ...revision, prior: { callId: null, phase: null, status: 'ready-for-review' } } }));
  assert.equal(plain.revision!.prior.verdict, null);
});

test('the vault read path normalises: an older run read through listRecords is a run of today', async () => {
  const { listRecords, findRecord } = await import('../runtime/venture/records.ts');
  const { initialState } = await import('../runtime/contracts.ts');
  const state = initialState('Sample');
  const stored = old({ status: 'ready-for-review', agentJob: job() });
  state.conversations.push(stored as any, machine.startJob(seed({ id: 'run_2' })) as any);
  const [first, second] = listRecords(state, 'venture-delivery-run');
  assert.deepEqual([first.status, first.lifecycle, second.status], ['finishing', 2, 'working']);
  assert.equal(findRecord(state, 'venture-delivery-run', 'run_1')!.status, 'finishing');
  assert.equal(second, state.conversations[1], 'a run of today is not copied');
  assert.equal((state.conversations[0] as any).status, 'ready-for-review', 'reading never writes');
});

test('the app\'s hand-written mirror names the same states, stop reasons and stop lines as the machine', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (path: string) => readFile(new URL(`../../app/ui/src/engine/${path}`, import.meta.url), 'utf8');
  const types = await read('types.ts');
  const union = (name: string) => [...(types.match(new RegExp(`export type ${name} = ([^;]+);`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(union('DeliveryStatus'), [...RUN_STATUSES].sort());
  assert.deepEqual(union('RunStopReason'), Object.keys(machine.STOP_LINES).sort());
  // The fake engine cannot import the engine, so it keeps the stop lines word for word.
  const fake = await read('fake-run-controls.ts');
  for (const [reason, line] of Object.entries(machine.STOP_LINES)) assert.ok(fake.includes(`'${line}'`), `the fake's line for ${reason}`);
});
