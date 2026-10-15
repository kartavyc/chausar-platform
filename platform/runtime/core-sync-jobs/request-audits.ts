/**
 * Request audits (round 4, core-sync-jobs; TD-04): the activity record for a decided lesson, a finished backup and an
 * update check, and the lock and unlock marks. Each record carries only ids and short codes (`memberId`, `lessonId`,
 * `outcome`, `status`), which is all `frame-today/activity.ts` lets through to a screen.
 *
 * Lock and unlock never write. Opening or locking must not publish a new authority revision (retained source pins
 * survive a read-only lock and reopen, see `Engine.attachSafely`), so the marks wait in memory with the time they
 * happened and join `state.activity` in one update during the next request that already changed that workspace's
 * revision. Marks for another workspace are dropped then. Marks not yet written are lost if the app quits first.
 */
import { check, newId, type Context, type State } from '../contracts.ts';
import type { EngineEventBus } from './event-bus.ts';

type Identity = { workspaceId: string; revision: number };
type Mark = { event: 'workspace.locked' | 'workspace.unlocked'; at: string; workspaceId: string; memberId: string };
type AuditRecord = { event: string; at: string; details: Record<string, string> };
export interface AuditedVault { readIdentity(): Identity; update<T>(change: (state: State) => T | Promise<T>): Promise<T> }

const UNLOCKS = new Set(['workspace.open', 'workspace.recover', 'workspace.restore']);
// Families that pin the exact authority revision across calls: a pending mark never adds a revision inside them.
const PINNED = /^(?:workspace|scenarios|sync)\./;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const MARK_LIMIT = 64;

export class RequestAudits {
  #marks: Mark[] = [];
  readonly #events: EngineEventBus;
  readonly #vault: () => AuditedVault | null;
  readonly #context: () => Context;
  constructor(events: EngineEventBus, vault: () => AuditedVault | null, context: () => Context) { this.#events = events; this.#vault = vault; this.#context = context; }
  /** Lock and unlock marks still waiting for a write (count only; for tests and diagnostics). */
  get pending(): number { return this.#marks.length; }
  #identity(): Identity | null { try { const found = this.#vault()?.readIdentity(); return found ? { workspaceId: found.workspaceId, revision: found.revision } : null; } catch { return null; } }
  /** After every request and scheduler tick. A closing vault throws; that observation is skipped. */
  observe(): void {
    let identity: Identity | null;
    try { identity = this.#vault()?.readIdentity() ?? null; } catch { return; }
    this.#events.observe(identity);
  }
  /** Runs one request; on success writes its audit records. An audit that cannot be written never fails the request. */
  async run<T>(method: string, payload: any, work: () => Promise<T>): Promise<T> {
    const before = this.#identity();
    const reply = await work();
    try { await this.#after(method, payload, reply, before); } catch { /* A read-only device or a closing vault keeps no audit. */ }
    return reply;
  }
  #mark(event: Mark['event'], identity: Identity | null) {
    const memberId = this.#context().memberId;
    if (identity === null || typeof memberId !== 'string') return;
    this.#marks.push({ event, at: new Date().toISOString(), workspaceId: identity.workspaceId, memberId });
    if (this.#marks.length > MARK_LIMIT) this.#marks.splice(0, this.#marks.length - MARK_LIMIT);
  }
  async #after(method: string, payload: any, reply: any, before: Identity | null) {
    if (method === 'workspace.lock') { this.#mark('workspace.locked', before); return; }
    const after = this.#identity();
    if (UNLOCKS.has(method)) { this.#mark('workspace.unlocked', after); return; }
    const vault = this.#vault();
    if (after === null || vault === null) return;
    const records = this.#records(method, payload, reply);
    const changed = before !== null && before.workspaceId === after.workspaceId && before.revision !== after.revision && !PINNED.test(method);
    const marks = this.#marks.filter(mark => mark.workspaceId === after.workspaceId);
    if (!records.length && !(changed && marks.length)) return;
    const taken = new Set(marks);
    await vault.update(state => {
      check(state.workspace.id === after.workspaceId, 'AUDIT_WORKSPACE_CHANGED', 'The workspace changed before its audit was written.');
      for (const mark of marks) state.activity.push({ id: newId('event'), at: mark.at, event: mark.event, details: { memberId: mark.memberId } });
      for (const record of records) state.activity.push({ id: newId('event'), at: record.at, event: record.event, details: record.details });
    });
    // Written marks leave; marks for another workspace are dropped.
    this.#marks = this.#marks.filter(mark => !taken.has(mark) && mark.workspaceId === after.workspaceId);
  }
  #records(method: string, payload: any, reply: any): AuditRecord[] {
    const memberId = this.#context().memberId, at = new Date().toISOString();
    if (typeof memberId !== 'string') return [];
    if (method === 'memory.decideLesson') {
      const details: Record<string, string> = { memberId };
      const lessonId = reply?.candidate?.id ?? payload?.candidate?.id;
      if (typeof lessonId === 'string' && SAFE_ID.test(lessonId)) details.lessonId = lessonId;
      if (['approve', 'reject', 'defer'].includes(payload?.decision)) details.outcome = payload.decision;
      return [{ event: 'lesson.decided', at, details }];
    }
    if (method === 'workspace.backup') return [{ event: 'vault.backup.done', at, details: { memberId } }];
    if (method === 'release.checkUpdate') {
      const details: Record<string, string> = { memberId };
      if (['none', 'update', 'rollback-advised'].includes(reply?.action)) details.status = reply.action;
      return [{ event: 'release.update.checked', at, details }];
    }
    return [];
  }
}
