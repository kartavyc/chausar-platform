/**
 * The second ask (WK-02): money is approved only after the approving person types their own approval secret again,
 * for exactly this action. The owner answers with the vault passphrase; any other approving member (a cofounder)
 * answers with their own approval secret, kept here as an scrypt hash bound to their permission epoch.
 *
 * A right answer records a single-use grant in memory only (never in the vault): bound to the workspace, the member,
 * their epoch and role, the target action and its exact digest, and lasting five minutes. The core ActionService
 * consumes it inside the very write that records the approval (`secondAskGate`). Five wrong answers lock the
 * member's second ask for fifteen minutes; failures are counted before the answer is known, so parallel guesses
 * cannot slip past the limit.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { audit, check, newId, type Context, type State, type StateStore } from '../contracts.ts';
import { current, type PreparedAction } from '../actions.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';

export const MODULE_ID = 'core-gateway-auth';
export const GRANT_MS = 5 * 60_000, LOCK_MS = 15 * 60_000, MAX_FAILURES = 5;
export const SECRET_MIN = 10, SECRET_MAX = 1024;
/** scrypt cost for member secrets: 2^15 × 8 × 1 (32 MiB, roughly a tenth of a second). Kept on each record so it can rise later. */
const COST = { N: 2 ** 15, r: 8, p: 1 } as const;

export type MemberSecret = { salt: string; hash: string; N: number; r: number; p: number; epoch: number; at: string };
export type GatewayAuthState = { secrets: Record<string, MemberSecret> };
export const laneState = (state: State) => moduleState<GatewayAuthState>(state, MODULE_ID, () => ({ secrets: {} }));
const peekSecrets = (state: State) => peekModuleState<GatewayAuthState>(state, MODULE_ID)?.secrets ?? {};

type Grant = { workspaceId: string; memberId: string; epoch: number; role: Context['role']; kind: 'action'; targetId: string; digest: string; expiresAt: number };
type Failures = { count: number; since: number; lockedUntil: number | null };
/** In memory only: a restart forgets every grant and every failure count (a restart also locks the vault). */
const grants = new Map<string, Grant>();
const failures = new Map<string, Failures>();
const failureKey = (workspaceId: string, memberId: string) => `${workspaceId}\u0000${memberId}`;

function hashSecret(secret: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...cost, maxmem: 128 * cost.N * cost.r * cost.p + 16 * 1024 * 1024 };
  return new Promise((resolve, reject) => scryptCallback(secret.normalize('NFC'), salt, 32, options, (error, key) => error ? reject(error) : resolve(key)));
}
export async function newMemberSecret(secret: string, epoch: number, at: string): Promise<MemberSecret> {
  const salt = randomBytes(16);
  return { salt: salt.toString('hex'), hash: (await hashSecret(secret, salt, COST)).toString('hex'), ...COST, epoch, at };
}
async function matches(record: MemberSecret, secret: string): Promise<boolean> {
  const expected = Buffer.from(record.hash, 'hex');
  const key = await hashSecret(secret, Buffer.from(record.salt, 'hex'), { N: record.N, r: record.r, p: record.p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
/** The caller's own current secret record; a record from an older permission epoch is void. */
export function memberSecret(state: State, memberId: string, epoch: number): MemberSecret | null {
  const record = Object.hasOwn(peekSecrets(state), memberId) ? peekSecrets(state)[memberId] : undefined;
  return record && record.epoch === epoch ? record : null;
}

/** Second asks are answered by a person in the desktop app, with their own approving seat. */
export function askerGate(state: State, context: Context) {
  check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot answer a second ask.');
  check(context.channel === undefined || context.channel === 'desktop', 'APP_APPROVAL_REQUIRED', 'Answer the second ask inside the desktop app.');
  return current(state, context, 'approve');
}
/** When the member's second ask is locked, the time it opens again (ms); null otherwise. */
export function lockedUntil(workspaceId: string, memberId: string, at = Date.now()): number | null {
  const entry = failures.get(failureKey(workspaceId, memberId));
  if (!entry) return null;
  if (entry.lockedUntil !== null && entry.lockedUntil <= at) { failures.delete(failureKey(workspaceId, memberId)); return null; }
  return entry.lockedUntil;
}

/**
 * Checks the caller's own approval secret. The owner answers with the vault passphrase (`store.verifyPassphrase`);
 * any other approving member answers with their own approval secret (`secondAsk.setSecret`).
 *
 * Contract for other lanes (write-back may call this in place of its owner-only passphrase check):
 *  - Call it outside `store.update` (it writes an audit line when it locks) with the caller's own Context.
 *  - Resolves true for the right secret (and clears the member's failure count), false for a wrong one (counted).
 *  - Throws TAINTED_APPROVAL, APP_APPROVAL_REQUIRED (phone or numbers server), FORBIDDEN or ACCESS_REVOKED (not an
 *    approving seat), SECOND_ASK_LOCKED (five wrong answers: fifteen minutes), SECOND_ASK_SECRET_NOT_SET (a non-owner
 *    without a current secret) and SECOND_ASK_UNAVAILABLE (this store cannot check a passphrase).
 *  - It keeps no copy of the secret and never puts it in an error, an audit line or a reply.
 *  - It grants nothing by itself: the caller binds its own single-use answer to the exact change (as `secondAsk.grant` does).
 */
export async function verifySecondAskSecret(store: StateStore, ctx: Context, secret: unknown): Promise<boolean> {
  const state = store.read(); const member = askerGate(state, ctx);
  const workspaceId = state.workspace.id, key = failureKey(workspaceId, member.id), at = Date.now();
  check(lockedUntil(workspaceId, member.id, at) === null, 'SECOND_ASK_LOCKED', 'Too many wrong answers. Wait fifteen minutes.');
  const owner = member.role === 'owner';
  const verifyPassphrase = (store as { verifyPassphrase?: unknown }).verifyPassphrase;
  check(!owner || typeof verifyPassphrase === 'function', 'SECOND_ASK_UNAVAILABLE', 'This app cannot check your passphrase, so money cannot be approved here.');
  const record = owner ? null : memberSecret(state, member.id, member.epoch);
  check(owner || record, 'SECOND_ASK_SECRET_NOT_SET', 'Set your own approval secret first.');
  // Counted before the answer is known: a wrong guess running in parallel already spends one of the five tries.
  const prior = failures.get(key); const fresh = !prior || at - prior.since > LOCK_MS;
  const entry: Failures = fresh ? { count: 1, since: at, lockedUntil: null } : { ...prior!, count: prior!.count + 1 };
  if (entry.count >= MAX_FAILURES) entry.lockedUntil = at + LOCK_MS;
  failures.set(key, entry);
  let ok = false;
  if (typeof secret === 'string' && secret.length >= 1 && secret.length <= SECRET_MAX) {
    try { ok = owner ? await (verifyPassphrase as (value: string) => Promise<boolean>).call(store, secret) === true : await matches(record!, secret); } catch { ok = false; }
  }
  if (ok) { failures.delete(key); return true; }
  if (entry.count === MAX_FAILURES) await store.update(next => { audit(next, 'secondAsk.locked', { memberId: member.id, until: new Date(entry.lockedUntil!).toISOString() }); });
  return false;
}

/** Records a single-use grant for exactly this target. A newer grant for the same member and target replaces the older one. */
export function recordGrant(state: State, ctx: Context, target: { kind: 'action'; id: string; digest: string }, at = Date.now()): { id: string; expiresAt: number } {
  for (const [id, grant] of grants) if (grant.expiresAt <= at || (grant.workspaceId === state.workspace.id && grant.memberId === ctx.memberId && grant.kind === target.kind && grant.targetId === target.id)) grants.delete(id);
  const id = newId('secondask'), expiresAt = at + GRANT_MS;
  grants.set(id, { workspaceId: state.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch, role: ctx.role, kind: target.kind, targetId: target.id, digest: target.digest, expiresAt });
  return { id, expiresAt };
}
/** Drops every grant a member holds in this workspace (their secret was cleared). */
export function dropGrants(workspaceId: string, memberId: string) {
  for (const [id, grant] of grants) if (grant.workspaceId === workspaceId && grant.memberId === memberId) grants.delete(id);
}

/**
 * The core ActionService's money gate, called inside the approval write after every other check. It consumes the one
 * grant for exactly this member, epoch, role, action and digest; without one the approval is refused.
 */
export function secondAskGate(state: State, context: Context, action: PreparedAction): void {
  const at = Date.now(); let found: string | null = null;
  for (const [id, grant] of grants) {
    if (grant.expiresAt <= at) { grants.delete(id); continue; }
    if (grant.workspaceId === state.workspace.id && grant.memberId === context.memberId && grant.epoch === context.epoch && grant.role === context.role
      && grant.kind === 'action' && grant.targetId === action.id && grant.digest === action.digest) found = id;
  }
  check(found, 'SECOND_ASK_REQUIRED', 'Money needs your passphrase or approval secret again before it is approved.');
  grants.delete(found);
}
