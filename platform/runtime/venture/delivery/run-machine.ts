// Chausar venture launcher, delivery: the delivery run's one state machine. A delivery run is the AI job that does the
// work on one client order. This file owns its states (each means one thing), the table of every move between them
// with the guard each needs, one function per event, the sets other code reads (alive, open, stoppable, decided,
// handed over, waiting on the owner), and the one reader of runs an older build stored. Nothing else writes a run's
// status, verdict, stop, pending approval or pending question: a test reads the source tree and fails when a file
// does (platform/tests/venture-run-machine-writes.test.ts). The functions are pure: they take a run and return the
// next run, or refuse with words the owner can read. They never touch the vault; the caller stores what comes back.
import { ChausarError } from '../../contracts.ts';
import { PRACTICE_REASON } from '../core/launch-stage.ts';
import type { DeliveryReason, DeliveryRunRecord, DeliveryRunStatus, DraftRevision, IsoTime, RunStop, RunStopReason, RunVerdict } from '../contracts.ts';

type Run = DeliveryRunRecord;
type Job = NonNullable<Run['agentJob']>;

/** The shape of the lifecycle fields this file writes. A stored run without it was written by an older build (normaliseRun). */
export const RUN_LIFECYCLE = 2;

// ---------------------------------------------------------------------------
// The states
// ---------------------------------------------------------------------------

/** Every state and the one thing it means. Typed by the status union, so a new status does not compile until it is said here. */
export const RUN_STATES: Readonly<Record<DeliveryRunStatus, string>> = Object.freeze({
  working: 'The AI job is queued or running. Nothing waits on the owner, unless one exact step of it asks for approval (agentJob.pendingApproval).',
  finishing: 'The AI handed over a draft and its job is still finishing: its last steps and the quality check. The owner can read or reject the draft, and accept it once the job is done.',
  'needs-answer': 'The AI job asked the owner for a fact it cannot go on without (agentJob.pendingFacts). No AI session runs meanwhile.',
  'ready-for-review': 'The draft waits for the owner to accept, edit or reject it.',
  accepted: 'The owner accepted the draft as it is (verdict.choice is accepted).',
  edited: 'The owner made the draft their own version (verdict.choice is edited).',
  rejected: 'The owner rejected the draft (verdict.choice is rejected).',
  failed: 'The AI job failed. agentJob.failure says why, and a new job starts from Run again.',
  stopped: 'Not running, with no verdict. stopped.reason says why, and stopped.line says it in words.',
});
export const RUN_STATUSES = Object.freeze(Object.keys(RUN_STATES) as DeliveryRunStatus[]);

/** Why a run can be stopped, and the line each reason shows. Typed by the reason union, like the states. */
export const STOP_LINES: Readonly<Record<RunStopReason, string>> = Object.freeze({
  owner: 'Stopped by you. Finished steps are kept.',
  interrupted: 'Interrupted: Chausar stopped while this ran. Nothing was sent again.',
  quiet: 'The AI went quiet, so Chausar stopped it. Its work so far is kept.',
  overtime: 'The AI ran past its time limit, so Chausar stopped it. Its work so far is kept.',
  answered: 'You answered its question. The work goes on in a new AI session.',
  erased: 'Stopped: the client data this job used was erased.',
  superseded: 'A newer job for this order replaced this one, so it cannot be resumed. Open the newer job instead.',
  'old-build': 'An older version of Chausar started this job, and this version cannot continue it. Run it again.',
});

/** For a switch over a status or a reason: the compiler refuses a case left out, and a value from outside is named. */
export function assertNever(value: never, what = 'value'): never {
  throw new ChausarError('INVALID_VENTURE_REQUEST', `This ${what} is not one Chausar knows: ${String(value)}.`);
}

// ---------------------------------------------------------------------------
// The derived sets, defined once
// ---------------------------------------------------------------------------

const set = (...statuses: DeliveryRunStatus[]): readonly DeliveryRunStatus[] => Object.freeze(statuses);
/** An AI job is alive on the run: queued, running or finishing. */
export const LIVE = set('working', 'finishing');
/** The run is still going or waits on the owner: not decided, not failed, not stopped. */
export const OPEN = set('working', 'finishing', 'needs-answer', 'ready-for-review');
/** A stop applies: a job is alive, or it waits for an answer. A ready draft of an AI job is stoppable too (stoppable). */
export const STOPPABLE = set('working', 'finishing', 'needs-answer');
/** A draft is in front of the owner: handed over by the job, or waiting for the verdict. Its text is the one reviewed. */
export const IN_REVIEW = set('finishing', 'ready-for-review');
/** The owner gave a verdict. */
export const DECIDED = set('accepted', 'edited', 'rejected');
/** The draft went out as the owner's: accepted or edited. Only these are shared, posted, sent, copied or bound to files. */
export const HANDED_OVER = set('accepted', 'edited');
/** A draft was made and shown to the owner, whatever came of it. */
export const DRAFTED = set('finishing', 'ready-for-review', 'accepted', 'edited', 'rejected');
/** The run ended without a draft the owner decided on: it failed or was stopped. */
export const HALTED = set('failed', 'stopped');

type Stated = Pick<Run, 'status'>;
export const jobAlive = (run: Stated): boolean => LIVE.includes(run.status);
export const runOpen = (run: Stated): boolean => OPEN.includes(run.status);
export const inReview = (run: Stated): boolean => IN_REVIEW.includes(run.status);
export const decided = (run: Stated): boolean => DECIDED.includes(run.status);
export const handedOver = (run: Stated): boolean => HANDED_OVER.includes(run.status);
export const drafted = (run: Stated): boolean => DRAFTED.includes(run.status);
/** How far each step of an AI job got, for an interruption's record: a finished tool is done, anything else was cut. */
export const toolSteps = (run: Pick<Run, 'agentJob'>): NonNullable<RunStop['steps']> => (run.agentJob?.tools ?? []).map(tool => ({ callId: tool.id, state: tool.status === 'done' ? 'done' as const : 'error' as const }));
/** A stop applies to this run (STOPPABLE, or the ready draft of an AI job, which Resume can pick up again). */
export const stoppable = (run: Pick<Run, 'status' | 'agentJob'>): boolean => STOPPABLE.includes(run.status) || (run.status === 'ready-for-review' && !!run.agentJob);
/** One exact step of the alive job waits for the owner's approval. */
export const awaitingApproval = (run: Pick<Run, 'status' | 'agentJob'>): boolean => jobAlive(run) && !!run.agentJob?.pendingApproval;
/** The run waits on the owner: for an answer, for the verdict, or for one step's approval. */
export const waitingOnOwner = (run: Pick<Run, 'status' | 'agentJob'>): boolean => run.status === 'needs-answer' || run.status === 'ready-for-review' || awaitingApproval(run);
/** Why the run is stopped, or null when it is not. */
export const stopReason = (run: Pick<Run, 'status' | 'stopped'>): RunStopReason | null => (run.status === 'stopped' ? run.stopped?.reason ?? 'owner' : null);
/** The stopped run's line, or null when it is not stopped. */
export const stopLine = (run: Pick<Run, 'status' | 'stopped'>): string | null => (run.status === 'stopped' ? run.stopped?.line ?? STOP_LINES.owner : null);
/** A newer job for the order replaced this one: stored when that job started (supersede), never worked out later. */
export const superseded = (run: Pick<Run, 'status' | 'stopped'>): boolean => stopReason(run) === 'superseded';

/**
 * How long each wait on the owner lasts before Chausar closes it. null: it waits for as long as it takes, and this is
 * on purpose. A question for a missing fact ('needs-answer') holds nothing open: no AI session runs, nothing is sent and
 * no approval is pending that could go through late, so there is nothing to fail closed, and stopping the run would only
 * lose the question (4J16). A draft waiting for its verdict ('ready-for-review') is the owner's to decide whenever they
 * come back. A step's approval lives only as long as its AI session: the session's watchdog stops a job that went
 * quiet, and the sweep when a vault opens stops one whose session is gone (interrupt), so it needs no clock of its own.
 */
export const OWNER_WAIT_LIMIT_MS: Readonly<Record<'needs-answer' | 'ready-for-review' | 'step-approval', number | null>> = Object.freeze({
  'needs-answer': null, 'ready-for-review': null, 'step-approval': null,
});

// ---------------------------------------------------------------------------
// The transition table
// ---------------------------------------------------------------------------

export type RunEvent =
  | 'saveDraft' | 'handOver' | 'askApproval' | 'settleApproval' | 'askOwner' | 'ownerAnswered' | 'finishJob' | 'failJob' | 'interrupt'
  | 'stopByOwner' | 'accept' | 'edit' | 'reject' | 'undoReject' | 'reopen' | 'requestRevision' | 'undoRevision' | 'erase' | 'supersede';

/**
 * One move: the states it may start from, the states it can end in, its guard in words, the test of that guard when it
 * reads more than the status, and the refusal (code and the owner's words) when the move is not allowed.
 */
export type RunRule = {
  from: readonly DeliveryRunStatus[]; to: readonly DeliveryRunStatus[]; guard: string;
  when?: (run: Run) => boolean; code: string; line: string;
};

const JOB_CLOSED = 'This job is no longer running.';
const NOT_READY = 'This draft reply is not ready for review.';
const NOT_RUNNING = 'This job is not running, so there is nothing to stop or steer.';

/**
 * Every move a stored run can make. A new run starts in 'working' (startJob) or 'ready-for-review' (startReady); those
 * two make a run, so they have no row.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunEvent, RunRule>> = Object.freeze({
  saveDraft: { from: LIVE, to: set('working'), guard: 'the job is alive; a new draft takes back a draft it handed over', code: 'JOB_CLOSED', line: JOB_CLOSED },
  handOver: { from: LIVE, to: set('finishing'), guard: 'the job is alive and saved the draft it proposes', when: run => !!run.renderedText && !!run.agentJob?.draftDigest, code: 'DELIVERY_NOT_READY', line: 'Save the draft before handing it over for review.' },
  askApproval: { from: LIVE, to: LIVE, guard: 'the job is alive; the status stays and agentJob.pendingApproval holds the step', when: run => !!run.agentJob, code: 'JOB_CLOSED', line: 'This AI job is no longer running.' },
  settleApproval: { from: RUN_STATUSES, to: RUN_STATUSES, guard: 'none: the status stays and the pending step is cleared', code: 'JOB_CLOSED', line: JOB_CLOSED },
  askOwner: { from: LIVE, to: set('needs-answer'), guard: 'the job is alive; agentJob.pendingFacts holds the question', when: run => !!run.agentJob, code: 'JOB_CLOSED', line: JOB_CLOSED },
  ownerAnswered: { from: set('needs-answer'), to: set('stopped'), guard: 'a question is pending; the answer continues in a new AI session (Resume)', when: run => !!run.agentJob?.pendingFacts, code: 'APPROVAL_STALE', line: 'This question changed. Read the current question.' },
  finishJob: { from: set('finishing'), to: set('ready-for-review'), guard: 'the job completed with its draft handed over', code: 'JOB_CLOSED', line: JOB_CLOSED },
  failJob: { from: LIVE, to: set('failed'), guard: 'the job ended without completing', code: 'JOB_CLOSED', line: JOB_CLOSED },
  interrupt: { from: LIVE, to: set('stopped'), guard: 'the AI session was cut: Chausar closed, the session was interrupted, or the watchdog stopped it', code: 'JOB_CLOSED', line: JOB_CLOSED },
  stopByOwner: { from: set('working', 'finishing', 'needs-answer', 'ready-for-review'), to: set('stopped'), guard: 'a job is alive or asking; a ready draft only when an AI job made it', when: stoppable, code: 'RUN_NOT_RUNNING', line: NOT_RUNNING },
  accept: { from: set('ready-for-review'), to: set('accepted'), guard: 'the draft waits for the verdict and is not a practice draft', when: run => !run.practice, code: 'DELIVERY_NOT_READY', line: NOT_READY },
  edit: { from: set('ready-for-review'), to: set('edited'), guard: 'the draft waits for the verdict', code: 'DELIVERY_NOT_READY', line: NOT_READY },
  reject: { from: IN_REVIEW, to: set('rejected'), guard: 'a draft is in front of the owner, even while its job finishes', code: 'DELIVERY_NOT_READY', line: NOT_READY },
  undoReject: { from: set('rejected'), to: IN_REVIEW, guard: 'the reject kept what it changed (rejectedFrom) and no revision started', when: run => !!run.rejectedFrom && !run.revision, code: 'UNDO_TOO_LATE', line: 'Too late to undo: this draft moved on since you rejected it.' },
  reopen: { from: HANDED_OVER, to: set('ready-for-review'), guard: 'a file the owner accepted changed', code: 'DELIVERY_NOT_READY', line: NOT_READY },
  requestRevision: { from: set('ready-for-review', 'accepted', 'edited'), to: set('working'), guard: 'the draft waits for the verdict; a decided draft only for one social post', when: run => run.status === 'ready-for-review' || !!run.revision?.socialPost, code: 'DELIVERY_NOT_READY', line: 'This draft is not waiting for your review.' },
  undoRevision: { from: set('working'), to: set('ready-for-review', 'accepted', 'edited'), guard: 'the revision job has not opened yet', when: run => !!run.revision && run.revision.callId === '', code: 'UNDO_TOO_LATE', line: 'Too late to undo: the revision already started.' },
  erase: { from: RUN_STATUSES, to: set('stopped'), guard: 'none: erasing client data stops the run wherever it is', code: 'JOB_CLOSED', line: JOB_CLOSED },
  supersede: { from: set('working', 'finishing', 'needs-answer', 'ready-for-review', 'stopped'), to: set('stopped'), guard: 'a newer job for the order replaced it; a decided or failed run stays as it ended', code: 'JOB_CLOSED', line: JOB_CLOSED },
});

/** Why this event cannot happen to this run now, as { code, line }, or null when it can. */
export function refusal(event: RunEvent, run: Run): { code: string; line: string } | null {
  const rule = RUN_TRANSITIONS[event];
  if (event === 'stopByOwner' && run.status === 'stopped') return { code: 'RUN_ALREADY_STOPPED', line: 'This job is already stopped. Resume it or run it again.' };
  if ((event === 'accept' || event === 'edit') && run.status === 'finishing') return { code: 'DELIVERY_NOT_READY', line: 'AI work must finish before you can approve this draft.' };
  if (event === 'accept' && run.status === 'ready-for-review' && run.practice) return { code: 'PRACTICE_DRAFT', line: PRACTICE_REASON };
  return rule.from.includes(run.status) && (!rule.when || rule.when(run)) ? null : { code: rule.code, line: rule.line };
}
/** True when the event can happen to the run now. */
export const allows = (event: RunEvent, run: Run): boolean => refusal(event, run) === null;

function guard(event: RunEvent, run: Run): void {
  const refused = refusal(event, run);
  if (refused) throw new ChausarError(refused.code, refused.line);
}

// ---------------------------------------------------------------------------
// Writing the lifecycle fields: only here
// ---------------------------------------------------------------------------

type Lifecycle = { verdict?: RunVerdict; stop?: RunStop; pendingApproval?: Job['pendingApproval']; pendingFacts?: Job['pendingFacts'] };

/**
 * The run in its next state. The fields that qualify a state are set with it and cleared with every other, so they
 * cannot disagree: a verdict exactly in the three decided states, a stop exactly in 'stopped', a pending approval only
 * while a job is alive, a pending question only in 'needs-answer'. A stop also drops the old loop's call and preview.
 */
function move(run: Run, status: DeliveryRunStatus, fields: Lifecycle = {}): Run {
  const { stopped: _stopped, ...rest } = run;
  const next: Run = { ...rest, lifecycle: RUN_LIFECYCLE, status, verdict: null };
  switch (status) {
    case 'accepted': case 'edited': case 'rejected':
      if (fields.verdict?.choice !== status) throw new ChausarError('INVALID_VENTURE_REQUEST', 'A decided draft carries its own verdict.');
      next.verdict = fields.verdict;
      break;
    case 'stopped':
      if (!fields.stop) throw new ChausarError('INVALID_VENTURE_REQUEST', 'A stopped job says why it stopped.');
      next.stopped = fields.stop; next.callId = null; next.preview = null;
      break;
    case 'working': case 'finishing': case 'needs-answer': case 'ready-for-review': case 'failed': break;
    default: assertNever(status, 'job state');
  }
  if (next.agentJob) {
    const { pendingApproval: _approval, pendingFacts: _facts, ...job } = next.agentJob;
    const approval = jobAlive(next) ? fields.pendingApproval : undefined;
    const facts = status === 'needs-answer' ? fields.pendingFacts : undefined;
    next.agentJob = { ...job, ...(approval ? { pendingApproval: approval } : {}), ...(facts ? { pendingFacts: facts } : {}) };
  }
  return next;
}
const stop = (reason: RunStopReason, at: IsoTime, more: Partial<RunStop> = {}): RunStop => ({ reason, at, line: STOP_LINES[reason], ...more });
const pendings = (run: Run): Lifecycle => ({ pendingApproval: run.agentJob?.pendingApproval, pendingFacts: run.agentJob?.pendingFacts });

/** A new run's fields, before the machine gives it its first state. */
export type RunSeed = Omit<Run, 'lifecycle' | 'status' | 'verdict' | 'stopped' | 'rejectedFrom'>;

// ---------------------------------------------------------------------------
// One function per event
// ---------------------------------------------------------------------------

/** A new AI job for an order: queued, and running once its session opens. */
export function startJob(seed: RunSeed): Run {
  return move({ ...seed, lifecycle: RUN_LIFECYCLE, status: 'working', verdict: null }, 'working');
}
/** A new run whose draft no AI job writes (a template outline, a desk's report, the owner's copy): it waits for review at once. */
export function startReady(seed: RunSeed): Run {
  return move({ ...seed, lifecycle: RUN_LIFECYCLE, status: 'ready-for-review', verdict: null }, 'ready-for-review');
}
/** The alive job saved a draft. A draft it had handed over is taken back: the job is working again. */
export function saveDraft(run: Run): Run {
  guard('saveDraft', run);
  return move(run, 'working', pendings(run));
}
/** The alive job handed its saved draft over for review. Its job goes on finishing. */
export function handOver(run: Run): Run {
  guard('handOver', run);
  return move(run, 'finishing', pendings(run));
}
/** One exact step of the alive job waits for the owner's approval. The status stays. */
export function askApproval(run: Run, pending: NonNullable<Job['pendingApproval']>): Run {
  guard('askApproval', run);
  return move(run, run.status, { ...pendings(run), pendingApproval: pending });
}
/** The pending step was decided, or its wait ended. The status stays. */
export function settleApproval(run: Run): Run {
  return move(run, run.status, { ...pendings(run), pendingApproval: undefined, verdict: run.verdict ?? undefined, stop: run.stopped ?? undefined });
}
/** The alive job asked the owner for a fact it cannot go on without. */
export function askOwner(run: Run, question: NonNullable<Job['pendingFacts']>): Run {
  guard('askOwner', run);
  return move(run, 'needs-answer', { pendingFacts: question });
}
/** The owner answered the question. The run stops here and the work goes on in a new AI session (Resume). */
export function ownerAnswered(run: Run, at: IsoTime): Run {
  guard('ownerAnswered', run);
  return move(run, 'stopped', { stop: stop('answered', at) });
}
/** The job completed with its draft handed over: the draft now waits for the owner's verdict. */
export function finishJob(run: Run): Run {
  guard('finishJob', run);
  return move(run, 'ready-for-review');
}
/** The job ended without completing. agentJob.failure, when the tool named one, is set by the caller beforehand. */
export function failJob(run: Run): Run {
  guard('failJob', run);
  return move(run, 'failed');
}
/**
 * The AI session was cut while the job was alive. reason 'interrupted': Chausar closed or the session was interrupted;
 * 'quiet' and 'overtime': the watchdog stopped it. steps: how far each step got, when the caller knows.
 */
export function interrupt(run: Run, at: IsoTime, reason: 'interrupted' | 'quiet' | 'overtime' = 'interrupted', steps?: RunStop['steps']): Run {
  guard('interrupt', run);
  const callId = run.agentJob?.scope.jobId;
  return move(run, 'stopped', { stop: stop(reason, at, { ...(callId ? { callId } : {}), ...(steps ? { steps } : {}) }) });
}
/** The owner stopped the run (Stop, Stop all, or a note that needs a new session). */
export function stopByOwner(run: Run, at: IsoTime): Run {
  guard('stopByOwner', run);
  return move(run, 'stopped', { stop: stop('owner', at) });
}

function decide(event: 'accept' | 'edit' | 'reject', choice: RunVerdict['choice'], run: Run, reason: DeliveryReason | null, at: IsoTime): Run {
  guard(event, run);
  return move(run, choice, { verdict: { choice, reason, at } });
}
/** The owner accepted the draft as it is. */
export function accept(run: Run, at: IsoTime): Run {
  return decide('accept', 'accepted', run, null, at);
}
/** The owner made the draft their own version. The caller sets editedText beforehand. */
export function edit(run: Run, reason: DeliveryReason | null, at: IsoTime): Run {
  return decide('edit', 'edited', run, reason, at);
}
/** The owner rejected the draft. What the reject changed is kept, so Undo puts it back exactly. */
export function reject(run: Run, reason: DeliveryReason | null, at: IsoTime): Run {
  const from = run.status === 'finishing' ? 'finishing' as const : 'ready-for-review' as const;
  return { ...decide('reject', 'rejected', run, reason, at), rejectedFrom: { status: from, editedText: run.editedText ?? null, practice: run.practice } };
}
/** A reject that moved the order on as well can no longer be undone on its own. */
export function forgetReject(run: Run): Run {
  return { ...run, rejectedFrom: null };
}
/** Undo of a reject: the draft is back where it was rejected from, with no verdict. */
export function undoReject(run: Run): Run {
  guard('undoReject', run);
  const from = run.rejectedFrom!;
  return { ...move(run, from.status), editedText: from.editedText, practice: from.practice, rejectedFrom: null };
}
/** A file the owner accepted changed: the acceptance is cleared and the draft waits for review again. */
export function reopen(run: Run): Run {
  guard('reopen', run);
  return move(run, 'ready-for-review');
}
/**
 * The owner sent the draft back or asked for a fix: an AI job will revise it. The verdict it held is kept on the
 * revision, so Undo before the job opens restores the draft exactly.
 */
export function requestRevision(run: Run, revision: Omit<DraftRevision, 'prior'> & { prior: { callId: string | null } }): Run {
  const asked: Run = { ...run, revision: { ...revision, prior: { callId: revision.prior.callId, verdict: run.verdict } } };
  guard('requestRevision', asked);
  return move(asked, 'working');
}
/** Undo of a revision before its job opened: the draft and the verdict it held are back. */
export function undoRevision(run: Run): Run {
  guard('undoRevision', run);
  const prior = run.revision!.prior;
  const restored: Run = { ...run, revision: null };
  return prior.verdict ? move(restored, prior.verdict.choice, { verdict: prior.verdict }) : move(restored, 'ready-for-review');
}
/**
 * Client data the run used was erased. scope 'run': everything of the client's on it goes (the draft, its checks, the
 * verdict, the judge, the old loop's turns). scope 'question': only the pending step and question go. Either way the
 * run stops, wherever it was.
 */
export function erase(run: Run, at: IsoTime, scope: 'run' | 'question' = 'run'): Run {
  const stopped = move(run, 'stopped', { stop: stop('erased', at) });
  if (scope === 'question') return stopped;
  const { judge: _judge, ...rest } = stopped;
  return {
    ...rest, deliverable: null, renderedText: null, editedText: null, harness: null, checks: [], playbookChecks: [], rejectedFrom: null,
    revision: null, merge: null, judgePending: null,
    ...(rest.agentJob ? { agentJob: { ...rest.agentJob, draftDigest: null, proposal: null } } : {}),
  };
}
/** A newer job for the order replaced this run. */
export function supersede(run: Run, at: IsoTime): Run {
  guard('supersede', run);
  return move(run, 'stopped', { stop: stop('superseded', at) });
}

// ---------------------------------------------------------------------------
// Runs an older build stored
// ---------------------------------------------------------------------------

const OLD_VERDICTS: readonly unknown[] = ['accepted', 'edited', 'rejected'];

/**
 * The one reader of a run stored by an older build (the vault's read path calls it, venture/records.ts listRecords). A
 * run this file wrote comes back as it is. An older one is brought to today's states: 'waiting-for-you' of an AI job
 * is 'working'; a ready draft whose AI job had not finished is 'finishing'; a run of the old round loop that was still
 * going ('waiting-for-you' with the loop's state or a preview, 'needs-answer' with no fact question, 'brief-waiting') is stopped as
 * 'old-build', since nothing can continue it; a stopped run gets its reason from what the old record kept (its
 * interruption, the watchdog's marks, else the owner's stop it always showed); a verdict is kept only with its own
 * status. The lease, the interruption record and the booleans that told states apart are dropped. Pure; never throws.
 */
export function normaliseRun(raw: Run): Run {
  if (!raw || raw.lifecycle === RUN_LIFECYCLE) return raw;
  const old = raw as unknown as Record<string, unknown> & {
    status?: string; verdict?: RunVerdict | null; interrupted?: { at: IsoTime; line: string; callId?: string; steps?: RunStop['steps'] };
    agentJob?: Job & { reviewReady?: boolean; quiet?: boolean; overtime?: boolean };
    harness?: { control?: { line?: string; stoppedAt?: IsoTime } } | null;
    rejectedFrom?: { editedText?: string | null; practice?: boolean; status?: 'ready-for-review' | 'finishing' } | null;
    revision?: (DraftRevision & { prior?: { callId?: string | null; status?: string; verdict?: RunVerdict | null } }) | null;
  };
  const { interrupted, lease: _lease, stopped: _stopped, ...kept } = old;
  const at = (raw.at ?? '') as IsoTime;
  let job: Job | undefined;
  if (old.agentJob) { const { reviewReady: _ready, quiet: _quiet, overtime: _overtime, ...rest } = old.agentJob; job = rest; }
  const revision = old.revision
    ? { ...old.revision, prior: { callId: old.revision.prior?.callId ?? null,
      verdict: old.revision.prior?.verdict ?? (old.revision.prior?.status === 'accepted' || old.revision.prior?.status === 'edited'
        ? { choice: old.revision.prior.status, reason: null, at: old.revision.at } as RunVerdict : null) } }
    : old.revision;
  const base = { ...kept, ...(job ? { agentJob: job } : {}), ...(old.revision !== undefined ? { revision } : {}), lifecycle: RUN_LIFECYCLE, verdict: null } as unknown as Run;
  const oldBuild = () => move(base, 'stopped', { stop: stop('old-build', old.harness?.control?.stoppedAt ?? at, old.harness?.control?.line ? { line: old.harness.control.line } : {}) });
  const pending = { pendingApproval: job?.pendingApproval, pendingFacts: job?.pendingFacts };
  let next: Run;
  switch (old.status) {
    case 'accepted': case 'edited': case 'rejected': {
      const choice = old.status;
      const verdict: RunVerdict = old.verdict && OLD_VERDICTS.includes(old.verdict.choice) ? { ...old.verdict, choice } : { choice, reason: null, at };
      next = move(base, choice, { verdict });
      break;
    }
    case 'failed': next = move(base, 'failed'); break;
    case 'working': case 'waiting-for-you':
      // The old loop's run waited on a turn's preview, or had a turn out; an AI job (opened or not yet) has neither.
      next = job || (!old.harness && !raw.preview) ? move(base, 'working', pending) : oldBuild();
      break;
    case 'finishing': next = move(base, 'finishing', pending); break;
    case 'ready-for-review':
      next = job && old.agentJob?.reviewReady !== true ? move(base, 'finishing', pending) : move(base, 'ready-for-review');
      break;
    case 'needs-answer': next = job?.pendingFacts ? move(base, 'needs-answer', pending) : oldBuild(); break;
    case 'stopped':
      if (interrupted) next = move(base, 'stopped', { stop: { reason: 'interrupted', at: interrupted.at, line: interrupted.line, ...(interrupted.callId ? { callId: interrupted.callId } : {}), ...(interrupted.steps ? { steps: interrupted.steps } : {}) } });
      else if (old.agentJob?.quiet) next = move(base, 'stopped', { stop: stop(old.agentJob.overtime ? 'overtime' : 'quiet', at) });
      else if (!job && old.harness) next = oldBuild();
      else next = move(base, 'stopped', { stop: stop('owner', at) });
      break;
    default: next = oldBuild(); // 'brief-waiting', and any word this build never wrote
  }
  // A stopped run keeps the id of its last model call as it was stored: its cost and its record are still found by it.
  if (next.status === 'stopped' && raw.callId) next = { ...next, callId: raw.callId };
  const from = old.rejectedFrom;
  return next.status === 'rejected' && from
    ? { ...next, rejectedFrom: { status: from.status ?? 'ready-for-review', editedText: from.editedText ?? null, practice: from.practice ?? raw.practice } }
    : 'rejectedFrom' in next ? { ...next, rejectedFrom: null } : next;
}
