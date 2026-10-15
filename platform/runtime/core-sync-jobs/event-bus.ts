/**
 * The engine event bus (round 4, core-sync-jobs): a bare change counter for live screens. The engine observes the open
 * workspace's identity after every request and scheduler tick; only a different workspace or a new authority revision
 * bumps `seq` and wakes the listeners. Nothing about the change travels here: a woken screen asks `events.subscribe`
 * for the typed events it may see. Observing reads `Vault.readIdentity()` only, never the full state.
 */
export type EngineIdentity = { readonly workspaceId: string; readonly revision: number };

export class EngineEventBus {
  #seq = 0;
  #last: EngineIdentity | null = null;
  #listeners = new Set<(seq: number) => void>();
  get seq(): number { return this.#seq; }
  /** The identity seen at the last observation (null while no workspace is open). */
  get last(): EngineIdentity | null { return this.#last; }
  observe(identity: { workspaceId: string; revision: number } | null): void {
    const next = identity === null ? null : { workspaceId: identity.workspaceId, revision: identity.revision };
    const last = this.#last;
    if (last === next || (last !== null && next !== null && last.workspaceId === next.workspaceId && last.revision === next.revision)) return;
    this.#last = next; this.#seq++;
    for (const listener of [...this.#listeners]) { try { listener(this.#seq); } catch { /* A listener never breaks the engine. */ } }
  }
  on(listener: (seq: number) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
}
