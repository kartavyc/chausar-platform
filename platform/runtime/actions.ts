import { authorize, audit, check, ChausarError, hash, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { assertSourceAccess } from './trust.ts';

/** Canonical JSON is used for every approval: property ordering never changes its meaning. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), 'INVALID_PAYLOAD', 'Numbers must be finite.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  check(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_PAYLOAD', 'Payloads must contain plain JSON data.');
  return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
}
export const digest = (value: unknown) => hash(canonical(value));
function providerRecord<T>(value: T): T {
  const serialized = JSON.stringify(value); check(typeof serialized === 'string' && serialized.length <= 2 * 1024 * 1024, 'INVALID_PROVIDER_RESULT', 'Provider results must be bounded JSON records.');
  const clean = JSON.parse(serialized); canonical(clean); return clean;
}
export function current(state: State, context: Context, permission: 'read' | 'prepare' | 'approve' | 'admin' = 'read') {
  return authorize({ read: () => state, update: async () => { throw new Error('Read-only authorization view.'); } }, context, permission);
}
export function sourceAccess(state: State, context: Context, sourceIds: string[]) {
  const member = current(state, context);
  assertSourceAccess(state, context, sourceIds);
  for (const source of sourceIds) {
    check(state.policy.allowedSources.includes('*') || state.policy.allowedSources.includes(source), 'SOURCE_REVOKED', `Access to source ${source} has been revoked.`);
    const rules = state.sourceRules.filter(r => (r.sourceId === source || r.id === source) && (r.memberId === context.memberId || !r.memberId));
    check(!rules.some(r => r.active === false || r.read === false || r.revoked === true), 'SOURCE_REVOKED', 'Source read permission was revoked.');
    const branches = state.facts.filter(f => f.sourceId === source).map(f => f.branch);
    check(member.branches.includes('*') || branches.every(b => Boolean(b) && member.branches.includes(b!)), 'BRANCH_FORBIDDEN', 'The action includes a branch outside your permissions.');
  }
}
export type ActionResult = { externalId?: string; data?: unknown; businessSuccess?: boolean };
export type Readback = { verified: boolean; businessSuccess: boolean; data?: unknown; externalId?: string; absent?: boolean };
export type Operation = {
  title: string; description: string; impact: 'reversible' | 'message' | 'money' | 'destructive';
  idempotency: string; readback: string;
  validate: (payload: unknown) => Record<string, unknown>;
  /** Independent read and write grants. This is checked again before provider invocation. */
  authorize?: (state: State, context: Context, mode: 'read' | 'write') => void;
  execute: (payload: Record<string, unknown>, key: string, context: Context) => Promise<ActionResult>;
  reconcile: (payload: Record<string, unknown>, key: string, result: ActionResult | undefined, context: Context) => Promise<Readback>;
};
export type Connector = { id: string; title: string; operations: Record<string, Operation> };
export type ActionAttempt = { id: string; startedAt: string; finishedAt?: string; outcome: 'executing' | 'verified' | 'unknown' | 'rejected'; error?: string; result?: ActionResult; readback?: Readback };
export type PreparedAction = {
  id: string; connector: string; operation: string; payload: Record<string, unknown>; sourceIds: string[];
  idempotencyKey: string; digest: string; revision: number; createdBy: string; createdEpoch: number; createdAt: string;
  impact: Operation['impact']; status: 'prepared' | 'approved' | 'executing' | 'verified' | 'unknown' | 'rejected' | 'blocked' | 'cancelled';
  approval?: { memberId: string; role: Context['role']; epoch: number; digest: string; revision: number; workspaceRevision: number; at: string };
  attempts: ActionAttempt[]; result?: ActionResult; readback?: Readback; businessSuccess?: boolean; blockedReason?: string;
};
/** core-gateway-auth: rules that hide an action from a member (the staff seat sees only its own, TR-06). Registered by engine modules at load. */
type ActionHidden = (state: State, member: ReturnType<typeof current>, action: PreparedAction) => boolean;
const actionHiddenRules = new Set<ActionHidden>();
export function registerActionHidden(rule: ActionHidden): void { actionHiddenRules.add(rule); }
export type PrepareAction = { connector: string; operation: string; payload: unknown; idempotencyKey: string; sourceIds?: string[] };

export class ActionService {
  store: StateStore; registry: Map<string, Connector>;
  active = new Set<string>();
  /** Optional money gate (core-gateway-auth's second ask): throws unless the approver answered it for exactly this action. */
  readonly secondAsk?: (state: State, context: Context, action: PreparedAction) => void;
  constructor(store: StateStore, connectors: Connector[] = [], options?: { secondAsk?: (state: State, context: Context, action: PreparedAction) => void }) {
    this.store = store; this.registry = new Map();
    this.secondAsk = options?.secondAsk;
    for (const connector of connectors) {
      check(!this.registry.has(connector.id) && /^[a-z][a-z0-9-]{0,63}$/.test(connector.id), 'INVALID_CONNECTOR', 'Connector IDs must be unique.');
      for (const operation of Object.values(connector.operations)) check(operation.idempotency && operation.readback && typeof operation.execute === 'function' && typeof operation.reconcile === 'function', 'INVALID_CONNECTOR', 'Every operation needs an idempotency and readback contract.');
      this.registry.set(connector.id, connector);
    }
  }
  catalogue(context: Context) {
    authorize(this.store, context);
    return [...this.registry.values()].map(c => ({ id: c.id, title: c.title, operations: Object.entries(c.operations).map(([id, o]) => ({ id, title: o.title, description: o.description, impact: o.impact, idempotency: o.idempotency, readback: o.readback })) }));
  }
  operation(connector: string, operation: string): Operation {
    const entry = this.registry.get(connector)?.operations[operation]; check(entry, 'UNSUPPORTED_ACTION', 'This action is absent from the written connector catalogue.'); return entry;
  }
  access(state: State, context: Context, action: PreparedAction) {
    const member = current(state, context);
    // A hidden action answers exactly like a missing one, so its existence is not revealed.
    for (const hidden of actionHiddenRules) check(!hidden(state, member, action), 'NOT_FOUND', 'Action not found.');
    sourceAccess(state, context, action.sourceIds);
    if (action.sourceIds.length === 0) check((action.createdBy === context.memberId && action.createdEpoch === context.epoch) || (member.role === 'owner' && member.branches.includes('*')), 'ACTION_FORBIDDEN', 'This private local action belongs to another account or permission epoch.');
  }
  list(context: Context): PreparedAction[] {
    authorize(this.store, context);
    return this.store.read().actions.filter((a: PreparedAction) => { try { this.access(this.store.read(), context, a); this.operation(a.connector, a.operation).authorize?.(this.store.read(), context, 'read'); return true; } catch { return false; } }).map(a => structuredClone(a));
  }
  identity(action: PreparedAction) { return digest({ connector: action.connector, operation: action.operation, payload: action.payload, sourceIds: action.sourceIds, idempotencyKey: action.idempotencyKey, revision: action.revision }); }
  async prepare(context: Context, request: PrepareAction): Promise<PreparedAction> {
    const operation = this.operation(request.connector, request.operation);
    check(typeof request.idempotencyKey === 'string' && request.idempotencyKey.length >= 8 && request.idempotencyKey.length <= 200, 'INVALID_IDEMPOTENCY_KEY', 'Use a stable idempotency key of 8–200 characters.');
    const payload = JSON.parse(canonical(operation.validate(JSON.parse(canonical(request.payload)))));
    const sourceIds = [...new Set(request.sourceIds ?? [])].sort();
    check(sourceIds.every(s => typeof s === 'string' && s.length > 0), 'INVALID_SOURCES', 'Source IDs must be non-empty strings.');
    return this.store.update(state => {
      current(state, context, 'prepare'); sourceAccess(state, context, sourceIds); operation.authorize?.(state, context, 'write');
      const existing = state.actions.find(a => a.connector === request.connector && a.operation === request.operation && a.idempotencyKey === request.idempotencyKey) as PreparedAction | undefined;
      if (existing) { this.access(state, context, existing); check(canonical(existing.payload) === canonical(payload) && canonical(existing.sourceIds) === canonical(sourceIds), 'IDEMPOTENCY_CONFLICT', 'That key already belongs to a different exact action.'); return structuredClone(existing); }
      const action: PreparedAction = { id: newId('action'), connector: request.connector, operation: request.operation, payload, sourceIds, idempotencyKey: request.idempotencyKey, digest: '', revision: 1, createdBy: context.memberId, createdEpoch: context.epoch, createdAt: now(), impact: operation.impact, status: 'prepared', attempts: [] };
      action.digest = this.identity(action); state.actions.push(action); audit(state, 'action.prepared', { actionId: action.id, digest: action.digest, memberId: context.memberId, taintedSource: context.sourceTainted === true }); return structuredClone(action);
    });
  }
  async revise(context: Context, id: string, payload: unknown): Promise<PreparedAction> {
    return this.store.update(state => {
      current(state, context, 'prepare'); const action = this.find(state, id); this.access(state, context, action);
      check(action.attempts.length === 0 && !['executing', 'cancelled'].includes(action.status), 'ACTION_ALREADY_ATTEMPTED', 'An attempted action cannot be revised.');
      const op = this.operation(action.connector, action.operation); op.authorize?.(state, context, 'write');
      action.payload = JSON.parse(canonical(op.validate(payload))); action.revision += 1; action.digest = this.identity(action); delete action.approval; action.status = 'prepared'; audit(state, 'action.revised', { actionId: id, revision: action.revision }); return structuredClone(action);
    });
  }
  async approve(context: Context, id: string, expectedDigest: string): Promise<PreparedAction> {
    return this.store.update(state => {
      current(state, context, 'approve'); check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot authorize an action.');
      const action = this.find(state, id); this.access(state, context, action); const op = this.operation(action.connector, action.operation); op.authorize?.(state, context, 'write');
      check(context.channel !== 'phone' || op.impact === 'message', 'APP_APPROVAL_REQUIRED', 'Money and other actions must be approved inside the app.');
      check(action.status === 'prepared' && action.attempts.length === 0, 'INVALID_ACTION_STATE', 'Only a prepared, unattempted action can be approved.');
      check(expectedDigest === action.digest && action.digest === this.identity(action), 'PREVIEW_CHANGED', 'The exact action changed. Review its new preview.');
      if (this.secondAsk && (action.impact === 'money' || op.impact === 'money')) this.secondAsk(state, context, action);
      action.approval = { memberId: context.memberId, role: context.role, epoch: context.epoch, digest: expectedDigest, revision: action.revision, workspaceRevision: state.revision, at: now() }; action.status = 'approved'; audit(state, 'action.approved', { actionId: id, digest: expectedDigest, memberId: context.memberId }); return structuredClone(action);
    });
  }
  find(state: State, id: string): PreparedAction { const action = state.actions.find(a => a.id === id); check(action, 'NOT_FOUND', 'Action not found.'); return action; }
  approved(state: State, context: Context, action: PreparedAction) {
    current(state, context, 'prepare'); check(!context.sourceTainted, 'TAINTED_EXECUTION', 'Imported text cannot execute an action.');
    const approval = action.approval; check(approval, 'APPROVAL_REQUIRED', 'Review and approve the exact preview first.');
    current(state, { memberId: approval.memberId, role: approval.role, epoch: approval.epoch }, 'approve');
    this.access(state, context, action); this.access(state, { memberId: approval.memberId, role: approval.role, epoch: approval.epoch }, action);
    check(approval.digest === action.digest && action.digest === this.identity(action) && approval.revision === action.revision, 'PREVIEW_CHANGED', 'Approval no longer matches the exact action.');
    const op = this.operation(action.connector, action.operation); check(action.impact === op.impact, 'CATALOGUE_CHANGED', 'The connector impact changed; review a new action.'); op.authorize?.(state, context, 'write'); op.authorize?.(state, { memberId: approval.memberId, role: approval.role, epoch: approval.epoch }, 'write');
    check(context.channel !== 'phone', 'APP_EXECUTION_REQUIRED', 'Action execution is available only inside the app.');
  }
  async execute(context: Context, id: string): Promise<PreparedAction> {
    const reserved = await this.store.update(state => {
      const action = this.find(state, id); this.approved(state, context, action);
      check(action.status === 'approved' && action.attempts.length === 0, 'ACTION_ALREADY_ATTEMPTED', 'Actions execute once. Reconcile uncertain results before considering a new action.');
      // Sending stays closed while an earlier outside effect is unsettled: check it before anything else leaves.
      check(action.impact === 'reversible' || !state.actions.some((other: PreparedAction) => other.id !== id && other.impact !== 'reversible' && ['executing', 'unknown'].includes(other.status)), 'SENDING_CLOSED', 'An earlier message, payment or deletion is not settled. Check it before sending another.');
      action.status = 'executing'; action.attempts.push({ id: newId('attempt'), startedAt: now(), outcome: 'executing' }); audit(state, 'action.attempt', { actionId: id, attemptId: action.attempts[0].id }); return structuredClone(action);
    });
    this.active.add(id);
    const op = this.operation(reserved.connector, reserved.operation); let result: ActionResult | undefined; let back: Readback | undefined; let error: string | undefined;
    try {
      this.approved(this.store.read(), context, this.find(this.store.read(), id));
      result = providerRecord(await op.execute(structuredClone(reserved.payload), reserved.idempotencyKey, context));
      this.approved(this.store.read(), context, this.find(this.store.read(), id)); op.authorize?.(this.store.read(), context, 'read');
      back = providerRecord(await op.reconcile(structuredClone(reserved.payload), reserved.idempotencyKey, result, context));
      check(typeof back.verified === 'boolean' && typeof back.businessSuccess === 'boolean', 'INVALID_PROVIDER_RESULT', 'Readback must explicitly report verification and business success.');
    } catch (failure) { back = undefined; error = failure instanceof ChausarError ? failure.code : 'PROVIDER_OUTCOME_UNKNOWN'; }
    let settled: PreparedAction | null;
    try { settled = await this.store.update(state => {
      const action = state.actions.find(a => a.id === id) as PreparedAction | undefined;
      if (!action) { audit(state, 'action.deleted-while-executing', { actionId: id, outcome: 'unknown' }); return null; }
      const attempt = action.attempts[0];
      if (result !== undefined) { action.result = JSON.parse(canonical(result)); attempt.result = action.result; }
      if (back !== undefined) { action.readback = JSON.parse(canonical(back)); attempt.readback = action.readback; }
      action.status = back?.verified === true ? 'verified' : 'unknown'; action.businessSuccess = back?.verified === true ? back.businessSuccess : undefined;
      attempt.outcome = back?.verified === true ? 'verified' : 'unknown'; attempt.finishedAt = now(); if (error) attempt.error = error;
      audit(state, 'action.settled', { actionId: id, outcome: action.status, businessSuccess: action.businessSuccess ?? null }); return structuredClone(action);
    }); } finally { this.active.delete(id); }
    // Settlement survives a revocation; the revoked caller never receives the payload or result.
    authorize(this.store, context); sourceAccess(this.store.read(), context, reserved.sourceIds); check(settled, 'ACTION_REMOVED', 'This action was removed while its provider was running. Its result remains unknown.'); this.access(this.store.read(), context, settled); return settled;
  }
  async reconcile(context: Context, id: string): Promise<PreparedAction> {
    const action = this.find(this.store.read(), id); this.access(this.store.read(), context, action);
    check(action.status === 'unknown', 'INVALID_ACTION_STATE', 'Only an uncertain attempted action needs reconciliation.');
    const op = this.operation(action.connector, action.operation); op.authorize?.(this.store.read(), context, 'read');
    const back = providerRecord(await op.reconcile(structuredClone(action.payload), action.idempotencyKey, structuredClone(action.result), context));
    check(typeof back.verified === 'boolean' && typeof back.businessSuccess === 'boolean', 'INVALID_PROVIDER_RESULT', 'Readback must explicitly report verification and business success.');
    return this.store.update(state => {
      this.access(state, context, action); op.authorize?.(state, context, 'read'); const currentAction = this.find(state, id);
      currentAction.readback = JSON.parse(canonical(back)); currentAction.attempts[0].readback = currentAction.readback;
      if (back.verified) { currentAction.status = 'verified'; currentAction.businessSuccess = back.businessSuccess; currentAction.attempts[0].outcome = 'verified'; }
      else if (back.absent === true) { currentAction.status = 'rejected'; currentAction.attempts[0].outcome = 'rejected'; currentAction.businessSuccess = false; }
      audit(state, 'action.reconciled', { actionId: id, status: currentAction.status }); return structuredClone(currentAction);
    });
  }
  async cancel(context: Context, id: string) { return this.store.update(state => { current(state, context, 'approve'); const action = this.find(state, id); this.access(state, context, action); check(action.attempts.length === 0, 'ACTION_ALREADY_ATTEMPTED', 'An attempted action must be reconciled.'); action.status = 'cancelled'; delete action.approval; audit(state, 'action.cancelled', { actionId: id }); return structuredClone(action); }); }
  /** Called by the single engine after opening an exclusively locked vault, before dispatching requests. */
  async recoverInterrupted(context: Context) { return this.store.update(state => { current(state, context, 'admin'); const ids: string[] = []; for (const action of state.actions as PreparedAction[]) { if (action.status !== 'executing' || this.active.has(action.id)) continue; action.status = 'unknown'; const attempt = action.attempts[0]; if (attempt) { attempt.outcome = 'unknown'; attempt.finishedAt = now(); attempt.error = 'PROCESS_INTERRUPTED'; } try { sourceAccess(state, context, action.sourceIds); ids.push(action.id); } catch { /* Recover the journal even when this owner may not view its source payload. */ } audit(state, 'action.interrupted', { actionId: action.id, outcome: 'unknown' }); } return { recovered: ids }; }); }
}
