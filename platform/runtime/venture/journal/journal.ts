// Chausar venture launcher: the action journal (package P2-journal).
// Every outside effect is one journal entry: issuing an invoice, sending a turn to the owner's AI, a post, a website
// edit, a bank alert, any write to a connected service. It is described (an agent or the owner proposes it), approved
// inside the app with a token bound to the action digest, the member, the session and the business (tokens.ts), then
// applied, rejected or outcome_unknown. Before the effect starts, a claim is committed on its own: the token is marked
// used and the idempotency key kept, so a retry with the same key gets back what happened and nothing runs twice.
// A send that times out or stops part way is outcome_unknown: "check before retrying". It is never run again on its
// own; the owner looks and records what they found (resolveUnknown). A connector post is its own journalled record
// with the same fields (build/posting.ts), so both kinds move through the same code here.
// Agent proposals wait fifteen minutes; a proposal that carries a quote waits an hour and is bound like a spend quote
// (money/quote.ts): the draft, the figure and the payer.
// The described, approved and applied journal, the claim before an irreversible call and the unknown outcome follow
// cloudflare/cloudflare-os (Apache-2.0, packages/gatekeeper-kit/src/actions.ts); the approval token follows
// useopendesk/opendesk (Apache-2.0); the idempotency key on apply follows HelixDB/helix-foundry (Apache-2.0,
// apps/api/src/routes/ontology.ts). These are rewrites in TypeScript, not copies.
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import { JOURNAL_ACTION_IDS } from '../contracts.ts';
import type { ApprovalSeal, ConnectorPostRecord, IsoTime, JournalActionId, JournalRecord, JournalState, JournalTargetOutcome, VentureDeps } from '../contracts.ts';
import { isAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { checkQuoteBinding, QUOTE_TTL_MS } from '../money/quote.ts';
import { businessOf, mintApprovalToken, readApprovalToken, sessionOf, tokenHash } from './tokens.ts';
import { redactSecrets, redactUrl } from '../core/secrets.ts';
import { refuseCorrupt } from './chain.ts';
import { checkDependenciesIn, cleanUpRejected, fenceAccount, normalizeKeys, refuseDenylisted, rejectDependentsIn } from './action-extras.ts';
import { checkRetryIn, normalizeCovers, normalizeTargets, stateOfTargets } from './end-states.ts';

/** An agent proposal waits this long for the owner. A proposal with a quote waits an hour, like a spend quote. */
export const AGENT_WINDOW_MS = 15 * 60_000;
export const CHECK_BEFORE_RETRYING = 'Check before retrying: it may or may not have happened, and Chausar will not do it again on its own.';

/**
 * 'atomic': one local commit, so it either happened or nothing changed. 'irreversible': it reaches outside; once the
 * claim is taken, a timeout or a crash is outcome_unknown. unknownCodes are errors that also mean "it may have happened".
 */
export type JournalActionSpec = { label: string; effect: 'atomic' | 'irreversible'; unknownCodes: readonly string[] };
export const JOURNAL_ACTIONS: Readonly<Record<JournalActionId, JournalActionSpec>> = Object.freeze({
  'invoice.issue': { label: 'Issue invoice', effect: 'atomic', unknownCodes: [] },
  'delivery.send': { label: 'Send to your AI', effect: 'irreversible', unknownCodes: ['MODEL_TIMEOUT', 'MODEL_OUTCOME_UNKNOWN'] },
  'connector.post': { label: 'Post', effect: 'irreversible', unknownCodes: [] },
  'site.apply': { label: 'Edit website', effect: 'irreversible', unknownCodes: [] },
  'bank.alert': { label: 'Send bank alert', effect: 'irreversible', unknownCodes: [] },
  'connector.write': { label: 'Write to a connected service', effect: 'irreversible', unknownCodes: [] },
  // Ink v2 wave 4 (4G3): a phone alert, the count alone, to one of the owner's browsers or to the owner's relay.
  'notify.push': { label: 'Send phone alert', effect: 'irreversible', unknownCodes: [] },
  'notify.relay': { label: 'Send relay alert', effect: 'irreversible', unknownCodes: [] },
  // Ink v2 wave 4 (4J5): a credit note issued for real, in the same commit that takes it off its invoice.
  'credit.issue': { label: 'Issue credit note', effect: 'atomic', unknownCodes: [] },
});

/** A record the journal moves: a journal entry, or a connector post, which carries the same fields. */
export type Journalled = JournalRecord | ConnectorPostRecord;
type OutcomeBy = 'platform' | 'owner' | 'engine';

export type ProposeInput = {
  action: JournalActionId;
  subject: string;
  target: string;
  actionDigest: string;
  line: string;
  agent?: string | null;
  /** The entry never outlives this, such as the end of the preview it would send. */
  notAfter?: IsoTime | null;
  quote?: { figure: string; payer: string } | null;
  shadow?: boolean;
  /** True only when line shows everything the action will send. Left out, the approver is told part of it is not shown. */
  descriptionComplete?: boolean;
  /** 4J10 (H28): the account it is approved for; it never runs under another (ACCOUNT_FENCE). */
  account?: string | null;
  /** 4J10 (H28): keys it provides, and keys it waits for (it runs after their providers apply, and ends if one is rejected). */
  provides?: string[];
  dependsOn?: string[];
  /** 4J10 (H28): the connected service's operation it runs (contacts.update); one that outlives the session is refused. */
  operation?: string | null;
  /** 4J10 (H27): a retry of an entry on several targets, and the failed targets it covers (end-states.ts retryProposal). */
  retryOf?: string | null;
  covers?: string[];
};

/**
 * What the effect reports. 'not-sent': known to have done nothing. 'unknown': it may have happened. targets (4J10,
 * H27): an action on several targets says how each ended; the entry's state then follows them (end-states.ts).
 */
export type ApplyResult<T> =
  | { outcome: 'applied'; line: string; value: T; receiptId?: string | null; url?: string | null; by?: 'platform' | 'engine'; targets?: JournalTargetOutcome[] }
  | { outcome: 'not-sent'; line: string; value: T; by?: 'platform' | 'engine' }
  | { outcome: 'unknown'; line: string; value: T };
export type ApplyHandle = {
  entry: Journalled;
  idempotencyKey: string;
  /** Marks the entry applied inside the effect's own commit, so the effect and its journal step land together. */
  settleIn(tx: VentureTx, line: string, receiptId?: string | null): void;
  /** 4J10 (H28): the account the effect is about to use; refused ACCOUNT_FENCE when it is not the approved one. */
  fence(account: string | null): void;
};
export type ApplyDone<T> = { entry: Journalled; value: T | undefined; replayed: boolean };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function actionOf(record: Journalled): JournalActionId {
  return record.kind === 'venture-connector-post' ? 'connector.post' : record.action;
}
export function digestOf(record: Journalled): string {
  return record.kind === 'venture-connector-post' ? record.digest : record.actionDigest;
}
const isShadow = (record: Journalled) => record.kind === 'venture-journal-entry' && record.shadow;
const lastLine = (record: Journalled) => record.journal[record.journal.length - 1]?.line ?? '';
/** Adds the check line unless the words already say what to check. */
export const withCheck = (line: string) => (/\bCheck\b/.test(line) ? line : `${line} ${CHECK_BEFORE_RETRYING}`.trim());

function findIn(tx: VentureTx, id: string): Journalled | undefined {
  return tx.find('venture-journal-entry', id) ?? tx.find('venture-connector-post', id);
}
function requireEntry(record: Journalled | undefined): Journalled {
  check(record, 'JOURNAL_NOT_FOUND', 'This action is not in the journal.');
  return record;
}

/**
 * The next step of a journalled record: its state, one more line in its journal, and any fields that go with it. The
 * line and any outcome pass the secret screen (W1 H17): an effect's own words or address never keep a key or token.
 */
export function stepTo<R extends Journalled>(record: R, state: JournalState, at: IsoTime, by: string, line: string, patch: Record<string, unknown> = {}): R {
  const outcome = patch.outcome as { line: string; url: string | null; by: string } | null | undefined;
  const screened = outcome ? { ...patch, outcome: { ...outcome, line: redactSecrets(outcome.line), url: outcome.url ? redactUrl(outcome.url) : outcome.url } } : patch;
  return { ...record, ...screened, state, journal: [...record.journal, { state, at, by, line: redactSecrets(line) }] } as R;
}

const ended = (record: Journalled, settled: JournalState, by: OutcomeBy, line: string, at: IsoTime, patch: Record<string, unknown> = {}) =>
  stepTo(record, settled, at, by, line, { outcome: { line, url: null, by }, ...patch });

function decidedRefusal(record: Journalled): ChausarError {
  if (record.state === 'outcome_unknown') return new ChausarError('JOURNAL_OUTCOME_UNKNOWN', withCheck(lastLine(record)));
  if (record.state === 'approved') return new ChausarError('JOURNAL_ALREADY_DECIDED', `This is already under way. ${CHECK_BEFORE_RETRYING}`);
  return new ChausarError('JOURNAL_ALREADY_DECIDED', 'This was already decided. Chausar never does the same thing twice.');
}

/** Phone alerts (4G3): sent under the owner's standing setting, and never left as an unknown to resolve. */
const STANDING_ALERTS: ReadonlySet<JournalActionId> = new Set<JournalActionId>(['notify.push', 'notify.relay']);
/** What a phone alert that may or may not have arrived says: the next one carries the count as it is then. */
export const ALERT_MAY_NOT_HAVE_ARRIVED = 'It may not have arrived. The next alert carries the current count.';

const SHADOW_LINE = 'This was a rehearsal: it was only simulated, so there is nothing to approve.';
const expired = (expiresAt: IsoTime | null | undefined, nowMs: number) => !!expiresAt && Date.parse(expiresAt) <= nowMs;

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

const CONTROL = /[\u0000-\u001F\u007F]/;
function text(value: unknown, field: string, max: number): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value), 'INVALID_VENTURE_REQUEST', `${field} must be one line of plain text.`);
  return value.trim();
}

export function normalizeProposal(input: ProposeInput): Required<ProposeInput> {
  check(input && typeof input === 'object', 'INVALID_VENTURE_REQUEST', 'Describe the action.');
  // 4J10 (H28): an action that would keep working after the session is refused before anything is recorded.
  refuseDenylisted(input.action, input.operation);
  check((JOURNAL_ACTION_IDS as readonly string[]).includes(input.action), 'INVALID_VENTURE_REQUEST', 'This is not an action the journal knows.');
  check(typeof input.actionDigest === 'string' && /^[A-Za-z0-9]{1,200}$/.test(input.actionDigest), 'INVALID_VENTURE_REQUEST', 'Send the digest of what is approved.');
  const quote = input.quote ?? null;
  if (quote) check(/^\d{1,30}$/.test(String(quote.figure)) && typeof quote.payer === 'string' && quote.payer.length > 0 && quote.payer.length <= 120, 'INVALID_VENTURE_REQUEST', 'A quote needs its figure and who pays.');
  const notAfter = input.notAfter ?? null;
  if (notAfter !== null) check(typeof notAfter === 'string' && Number.isFinite(Date.parse(notAfter)), 'INVALID_VENTURE_REQUEST', 'notAfter must be a time.');
  check(input.descriptionComplete === undefined || typeof input.descriptionComplete === 'boolean', 'INVALID_VENTURE_REQUEST', 'descriptionComplete must be true or false.');
  return {
    // The secret screen (W1 H17) on the words people read; the subject is an identifier and stays as given.
    action: input.action, subject: text(input.subject, 'The subject', 400), target: redactSecrets(text(input.target, 'The target', 120)),
    actionDigest: input.actionDigest, line: redactSecrets(text(input.line, 'The description', 300)),
    agent: input.agent === undefined || input.agent === null ? null : text(input.agent, 'The agent', 80),
    notAfter, quote: quote ? { figure: String(quote.figure), payer: quote.payer } : null, shadow: input.shadow === true,
    descriptionComplete: input.descriptionComplete === true,
    // 4J10 (H27, H28): the account fence, the dependencies and a retry's targets.
    account: input.account === undefined || input.account === null ? null : text(input.account, 'The account', 120),
    provides: normalizeKeys(input.provides, 'provides'), dependsOn: normalizeKeys(input.dependsOn, 'dependsOn'),
    operation: input.operation ?? null,
    retryOf: input.retryOf === undefined || input.retryOf === null ? null : text(input.retryOf, 'retryOf', 200),
    covers: normalizeCovers(input.covers),
  };
}

// ---------------------------------------------------------------------------
// Inside a transaction: describe, propose, approve
// ---------------------------------------------------------------------------

/** A new entry in the 'described' state. Agent proposals wait fifteen minutes, quotes an hour, never past notAfter. */
function describeIn(tx: VentureTx, input: Required<ProposeInput>): JournalRecord {
  const nowMs = Date.parse(tx.now);
  const window = input.quote ? QUOTE_TTL_MS : AGENT_WINDOW_MS;
  const ends = input.notAfter ? Math.min(nowMs + window, Date.parse(input.notAfter)) : nowMs + window;
  return tx.put<JournalRecord>({
    ...tx.base('venture-journal-entry'), action: input.action, subject: input.subject, target: input.target, actionDigest: input.actionDigest,
    describe: input.line, agent: input.agent, shadow: input.shadow, quote: input.quote, state: 'described', claimedAt: null, decidedBy: null,
    outcome: null, receiptId: null, journal: [{ state: 'described', at: tx.now, by: input.agent ?? tx.ctx.memberId, line: input.line }],
    approval: null, expiresAt: new Date(ends).toISOString(), descriptionComplete: input.descriptionComplete,
    // 4J10: kept only when given, so an entry without them reads as it always did.
    ...(input.account ? { account: input.account } : {}), ...(input.operation ? { operation: input.operation } : {}), ...(input.provides.length ? { provides: input.provides } : {}),
    ...(input.dependsOn.length ? { dependsOn: input.dependsOn } : {}), ...(input.retryOf ? { retryOf: input.retryOf, covers: input.covers } : {}),
  });
}

/**
 * Proposes one action. The same action on the same subject is never open twice: a waiting proposal of exactly this
 * digest is returned as it is, a waiting older version is closed as replaced, and an action under way, done, or with an
 * unknown outcome is refused. That last refusal is what keeps an unclear send from ever being sent again on its own.
 */
export function proposeIn(tx: VentureTx, input: Required<ProposeInput>): JournalRecord {
  if (input.shadow) return describeIn(tx, input);
  // 4J10 (H26): while Chausar's record of outside actions does not add up, nothing more is proposed.
  refuseCorrupt(tx.state, tx.venture?.id);
  // 4J10 (H27): a retry names the entry it tries again and covers only that entry's targets that failed.
  checkRetryIn(tx, input);
  const same = tx.list('venture-journal-entry').filter(entry => !entry.shadow && entry.action === input.action && entry.subject === input.subject);
  const latest = same[same.length - 1];
  if (latest) {
    if (latest.state === 'outcome_unknown' || latest.state === 'approved') throw decidedRefusal(latest);
    if (latest.state === 'applied' && latest.actionDigest === input.actionDigest) throw decidedRefusal(latest);
    if (latest.state === 'described') {
      const stale = expired(latest.expiresAt, Date.parse(tx.now));
      if (!stale && latest.actionDigest === input.actionDigest) return latest;
      const closed = tx.replace(ended(latest, 'rejected', 'engine', stale ? 'Nobody decided in time.' : 'A newer version replaced this.', tx.now));
      // A newer version provides what this did, so only an entry that ran out ends what waited on it.
      if (stale) rejectDependentsIn(tx, closed);
    }
  }
  return describeIn(tx, input);
}

/**
 * standing: no person approved this send; it goes under a standing setting the owner gave earlier (the rules judge on
 * its own, delivery/judge-run.ts; a phone alert of the count alone, notify/, 4G3). Its journal says so in line, the
 * engine is the actor, and no approver is recorded.
 */
export type ApproveInput = { entryId: string; digest: string; offered?: { figure: string; payer: string }; line?: string; standing?: boolean };

/** The owner's approval inside the app: the entry moves to approved and a token bound to it comes back. */
export function approveIn(tx: VentureTx, ctx: Context, store: object, input: ApproveInput): { record: Journalled; token: string } {
  const record = requireEntry(findIn(tx, input.entryId));
  check(!isShadow(record), 'JOURNAL_SHADOW', SHADOW_LINE);
  refuseCorrupt(tx.state, tx.venture?.id);
  // Only the rules judge's own send (delivery/judge-run.ts) and a phone alert of the count alone (notify/, 4G3) go under a
  // standing setting; everything else has a person.
  check(!input.standing || (record.kind === 'venture-journal-entry' && ((record.action === 'delivery.send' && record.subject.includes(':judge:'))
    || (STANDING_ALERTS.has(record.action) && record.subject.startsWith(record.action === 'notify.push' ? 'notify-push:' : 'notify-relay:')))),
    'INVALID_VENTURE_REQUEST', 'Only the judge and phone alerts go under a standing setting; a person approves everything else.');
  if (record.state !== 'described') throw decidedRefusal(record);
  check(digestOf(record) === input.digest, 'APPROVAL_STALE', 'This changed since you opened it.');
  const nowMs = Date.parse(tx.now);
  check(!expired(record.expiresAt, nowMs), 'JOURNAL_EXPIRED', 'This waited too long for a decision. Ask for it again.');
  // 4J10 (H28): an action that depends on others waits until each of them has applied.
  checkDependenciesIn(tx, record);
  if (record.kind === 'venture-journal-entry' && record.quote) {
    const offered = input.offered ?? record.quote;
    checkQuoteBinding({ draftDigest: record.actionDigest, figure: record.quote.figure, payer: record.quote.payer, quotedAt: record.at },
      { draftDigest: input.digest, figure: offered.figure, payer: offered.payer }, tx.now);
  }
  // A post made before the journal has no end of its own: its approval lasts as long as an agent proposal.
  const expiresAt = record.expiresAt ?? new Date(nowMs + AGENT_WINDOW_MS).toISOString();
  const token = mintApprovalToken(store, {
    entryId: record.id, actionDigest: digestOf(record), memberId: ctx.memberId, epoch: ctx.epoch, session: sessionOf(store, ctx), businessId: businessOf(tx.state), expiresAt,
  });
  const approver = input.standing ? null : ctx.memberId;
  const seal: ApprovalSeal = { tokenHash: tokenHash(token), approvedBy: approver, at: tx.now, expiresAt, usedAt: null, key: null };
  const next = tx.replace(stepTo(record, 'approved', tx.now, approver ?? 'engine', input.line ?? 'You approved this.', { approval: seal, decidedBy: approver }));
  return { record: next, token };
}

// ---------------------------------------------------------------------------
// The methods packages call
// ---------------------------------------------------------------------------

/** An agent or the owner proposes an action. It waits for the owner; nothing happens yet. */
export async function proposeAction(deps: VentureDeps, ctx: Context, input: ProposeInput): Promise<JournalRecord> {
  const normalized = normalizeProposal(input);
  return ventureAction(deps, ctx, 'prepare', 'journal.propose', tx => proposeIn(tx, normalized));
}

function requireApp(ctx: Context) {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
}
function requireId(value: unknown, field: string): string {
  check(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value), 'INVALID_VENTURE_REQUEST', `${field} must be a known identifier.`);
  return value;
}

/** The owner approves one waiting action inside the app. The token comes back to this caller only. */
export async function approveAction(deps: VentureDeps, ctx: Context, input: ApproveInput): Promise<{ entry: Journalled; token: string }> {
  requireApp(ctx);
  requireId(input?.entryId, 'entryId');
  check(typeof input.digest === 'string' && input.digest.length > 0 && input.digest.length <= 200, 'INVALID_VENTURE_REQUEST', 'Send the digest you saw.');
  // A person approves through this method, so it never makes a standing approval (journalled sets that for the judge).
  const { standing: _person, ...asked } = input;
  return ventureAction(deps, ctx, 'approve', 'journal.approve', tx => {
    const { record, token } = approveIn(tx, ctx, deps.store, asked);
    return { entry: record, token };
  });
}

/** The owner says no to one waiting action. Nothing runs. */
export async function rejectAction(deps: VentureDeps, ctx: Context, input: { entryId: string; digest: string; line?: string }): Promise<Journalled> {
  requireApp(ctx);
  requireId(input?.entryId, 'entryId');
  return ventureAction(deps, ctx, 'approve', 'journal.reject', tx => {
    const record = requireEntry(findIn(tx, input.entryId));
    check(!isShadow(record), 'JOURNAL_SHADOW', SHADOW_LINE);
    if (record.state !== 'described') throw decidedRefusal(record);
    check(digestOf(record) === input.digest, 'APPROVAL_STALE', 'This changed since you opened it.');
    const rejected = tx.replace(ended(record, 'rejected', 'owner', input.line ?? 'You chose not to do this.', tx.now, { decidedBy: ctx.memberId }));
    // 4J10 (H28): the kind's own cleanup, then what waited on this ends too, all in this commit.
    cleanUpRejected(tx, rejected);
    rejectDependentsIn(tx, rejected);
    return rejected;
  });
}

const TIMED_OUT = Symbol('timed-out');
async function withTimeout<T>(work: Promise<T>, timeoutMs: number | undefined): Promise<T | typeof TIMED_OUT> {
  if (!timeoutMs) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Moves an approved record to how it ended. A record that already moved on (settled in the effect's commit) stays. */
async function settle(
  deps: VentureDeps, ctx: Context, entryId: string, state: JournalState, by: OutcomeBy, line: string,
  extra: { receiptId?: string | null; url?: string | null; targets?: JournalTargetOutcome[] } = {},
): Promise<Journalled> {
  return ventureAction(deps, ctx, 'approve', 'journal.settle', tx => {
    const current = requireEntry(findIn(tx, entryId));
    if (current.state !== 'approved') return current;
    const receipt = current.kind === 'venture-journal-entry' && extra.receiptId !== undefined ? { receiptId: extra.receiptId } : {};
    const targets = extra.targets ? { targets: extra.targets } : {};
    const settled = tx.replace(stepTo(current, state, tx.now, by, line, { outcome: { line, url: extra.url ?? null, by }, ...receipt, ...targets }));
    // 4J10 (H28): known not to have happened, so what waited on it ends too.
    rejectDependentsIn(tx, settled);
    return settled;
  });
}

/**
 * 4J10 (H27): an effect on several targets. Each target's outcome is kept and the entry's state follows them: unknown
 * while any may have gone, applied when any went, rejected when none did. Targets Chausar cannot read leave it unknown.
 */
async function settleTargets<T>(deps: VentureDeps, ctx: Context, entryId: string, by: OutcomeBy, result: Extract<ApplyResult<T>, { outcome: 'applied' }>): Promise<Journalled> {
  let targets: JournalTargetOutcome[];
  try {
    targets = normalizeTargets(result.targets);
  } catch (error) {
    await settle(deps, ctx, entryId, 'outcome_unknown', 'engine', withCheck(result.line));
    throw error;
  }
  const state = stateOfTargets(targets);
  const unknown = state === 'outcome_unknown';
  return settle(deps, ctx, entryId, state, unknown ? 'engine' : by, unknown ? withCheck(result.line) : result.line,
    { receiptId: state === 'applied' ? result.receiptId ?? null : null, url: state === 'applied' ? result.url ?? null : null, targets });
}

function unknownError(error: unknown, spec: JournalActionSpec): boolean {
  if (spec.effect !== 'irreversible') return false;
  if (!(error instanceof ChausarError)) return true;
  return spec.unknownCodes.includes(error.code) || error.code === 'JOURNAL_OUTCOME_UNKNOWN';
}

/**
 * Applies one approved action with its token and an idempotency key. The claim (token used, key kept) is committed on
 * its own before the effect starts. The same key again returns what happened without running anything; a used token
 * with another key, a key used for another action, or a token bound to anything else is refused.
 */
export async function applyAction<T>(
  deps: VentureDeps, ctx: Context, input: { entryId: string; token: string; idempotencyKey: string; timeoutMs?: number; account?: string | null },
  run: (handle: ApplyHandle) => Promise<ApplyResult<T>>,
): Promise<ApplyDone<T>> {
  requireApp(ctx);
  check(input?.account === undefined || input.account === null || (typeof input.account === 'string' && input.account.length <= 120), 'INVALID_VENTURE_REQUEST', 'The account must be one short line.');
  const entryId = requireId(input?.entryId, 'entryId');
  check(typeof input.token === 'string' && input.token.length > 0 && input.token.length <= 4096, 'INVALID_VENTURE_REQUEST', 'Send the approval.');
  const key = requireId(input.idempotencyKey, 'The idempotency key');
  check(input.timeoutMs === undefined || (Number.isInteger(input.timeoutMs) && input.timeoutMs > 0), 'INVALID_VENTURE_REQUEST', 'timeoutMs must be a whole number of milliseconds.');
  authorize(deps.store, ctx, 'approve');
  const hash = tokenHash(input.token);

  const claim = await ventureAction(deps, ctx, 'approve', 'journal.claim', tx => {
    const record = requireEntry(findIn(tx, entryId));
    check(!isShadow(record), 'JOURNAL_SHADOW', SHADOW_LINE);
    const seal = record.approval ?? null;
    if (seal && seal.key === key && seal.tokenHash === hash) {
      if (record.state === 'applied') return { replayed: true, record };
      throw decidedRefusal(record);
    }
    // 4J10 (H26): the last look before anything goes out. A replay above sends nothing, so it is still answered.
    refuseCorrupt(tx.state, tx.venture?.id);
    const claims = readApprovalToken(deps.store, input.token);
    const bound = !!claims && !!seal && seal.tokenHash === hash && claims.entryId === record.id && claims.actionDigest === digestOf(record)
      && claims.memberId === ctx.memberId && claims.epoch === ctx.epoch && claims.session === sessionOf(deps.store, ctx) && claims.businessId === businessOf(tx.state);
    check(bound, 'JOURNAL_TOKEN_INVALID', 'This approval is not for this action, this person, this session or this business. Approve it again.');
    if (record.state === 'outcome_unknown') throw decidedRefusal(record);
    check(seal!.usedAt === null, 'JOURNAL_TOKEN_USED', 'This approval was already used. Chausar never does the same thing twice.');
    if (record.state !== 'approved') throw decidedRefusal(record);
    check(!expired(claims!.expiresAt, Date.parse(tx.now)), 'JOURNAL_EXPIRED', 'This approval ran out before it was used. Approve it again.');
    const elsewhere = [...tx.list('venture-journal-entry'), ...tx.list('venture-connector-post')].some(item => item.id !== record.id && item.approval?.key === key);
    check(!elsewhere, 'JOURNAL_KEY_REUSED', 'This idempotency key belongs to another action.');
    // 4J10 (H28): the account it was approved for, and everything it depends on applied, or nothing is claimed.
    fenceAccount(record, input.account);
    checkDependenciesIn(tx, record);
    const claimed = tx.replace({ ...record, claimedAt: tx.now, approval: { ...seal!, usedAt: tx.now, key } } as Journalled);
    return { replayed: false, record: claimed };
  });
  if (claim.replayed) return { entry: claim.record, value: undefined, replayed: true };

  const spec = JOURNAL_ACTIONS[actionOf(claim.record)];
  const handle: ApplyHandle = {
    entry: claim.record,
    idempotencyKey: key,
    settleIn(tx, line, receiptId = null) {
      const current = requireEntry(findIn(tx, entryId));
      if (current.state !== 'approved') return;
      const receipt = current.kind === 'venture-journal-entry' ? { receiptId } : {};
      tx.replace(stepTo(current, 'applied', tx.now, 'engine', line, { outcome: { line, url: null, by: 'engine' }, ...receipt }));
    },
    fence(account) {
      fenceAccount(claim.record, account);
    },
  };

  let result: ApplyResult<T> | typeof TIMED_OUT;
  try {
    result = await withTimeout(run(handle), input.timeoutMs);
  } catch (error) {
    const unknown = unknownError(error, spec);
    const words = error instanceof ChausarError ? error.message : unknown ? `${spec.label} stopped part way.` : 'Chausar stopped before this was done. Nothing changed.';
    try {
      await settle(deps, ctx, entryId, unknown ? 'outcome_unknown' : 'rejected', 'engine', unknown ? withCheck(words) : words);
    } catch {
      // The effect's own error is what the owner needs to see; a claim left behind is swept to outcome_unknown.
    }
    throw error;
  }
  if (result === TIMED_OUT) {
    const line = withCheck(`${spec.label} did not finish in time.`);
    await settle(deps, ctx, entryId, 'outcome_unknown', 'engine', line);
    throw new ChausarError('JOURNAL_OUTCOME_UNKNOWN', line);
  }
  const by: OutcomeBy = result.outcome === 'unknown' ? 'engine' : result.by ?? 'engine';
  if (result.outcome === 'applied' && result.targets !== undefined) return { entry: await settleTargets(deps, ctx, entryId, by, result), value: result.value, replayed: false };
  const entry = result.outcome === 'applied'
    ? await settle(deps, ctx, entryId, 'applied', by, result.line, { receiptId: result.receiptId ?? null, url: result.url ?? null })
    : result.outcome === 'not-sent'
      ? await settle(deps, ctx, entryId, 'rejected', by, result.line)
      : await settle(deps, ctx, entryId, 'outcome_unknown', 'engine', withCheck(result.line));
  return { entry, value: result.value, replayed: false };
}

/**
 * Inside the app, in one call: propose (or take the waiting proposal of exactly this action), approve with a bound
 * token, and apply once. The token goes from the approval to the apply in memory and nowhere else.
 */
export async function journalled<T>(
  deps: VentureDeps, ctx: Context, input: ProposeInput, run: (handle: ApplyHandle) => Promise<ApplyResult<T>>,
  options: { timeoutMs?: number; offered?: { figure: string; payer: string }; standing?: { line: string }; account?: string | null } = {},
): Promise<ApplyDone<T>> {
  requireApp(ctx);
  const normalized = normalizeProposal(input);
  check(!normalized.shadow, 'JOURNAL_SHADOW', SHADOW_LINE);
  // 4J10 (H28): an action for a named account runs only when the caller says it runs under that one; else nothing is recorded.
  fenceAccount({ kind: 'venture-journal-entry', account: normalized.account }, options.account);
  const approved = await ventureAction(deps, ctx, 'approve', 'journal.approve', tx => {
    const proposed = proposeIn(tx, normalized);
    const { record, token } = approveIn(tx, ctx, deps.store, {
      entryId: proposed.id, digest: normalized.actionDigest, ...(options.offered ? { offered: options.offered } : {}),
      // A send under a standing setting (options.standing): no approver, the engine acts, the line says why.
      ...(options.standing ? { standing: true, line: options.standing.line } : {}),
    });
    return { id: record.id, token };
  });
  return applyAction(deps, ctx, {
    entryId: approved.id, token: approved.token, idempotencyKey: `${approved.id}.once`, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    // 4J10 (H28): the account the effect will run under, when the caller knows it (the fence).
    ...(options.account !== undefined ? { account: options.account } : {}),
  }, run);
}

/**
 * After an unknown outcome the owner looks and records what they found. Nothing is sent or run. A thin wrapper over
 * resolveIn, so settling has one rule and one refusal (JOURNAL_NOT_UNKNOWN) wherever it is called from.
 */
export async function resolveUnknown(deps: VentureDeps, ctx: Context, input: { entryId: string; found: 'applied' | 'not-applied'; line?: string }): Promise<Journalled> {
  requireApp(ctx);
  requireId(input?.entryId, 'entryId');
  check(input.found === 'applied' || input.found === 'not-applied', 'INVALID_VENTURE_REQUEST', 'Say whether it happened.');
  return ventureAction(deps, ctx, 'approve', 'journal.resolve', tx => {
    const happened = input.found === 'applied';
    return resolveIn(tx, requireEntry(findIn(tx, input.entryId)), happened, input.line ?? resolvedLine(happened));
  });
}

/** The owner's words for what they found, unless a kind of record has its own (a post names its platform). */
export const resolvedLine = (happened: boolean) => (happened ? 'You checked: it happened.' : 'You checked: it did not happen. Propose it again to do it.');

/**
 * Inside a transaction: the owner's finding on one record whose outcome was unknown. It happened: applied, so the same
 * action is refused from now on. It did not: rejected, so it may be proposed again. Nothing is sent or run. Any other
 * state is refused, so a finding is recorded once.
 */
export function resolveIn<R extends Journalled>(tx: VentureTx, record: R, happened: boolean, line: string): R {
  check(record.state === 'outcome_unknown', 'JOURNAL_NOT_UNKNOWN', 'Only an action whose outcome is unknown can be settled. This one already has an outcome.');
  const settled = tx.replace(ended(record, happened ? 'applied' : 'rejected', 'owner', line, tx.now) as R);
  // 4J10 (H28): it did not happen, so what waited on it ends too.
  rejectDependentsIn(tx, settled);
  return settled;
}

/**
 * After a crash or a quiet spell: a claim older than any send could take may or may not have happened, so it becomes
 * outcome_unknown and is never run again; an approval that ran out unused, and a proposal nobody decided in time, are
 * rejected. Returns what changed.
 */
export async function sweepJournal(
  deps: VentureDeps, ctx: Context, input: { claimLimitMs: number; action?: JournalActionId; unknownLine?: (record: Journalled) => string },
): Promise<Journalled[]> {
  check(Number.isInteger(input?.claimLimitMs) && input.claimLimitMs > 0, 'INVALID_VENTURE_REQUEST', 'claimLimitMs must be a whole number of milliseconds.');
  return ventureAction(deps, ctx, 'prepare', 'journal.sweep', tx => {
    const nowMs = Date.parse(tx.now);
    const swept: Journalled[] = [];
    const records: Journalled[] = [...tx.list('venture-journal-entry'), ...tx.list('venture-connector-post')];
    for (const record of records) {
      if (isShadow(record) || (input.action && actionOf(record) !== input.action)) continue;
      const label = JOURNAL_ACTIONS[actionOf(record)].label;
      if (record.state === 'approved' && record.claimedAt && nowMs - Date.parse(record.claimedAt) >= input.claimLimitMs) {
        // A phone alert (4G3) is never left for the owner to resolve: the next alert carries the current count.
        if (record.kind === 'venture-journal-entry' && STANDING_ALERTS.has(record.action)) {
          swept.push(tx.replace(ended(record, 'rejected', 'engine', `${label} was under way when Chausar stopped. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, tx.now)));
          continue;
        }
        const line = input.unknownLine ? input.unknownLine(record) : withCheck(`${label} was under way when Chausar stopped.`);
        swept.push(tx.replace(ended(record, 'outcome_unknown', 'engine', line, tx.now)));
      } else if (record.state === 'approved' && !record.claimedAt && expired(record.approval?.expiresAt, nowMs)) {
        swept.push(tx.replace(ended(record, 'rejected', 'engine', 'The approval ran out before it was used. Nothing was done.', tx.now)));
      } else if (record.state === 'described' && expired(record.expiresAt, nowMs)) {
        swept.push(tx.replace(ended(record, 'rejected', 'engine', 'Nobody decided in time. Ask for it again.', tx.now)));
      }
    }
    // 4J10 (H28): what waited on an action that ended without happening ends too.
    for (const record of swept) if (record.state === 'rejected') rejectDependentsIn(tx, record);
    return swept;
  });
}
