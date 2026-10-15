/**
 * Request audits (round 4, core-sync-jobs; TD-04): the activity record for a decided lesson, a finished backup, an
 * update check, a lock and an unlock. Each record carries only ids and short codes (`memberId`, `lessonId`, `outcome`,
 * `status`), which is all `frame-today/activity.ts` lets through to a screen.
 *
 * None of them publishes a revision of its own. Opening, locking, backing up and checking for an update are read-only
 * for the workspace (retained source pins survive a read-only lock and reopen, see `Engine.attachSafely`; a backup's
 * bytes are the state it saved). So each record waits in memory with the time it happened and joins `state.activity`
 * inside the next write a request makes to that same workspace: the request's own `update` appends it before commit,
 * in the same revision. Writes of `workspace.*`, `scenarios.*`, `sync.*`, `devices.*` and `seats.inviteVerify` requests, which fingerprint or pin the exact
 * state they commit, never carry them. A decided lesson joins the decision's own write. Records for another workspace are dropped
 * when that workspace's write lands. Records not yet written are lost if the app quits first.
 */
import type { Context, State } from '../contracts.ts';
import { newId } from '../contracts.ts';
import type { EngineEventBus } from './event-bus.ts';

type Identity = { workspaceId: string; revision: number };
type Pending = { event: string; at: string; workspaceId: string; details: Record<string, string> };
type Update = <T>(change: (state: State) => T | Promise<T>) => Promise<T>;
export interface AuditedVault { readIdentity(): Identity; update: Update }

const UNLOCKS = new Set(['workspace.open', 'workspace.recover', 'workspace.restore']);
// Families whose writes fingerprint or pin the exact state they commit (sync previews, backups, scenarios): never folded into.
// The machine methods send encrypted copies through sync previews, so they are pinned too.
const PINNED = /^(?:workspace|scenarios|sync|devices)\.|^seats\.inviteVerify$/;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const LIMIT = 64;

export class RequestAudits {
  #pending: Pending[] = [];
  #folding = false;
  readonly #events: EngineEventBus;
  readonly #vault: () => AuditedVault | null;
  readonly #context: () => Context;
  constructor(events: EngineEventBus, vault: () => AuditedVault | null, context: () => Context) { this.#events = events; this.#vault = vault; this.#context = context; }
  /** Records still waiting for a write (count only; for tests and diagnostics). */
  get pending(): number { return this.#pending.length; }
  #identity(): Identity | null { try { const found = this.#vault()?.readIdentity(); return found ? { workspaceId: found.workspaceId, revision: found.revision } : null; } catch { return null; } }
  /** After every request and scheduler tick. A closing vault throws; that observation is skipped. */
  observe(): void {
    let identity: Identity | null;
    try { identity = this.#vault()?.readIdentity() ?? null; } catch { return; }
    this.#events.observe(identity);
  }
  /** Runs one request, folding waiting records into its writes, then queues its own record when it succeeded. */
  async run<T>(method: string, payload: any, work: () => Promise<T>): Promise<T> {
    const before = this.#identity();
    // A lesson decision's record joins the decision's own write; it leaves again if the request fails unwritten.
    const own = method === 'memory.decideLesson' && before ? this.#queue(before, 'lesson.decided', this.#lesson(payload)) : null;
    const restore = PINNED.test(method) ? () => {} : this.#fold();
    let reply: T;
    try { reply = await work(); }
    catch (error) { if (own) this.#pending = this.#pending.filter(item => item !== own); throw error; }
    finally { restore(); }
    try {
      if (method === 'workspace.lock') this.#queue(before, 'workspace.locked', {});
      else if (UNLOCKS.has(method)) this.#queue(this.#identity(), 'workspace.unlocked', {});
      else if (method === 'workspace.backup') this.#queue(before, 'vault.backup.done', {});
      else if (method === 'release.checkUpdate') {
        const action = (reply as any)?.action;
        this.#queue(before, 'release.update.checked', ['none', 'update', 'rollback-advised'].includes(action) ? { status: action } : {});
      }
    } catch { /* An audit never fails the request. */ }
    return reply;
  }
  #lesson(payload: any): Record<string, string> {
    const details: Record<string, string> = {}, lessonId = payload?.candidate?.id;
    if (typeof lessonId === 'string' && SAFE_ID.test(lessonId)) details.lessonId = lessonId;
    if (['approve', 'reject', 'defer'].includes(payload?.decision)) details.outcome = payload.decision;
    return details;
  }
  #queue(identity: Identity | null, event: string, details: Record<string, string>): Pending | null {
    const memberId = this.#context().memberId;
    if (identity === null || typeof memberId !== 'string') return null;
    const item: Pending = { event, at: new Date().toISOString(), workspaceId: identity.workspaceId, details: { ...details, memberId } };
    this.#pending.push(item);
    if (this.#pending.length > LIMIT) this.#pending.splice(0, this.#pending.length - LIMIT);
    return item;
  }
  /** While a request runs, its vault writes append the waiting records before they commit. One request folds at a time. */
  #fold(): () => void {
    const vault = this.#vault();
    if (!vault || this.#folding || !this.#pending.length) return () => {};
    const own = Object.getOwnPropertyDescriptor(vault, 'update'), original: Update = vault.update.bind(vault);
    const update = (<T>(change: (state: State) => T | Promise<T>): Promise<T> => {
      let taken: Pending[] = [];
      const appended = original<T>(async state => {
        const result = await change(state);
        taken = this.#pending.filter(item => item.workspaceId === state.workspace.id);
        for (const item of taken) state.activity.push({ id: newId('event'), at: item.at, event: item.event, details: { ...item.details } });
        taken = [...taken, ...this.#pending.filter(item => item.workspaceId !== state.workspace.id)];
        return result;
      });
      // Written records leave; records for another workspace are dropped with them.
      return appended.then(result => { const gone = new Set(taken); this.#pending = this.#pending.filter(item => !gone.has(item)); return result; });
    }) as Update;
    try { Object.defineProperty(vault, 'update', { value: update, configurable: true, writable: true }); } catch { return () => {}; }
    this.#folding = true;
    return () => {
      this.#folding = false;
      if (own) Object.defineProperty(vault, 'update', own); else delete (vault as { update?: unknown }).update;
    };
  }
}
