// Chausar venture launcher, the draft desk: an in-memory state store for AI work before any vault exists.
// Not a vault and never written to disk. It holds one draft venture record so the model port's own rules (record
// each call before sending it, the monthly cap, the consent digest, one dispatch per call) work unchanged. The
// transaction rules match the vault's: updates run one at a time, a nested update rejects REENTRANT_TRANSACTION,
// and reads and commits are deep copies.
import { AsyncLocalStorage } from 'node:async_hooks';
import { ChausarError, initialState, newId, now, type Context, type State, type StateStore } from '../../contracts.ts';
import { digest } from '../records.ts';
import type { CountryProfile, VentureRecord } from '../contracts.ts';

/** The fixed context the desk authorizes with against its own store, after checking the caller is the owner in the app. */
export const DESK_CONTEXT: Context = Object.freeze({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }) as Context;
export const DRAFT_IDEA = 'A business not kept yet';

export class DraftStore implements StateStore {
  #state: State;
  #chain: Promise<unknown> = Promise.resolve();
  #transaction = new AsyncLocalStorage<boolean>();
  readonly ventureId: string;

  constructor(country: CountryProfile) {
    const state = initialState('Draft', false);
    // Question shapes may be sent: the owner consents per connection, and the consent text says so.
    state.policy.send = 'shape';
    const at = now();
    this.ventureId = newId('venture_draft');
    const venture: VentureRecord = {
      id: this.ventureId, kind: 'venture-record', ventureId: this.ventureId, memberId: DESK_CONTEXT.memberId, epoch: DESK_CONTEXT.epoch, at,
      idea: DRAFT_IDEA, ideaDigest: digest(DRAFT_IDEA), workingName: 'Draft', country, serviceType: null, status: 'interview',
      launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: at,
    };
    state.conversations.push(venture);
    this.#state = state;
  }

  read(): State { return structuredClone(this.#state); }

  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return Promise.reject(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault transactions are not supported.'));
    const work = () => this.#transaction.run(true, async () => {
      const draft = structuredClone(this.#state);
      const result = await change(draft);
      draft.revision = this.#state.revision + 1;
      this.#state = structuredClone(draft);
      return result;
    });
    const pending = this.#chain.then(work);
    this.#chain = pending.catch(() => {});
    return pending;
  }
}
