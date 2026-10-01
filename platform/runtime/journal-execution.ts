import { ActionService, canonical, digest, type PreparedAction } from './actions.ts';
import { authorize, check, type Context, type State, type StateStore } from './contracts.ts';
import { journalExecutionSnapshot, type JournalExecutionReceipt } from './decision-journal.ts';
import { isNoResend } from './trust.ts';

export type JournalExecutionResolver = (ctx: Context, id: string, view: StateStore) => JournalExecutionReceipt;
type AuditRecord = { id: string; at: string; event: string; details: Record<string, unknown> };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function evidence(condition: unknown, message: string): asserts condition { check(condition, 'INVALID_EXECUTION_RECEIPT', message); }
function timestamp(value: unknown): number {
  evidence(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Execution evidence needs valid persisted timestamps.');
  return Date.parse(value);
}
function plain(value: unknown): string {
  try { return canonical(value); } catch { evidence(false, 'Execution readback must be plain JSON.'); }
}
function stateView(state: State): StateStore {
  return { read: () => structuredClone(state), update: async () => { throw new Error('Execution receipt authorization is read-only.'); } };
}
function auditRecord(value: unknown): value is AuditRecord {
  return record(value) && nonblank(value.id) && typeof value.at === 'string' && typeof value.event === 'string' && record(value.details);
}
function ledger(state: State, action: PreparedAction) {
  const events = state.activity.filter(auditRecord).filter(event => event.details.actionId === action.id);
  const approval = action.approval!; const attempt = action.attempts[0];
  const preparations = events.filter(event => event.event === 'action.prepared' && event.details.memberId === action.createdBy);
  const approvals = events.filter(event => event.event === 'action.approved' && event.details.digest === action.digest && event.details.memberId === approval.memberId);
  const dispatches = events.filter(event => event.event === 'action.attempt' && event.details.attemptId === attempt.id);
  const prepared = preparations[0], approved = approvals[0], dispatched = dispatches[0];
  const verified = events.findLast(event => event.event === 'action.settled' || event.event === 'action.reconciled');
  evidence(prepared && approved && dispatched && verified, 'Execution evidence needs its durable preparation, approval, attempt and verification ledger entries.');
  evidence(preparations.length === 1 && approvals.length === 1 && dispatches.length === 1, 'Execution preparation, approval or attempt ledger entries are ambiguous.');
  evidence(action.revision !== 1 || prepared.details.digest === action.digest, 'The preparation ledger differs from the exact action.');
  if (action.revision > 1) evidence(events.some(event => event.event === 'action.revised' && event.details.revision === action.revision && timestamp(event.at) <= timestamp(approved.at)), 'The current action revision has no durable revision ledger entry.');
  evidence(verified.event === 'action.settled'
    ? verified.details.outcome === 'verified' && verified.details.businessSuccess === action.readback!.businessSuccess
    : verified.details.status === 'verified', 'The latest execution ledger entry does not confirm this verified effect.');
  const created = timestamp(action.createdAt), approvedAt = timestamp(approval.at), started = timestamp(attempt.startedAt), finished = timestamp(attempt.finishedAt);
  evidence(created <= timestamp(prepared.at) && timestamp(prepared.at) <= approvedAt && approvedAt <= timestamp(approved.at)
    && timestamp(approved.at) <= started && started <= timestamp(dispatched.at) && timestamp(dispatched.at) <= finished
    && finished <= timestamp(verified.at) && timestamp(verified.at) <= Date.now(), 'Execution evidence has conflicting or future temporal coordinates.');
  evidence(new Set([prepared.id, approved.id, dispatched.id, verified.id]).size === 4, 'Execution ledger identities are ambiguous.');
  for (const entry of [prepared, approved, dispatched, verified]) evidence(state.activity.filter(auditRecord).filter(event => event.id === entry.id).length === 1, 'Execution ledger IDs must identify one durable event.');
  return { preparedEventId: prepared.id, approvalEventId: approved.id, attemptEventId: dispatched.id, verificationEventId: verified.id, verifiedAt: verified.at };
}

/**
 * Resolves only existing action/attempt IDs with independently read-back-verified effects.
 * The installed registry supplies current connector read/qualification checks. No provider is called.
 * Job mandates, read-only job settlements, preparation previews and calculation IDs are not effect receipts.
 */
export function createJournalExecutionResolver(actions: Pick<ActionService, 'registry'>): JournalExecutionResolver {
  return (ctx, id, view) => {
    evidence(nonblank(id), 'Use an existing action or attempt ID.');
    const state = view.read(); const currentView = stateView(state); authorize(currentView, ctx);
    const matches = state.actions.filter(value => record(value) && (value.id === id || (Array.isArray(value.attempts) && value.attempts.some(attempt => record(attempt) && attempt.id === id))));
    check(matches.length > 0, 'EXECUTION_RECEIPT_NOT_FOUND', 'No authoritative action effect receipt exists for this ID.');
    evidence(matches.length === 1, 'Execution identity resolves to more than one durable action.');
    const candidate: unknown = matches[0]; evidence(record(candidate), 'Execution evidence needs an action record.');
    evidence(nonblank(candidate.id) && nonblank(candidate.connector) && nonblank(candidate.operation) && nonblank(candidate.createdBy)
      && Number.isSafeInteger(candidate.createdEpoch) && Number.isSafeInteger(candidate.revision) && Number(candidate.revision) > 0
      && typeof candidate.digest === 'string' && nonblank(candidate.idempotencyKey) && record(candidate.payload)
      && Array.isArray(candidate.sourceIds) && candidate.sourceIds.every(nonblank) && new Set(candidate.sourceIds).size === candidate.sourceIds.length
      && Array.isArray(candidate.attempts), 'Execution identity and source dependencies must be explicit.');
    const action = candidate as PreparedAction;
    const service = new ActionService(currentView, [...actions.registry.values()]);
    service.access(state, ctx, action);
    const operation = service.operation(action.connector, action.operation);
    check(operation.impact === action.impact, 'CATALOGUE_CHANGED', 'The current connector effect class differs from this action.');
    const authorization: unknown = operation.authorize?.(state, ctx, 'read');
    evidence(!(record(authorization) && typeof authorization.then === 'function'), 'Connector read authorization must complete synchronously.');
    const createdAt = timestamp(action.createdAt);
    check(createdAt >= Date.now() - state.policy.retentionDays * 86400000, 'EXECUTION_RECEIPT_EXPIRED', 'This execution evidence exceeds current retention.');
    check(!isNoResend(state, action.digest), 'EXECUTION_RECEIPT_DELETED', 'This execution evidence was deleted or expired.');
    check(action.status === 'verified', 'EXECUTION_EFFECT_UNVERIFIED', 'Only independently verified action effects can be linked. Prepared, uncertain and absent effects remain unverified.');
    evidence(action.digest === service.identity(action) && record(action.approval) && action.approval.digest === action.digest
      && action.approval.revision === action.revision && nonblank(action.approval.memberId)
      && ['owner', 'cofounder'].includes(action.approval.role) && Number.isSafeInteger(action.approval.epoch)
      && Number.isSafeInteger(action.approval.workspaceRevision), 'The durable approval does not bind the exact executed action.');
    evidence(action.attempts.length === 1 && record(action.attempts[0]) && nonblank(action.attempts[0].id)
      && action.attempts[0].id !== action.id && action.attempts[0].outcome === 'verified', 'A verified effect needs one unambiguous verified attempt.');
    const attempt = action.attempts[0]; const readback = action.readback;
    evidence(record(readback) && readback.verified === true && typeof readback.businessSuccess === 'boolean'
      && action.businessSuccess === readback.businessSuccess && record(attempt.readback)
      && plain(attempt.readback) === plain(readback) && (readback.absent === undefined || readback.absent === false),
    'Action and attempt must agree on an explicit verified provider readback.');
    evidence(readback.externalId === undefined || nonblank(readback.externalId), 'A provider external ID must be an explicit nonblank string.');
    const entries = ledger(state, action);
    const snapshot = {
      kind: 'verified-action-execution', actionId: action.id, attemptId: attempt.id,
      connector: action.connector, operation: action.operation, impact: action.impact, revision: action.revision,
      digest: action.digest, idempotencyKey: action.idempotencyKey, createdAt: action.createdAt,
      startedAt: attempt.startedAt, finishedAt: attempt.finishedAt,
      executionVerification: { state: 'verified', basis: 'persisted-provider-readback', readbackDigest: digest(readback),
        ...(readback.externalId !== undefined ? { externalId: readback.externalId } : {}) },
      providerReportedBusinessSuccess: readback.businessSuccess,
      businessOutcome: 'not-assessed', approval: {
        memberId: action.approval.memberId, role: action.approval.role, epoch: action.approval.epoch,
        digest: action.approval.digest, revision: action.approval.revision,
        workspaceRevision: action.approval.workspaceRevision, at: action.approval.at,
      }, ledger: entries,
    };
    // PreparedAction has source dependencies but no authoritative row-ID field. Payload strings are not lineage.
    return journalExecutionSnapshot({ id, sourceIds: [...action.sourceIds], rowIds: [], snapshot });
  };
}
