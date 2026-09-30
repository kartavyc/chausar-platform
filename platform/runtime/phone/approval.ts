import { PhoneError, copyBinding, isApprovalToken, isId, isOperationVersion, requirePhone, sameBinding, validAuthority, validBinding } from './contracts.ts';
import type { ApprovalChallenge, ApprovalDecision, ApprovalPreview, ApprovalReceipt, DeviceBinding, PhoneChannel, SessionAuthority } from './contracts.ts';

export const MAX_PHONE_APPROVAL_TTL_MS = 5 * 60 * 1000;

/** Server-derived authentication facts. A cached client session cannot supply these. */
export type ApprovalPrincipal = {
  authority: SessionAuthority;
  channel: PhoneChannel | 'desktop';
  role: 'owner' | 'staff' | 'accountant';
  online: boolean;
  sourceTainted: boolean;
};
export type ApprovalSession =
  | { status: 'current'; principal: ApprovalPrincipal }
  | { status: 'revoked' | 'expired' | 'unpaired' };

/** Read from the current action, catalogue and permission state inside a transaction. */
export type PhoneApprovalAction = {
  actionId: string;
  workspaceId: string;
  actionRevision: number;
  operationVersion: string;
  /** Stored action identity. */
  digest: string;
  /** Independently recomputed from the exact current canonical action in this transaction. */
  computedDigest: string;
  title: string;
  summary: string;
  status: 'prepared' | 'approved' | 'rejected' | 'cancelled' | 'executing' | 'complete' | 'unknown';
  impact: 'reversible' | 'message' | 'money' | 'destructive';
  scope: 'workspace' | 'outside-workspace';
  simple: boolean;
  /** Includes live member, source, branch, operation and write-approval permissions. */
  approvalAuthorized: boolean;
};

/** Persist the hash only. The raw token is returned once to the authenticated app. */
export type PhoneApprovalRecord = {
  preview: ApprovalPreview;
  tokenHash: string;
  targetSessionId: string;
  issuedBySessionId: string;
  consumed: boolean;
};
export type PhoneApprovalConsumption = {
  requestId: string;
  approvalId: string;
  binding: DeviceBinding;
  sessionId: string;
  actionRevision: number;
  operationVersion: string;
  digest: string;
  receipt: ApprovalReceipt;
};

/**
 * Adapter contract for shared server storage; there is deliberately no in-memory ledger.
 * All methods use one transaction's current, consistent session/member/device/action/
 * catalogue state. Sessions must be authenticated from the opaque server context;
 * their role, channel, online state and capabilities must never come from request JSON.
 * action() enforces read access before returning any action metadata.
 */
export interface PhoneApprovalTransaction<AuthContext> {
  session(context: AuthContext): ApprovalSession;
  targetSession(binding: DeviceBinding): ApprovalSession;
  action(actionId: string, principal: ApprovalPrincipal): PhoneApprovalAction | undefined;
  challenge(approvalId: string): PhoneApprovalRecord | undefined;
  insertChallenge(record: PhoneApprovalRecord): void;
  /**
   * Atomically mark the challenge consumed, persist this durable receipt/request ID,
   * and record the exact approved/rejected action disposition. No execution or queueing.
   * Reject a used challenge or a competing action decision rather than overwrite it.
   */
  commitDecision(consumption: PhoneApprovalConsumption): void;
  receipt(approvalId: string): PhoneApprovalConsumption | undefined;
}
export interface PhoneApprovalLedger<AuthContext> {
  /**
   * Serialize conflicting calls; commit all writes durably before resolving. On any
   * throw, roll back every write. Live authorization/action reads and decision writes
   * must share the atomic boundary, including changes from other server processes.
   * The callback is synchronous: perform no network IO or execution within it.
   */
  transaction<T>(work: (transaction: PhoneApprovalTransaction<AuthContext>) => T): Promise<T>;
}
export interface PhoneApprovalCrypto {
  /** Cryptographically secure bytes; test implementations must not be used in production. */
  randomBytes(length: number): Uint8Array;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
}
export const webCryptoApproval: PhoneApprovalCrypto = {
  randomBytes: length => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  sha256: async bytes => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
};

const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const copyPreview = (preview: ApprovalPreview): ApprovalPreview => ({
  approvalId: preview.approvalId, actionId: preview.actionId, binding: copyBinding(preview.binding),
  actionRevision: preview.actionRevision, operationVersion: preview.operationVersion, digest: preview.digest,
  expiresAt: preview.expiresAt, title: preview.title, summary: preview.summary, eligibility: preview.eligibility,
});
const copyReceipt = (receipt: ApprovalReceipt): ApprovalReceipt => ({ approvalId: receipt.approvalId, actionId: receipt.actionId, decision: receipt.decision, decidedAt: receipt.decidedAt });
function equalHash(left: string, right: string): boolean {
  if (!isDigest(left) || !isDigest(right)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function currentSession(session: ApprovalSession, time: number): ApprovalPrincipal {
  if (session.status !== 'current') {
    throw new PhoneError(session.status === 'revoked' ? 'ACCESS_REVOKED' : session.status === 'expired' ? 'SESSION_EXPIRED' : 'UNPAIRED');
  }
  const principal = session.principal;
  requirePhone(principal && principal.online === true, 'VALIDATION_REQUIRED');
  requirePhone(principal.authority && Date.parse(principal.authority.expiresAt) > time, 'SESSION_EXPIRED');
  requirePhone(validAuthority(principal.authority, time), 'INVALID_RESPONSE');
  requirePhone(principal.role === 'owner' && principal.sourceTainted === false, 'CAPABILITY_FORBIDDEN');
  return principal;
}
function currentCompanion(session: ApprovalSession, time: number): ApprovalPrincipal {
  const principal = currentSession(session, time);
  requirePhone(['ios', 'android', 'web', 'whatsapp', 'email'].includes(principal.channel), 'CHANNEL_FORBIDDEN');
  requirePhone(principal.authority.capabilities.includes('approval.simple'), 'CAPABILITY_FORBIDDEN');
  return principal;
}
function currentAction<AuthContext>(transaction: PhoneApprovalTransaction<AuthContext>, actionId: string, principal: ApprovalPrincipal): PhoneApprovalAction {
  const action = transaction.action(actionId, principal);
  requirePhone(action && action.workspaceId === principal.authority.binding.workspaceId, 'CAPABILITY_FORBIDDEN');
  requirePhone(action.actionId === actionId && isId(action.actionId) && isId(action.workspaceId)
    && Number.isSafeInteger(action.actionRevision) && action.actionRevision > 0
    && isOperationVersion(action.operationVersion) && isDigest(action.digest) && isDigest(action.computedDigest)
    && typeof action.title === 'string' && action.title.length <= 200
    && typeof action.summary === 'string' && action.summary.length <= 16000, 'INVALID_RESPONSE');
  requirePhone(action.approvalAuthorized === true, 'CAPABILITY_FORBIDDEN');
  requirePhone(equalHash(action.digest, action.computedDigest), 'PREVIEW_CHANGED');
  return action;
}
function isSimple(action: PhoneApprovalAction): boolean {
  return action.impact === 'reversible' && action.scope === 'workspace' && action.simple === true;
}

/**
 * Framework-neutral reference service. Wire the ledger to shared server authorization
 * and durable action storage before exposing it. It has no execution adapter, offline
 * approval queue, credential persistence, logger, URL generation, or server endpoint.
 */
export class PhoneApprovalService<AuthContext> {
  private readonly ledger: PhoneApprovalLedger<AuthContext>;
  private readonly crypto: PhoneApprovalCrypto;
  private readonly clock: () => number;
  constructor(ledger: PhoneApprovalLedger<AuthContext>, options: { crypto?: PhoneApprovalCrypto; now?: () => number } = {}) {
    this.ledger = ledger;
    this.crypto = options.crypto ?? webCryptoApproval;
    this.clock = options.now ?? Date.now;
  }
  private time(): number { const time = this.clock(); requirePhone(Number.isFinite(time), 'INVALID_RESPONSE'); return time; }
  private random(length: number): string {
    const bytes = this.crypto.randomBytes(length);
    requirePhone(bytes instanceof Uint8Array && bytes.length === length, 'INVALID_RESPONSE');
    return hex(bytes);
  }
  private async tokenHash(token: string): Promise<string> {
    const bytes = await this.crypto.sha256(new TextEncoder().encode(token));
    requirePhone(bytes instanceof Uint8Array && bytes.length === 32, 'INVALID_RESPONSE');
    return hex(bytes);
  }
  /** Trusted desktop owner issues a short-lived challenge for their own paired app. */
  async issue(ownerContext: AuthContext, targetBinding: DeviceBinding, actionId: string, ttlMs = MAX_PHONE_APPROVAL_TTL_MS): Promise<ApprovalChallenge> {
    requirePhone(validBinding(targetBinding) && isId(actionId)
      && Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= MAX_PHONE_APPROVAL_TTL_MS, 'INVALID_REQUEST');
    const target = copyBinding(targetBinding);
    const token = this.random(32);
    const tokenHash = await this.tokenHash(token);
    const approvalId = `approval_${this.random(16)}`;
    return this.ledger.transaction(transaction => {
      const time = this.time();
      const owner = currentSession(transaction.session(ownerContext), time);
      requirePhone(owner.channel === 'desktop', 'CHANNEL_FORBIDDEN');
      requirePhone(owner.authority.binding.workspaceId === target.workspaceId
        && owner.authority.binding.memberId === target.memberId
        && owner.authority.binding.epoch === target.epoch, 'CAPABILITY_FORBIDDEN');
      const companion = currentCompanion(transaction.targetSession(target), time);
      requirePhone(sameBinding(companion.authority.binding, target), 'ACCESS_REVOKED');
      // Each principal's current access is independently checked by the shared adapter.
      const ownerAction = currentAction(transaction, actionId, owner);
      const action = currentAction(transaction, actionId, companion);
      requirePhone(ownerAction.digest === action.digest && ownerAction.actionRevision === action.actionRevision
        && ownerAction.operationVersion === action.operationVersion, 'PREVIEW_CHANGED');
      requirePhone(action.status === 'prepared', 'PREVIEW_CHANGED');
      const expiresAt = new Date(Math.min(time + ttlMs, Date.parse(owner.authority.expiresAt), Date.parse(companion.authority.expiresAt))).toISOString();
      const preview: ApprovalPreview = {
        approvalId, actionId, binding: target, actionRevision: action.actionRevision,
        operationVersion: action.operationVersion, digest: action.digest, expiresAt,
        title: action.title, summary: action.summary,
        eligibility: isSimple(action) ? 'simple-reversible' : 'open-desktop',
      };
      if (preview.eligibility === 'open-desktop') return { preview: copyPreview(preview) };
      transaction.insertChallenge({ preview: copyPreview(preview), tokenHash, targetSessionId: companion.authority.sessionId, issuedBySessionId: owner.authority.sessionId, consumed: false });
      return { preview: copyPreview(preview), token };
    });
  }
  /** Online decisions consume one challenge and commit one durable decision atomically. */
  async decide(context: AuthContext, decision: ApprovalDecision): Promise<ApprovalReceipt> {
    requirePhone(decision && isId(decision.requestId) && isId(decision.approvalId)
      && isApprovalToken(decision.token) && ['approve', 'reject'].includes(decision.decision)
      && isDigest(decision.expectedDigest) && isOperationVersion(decision.expectedOperationVersion)
      && Number.isSafeInteger(decision.expectedActionRevision) && decision.expectedActionRevision > 0, 'INVALID_REQUEST');
    // Snapshot request JSON before the asynchronous hash; callers cannot change a tap.
    const request: ApprovalDecision = {
      requestId: decision.requestId, approvalId: decision.approvalId, token: decision.token, decision: decision.decision,
      expectedDigest: decision.expectedDigest, expectedActionRevision: decision.expectedActionRevision, expectedOperationVersion: decision.expectedOperationVersion,
    };
    // Hashing outside the transaction avoids awaiting between live checks and writes.
    const tokenHash = await this.tokenHash(request.token);
    return this.ledger.transaction(transaction => {
      const time = this.time();
      const principal = currentCompanion(transaction.session(context), time);
      const record = transaction.challenge(request.approvalId);
      requirePhone(record, 'INVALID_REQUEST');
      requirePhone(sameBinding(principal.authority.binding, record.preview.binding)
        && principal.authority.sessionId === record.targetSessionId, 'CAPABILITY_FORBIDDEN');
      requirePhone(equalHash(tokenHash, record.tokenHash), 'INVALID_REQUEST');
      requirePhone(!record.consumed, 'APPROVAL_USED');
      requirePhone(Number.isFinite(Date.parse(record.preview.expiresAt)) && Date.parse(record.preview.expiresAt) > time, 'APPROVAL_EXPIRED');
      requirePhone(record.preview.eligibility === 'simple-reversible', 'OPEN_DESKTOP');
      const action = currentAction(transaction, record.preview.actionId, principal);
      requirePhone(isSimple(action), 'OPEN_DESKTOP');
      requirePhone(action.status === 'prepared' && action.digest === record.preview.digest
        && action.actionRevision === record.preview.actionRevision && action.operationVersion === record.preview.operationVersion
        && request.expectedDigest === action.digest && request.expectedActionRevision === action.actionRevision
        && request.expectedOperationVersion === action.operationVersion, 'PREVIEW_CHANGED');
      const receipt: ApprovalReceipt = {
        approvalId: record.preview.approvalId, actionId: action.actionId,
        decision: request.decision === 'approve' ? 'approved' : 'rejected', decidedAt: new Date(time).toISOString(),
      };
      transaction.commitDecision({ requestId: request.requestId, approvalId: record.preview.approvalId,
        binding: copyBinding(principal.authority.binding), sessionId: principal.authority.sessionId,
        actionRevision: action.actionRevision, operationVersion: action.operationVersion, digest: action.digest, receipt: copyReceipt(receipt) });
      return receipt;
    });
  }
  /** Recover a lost response with a fresh online check; this cannot approve anything. */
  async receipt(context: AuthContext, approvalId: string): Promise<ApprovalReceipt | undefined> {
    requirePhone(isId(approvalId), 'INVALID_REQUEST');
    return this.ledger.transaction(transaction => {
      const principal = currentCompanion(transaction.session(context), this.time());
      const record = transaction.challenge(approvalId);
      requirePhone(record && sameBinding(record.preview.binding, principal.authority.binding), 'CAPABILITY_FORBIDDEN');
      currentAction(transaction, record.preview.actionId, principal);
      const result = transaction.receipt(approvalId);
      requirePhone(!result || sameBinding(result.binding, principal.authority.binding), 'INVALID_RESPONSE');
      return result ? copyReceipt(result.receipt) : undefined;
    });
  }
}
