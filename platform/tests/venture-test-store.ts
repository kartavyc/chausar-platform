// A test StateStore that behaves like the real vault for transactions (platform/runtime/vault.ts, #enqueue and update):
// a nested update rejects with REENTRANT_TRANSACTION, updates run one at a time in a promise chain, and reads
// and commits are deep copies. Venture package tests use it instead of FixtureStateStore. Owned by P0.
import { AsyncLocalStorage } from 'node:async_hooks';
import { ChausarError, initialState, type State, type StateStore } from '../runtime/contracts.ts';

export class VentureTestStore implements StateStore {
  #state: State;
  #chain: Promise<unknown> = Promise.resolve();
  #transaction = new AsyncLocalStorage<boolean>();
  commits = 0;
  constructor(state: State = initialState('Venture test', true)) { this.#state = structuredClone(state); }
  read(): State { return structuredClone(this.#state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return Promise.reject(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault transactions are not supported.'));
    const work = () => this.#transaction.run(true, async () => {
      const draft = structuredClone(this.#state);
      const result = await change(draft);
      draft.revision = this.#state.revision + 1;
      this.#state = structuredClone(draft);
      this.commits += 1;
      return result;
    });
    const pending = this.#chain.then(work);
    this.#chain = pending.catch(() => {});
    return pending;
  }
}
