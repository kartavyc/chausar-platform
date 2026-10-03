import { check, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';

// Labelled synthetic state, time and financial records. No native database,
// customer system or delivery transport is used by this fixture.
export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const sourceIds = ['synthetic-books', 'synthetic-bank'];
export const syntheticNow = Date.parse('2026-10-01T12:00:00.000Z');
export const invoiceId = 'invoice-one';
export const customerId = 'customer-one';

export class InvoiceFixtureStore implements StateStore {
  state: State;
  queue: Promise<void> = Promise.resolve();
  afterCommit?: (state: State) => void;
  failBeforeCommit?: (state: State) => void;
  private syntheticTime: number;

  constructor(state = initialState('Synthetic invoice follow-up mandates', true), time = syntheticNow) {
    check(state.workspace.demo === true, 'TEST_CLOCK_FORBIDDEN', 'Invoice fixtures require a labelled demo workspace.');
    this.state = structuredClone(state);
    this.syntheticTime = time;
  }

  clock = () => this.syntheticTime;
  advance(ms: number) {
    check(Number.isSafeInteger(ms) && ms >= 0, 'INVALID_TEST_CLOCK', 'Advance the synthetic clock by a non-negative whole number of milliseconds.');
    this.syntheticTime += ms;
  }
  read() { return structuredClone(this.state); }
  snapshot() { return this.read(); }
  restart() { return new InvoiceFixtureStore(this.snapshot(), this.syntheticTime); }

  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = this.read();
      const result = await change(draft);
      this.failBeforeCommit?.(structuredClone(draft));
      draft.revision++;
      this.state = draft;
      // A thrown hook loses the response after persistence, while the next
      // transaction and a restarted store still see the committed state.
      this.afterCommit?.(this.read());
      return result;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }
}

const paymentFacts = (paymentEntityId: string, bankEntityId: string, amountMinor: string, validFrom: string, row: number): FactInput[] => [
  { entityId: paymentEntityId, sourceId: sourceIds[0], sourceRow: row, kind: 'payment', validFrom, branch: 'main',
    fields: { invoiceId, customerId, amountMinor, currency: 'INR', status: 'settled', description: 'Synthetic books payment evidence.' } },
  { entityId: bankEntityId, sourceId: sourceIds[1], sourceRow: row, kind: 'bank_line', validFrom, branch: 'main',
    fields: { invoiceId, customerId, amountMinor, currency: 'INR', status: 'matched', paymentEntityId, description: 'Synthetic matched bank evidence.' } },
];

export async function seedInvoiceFixture(store = new InvoiceFixtureStore()): Promise<InvoiceFixtureStore> {
  check(store.read().workspace.demo === true, 'TEST_CLOCK_FORBIDDEN', 'Invoice fixtures require a labelled demo workspace.');
  await new OntologyService(store).publish(owner, 'ecommerce');
  await new MemoryService(store).append(owner, [
    { entityId: invoiceId, sourceId: sourceIds[0], sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', branch: 'main',
      fields: { invoiceId, customerId, amountMinor: '10000', currency: 'INR', dueDate: '2026-09-30', status: 'unpaid',
        description: 'Synthetic unpaid invoice; source text cannot authorize a reminder.' } },
    ...paymentFacts('payment-one', 'bank-line-one', '2500', '2026-09-30', 2),
  ], { testLearnedAt: new Date(store.clock()).toISOString() });
  await store.update(state => { state.policy.autonomy = true; });
  return store;
}

export async function appendPayment(store: InvoiceFixtureStore) {
  return new MemoryService(store).append(owner,
    paymentFacts('payment-two', 'bank-line-two', '7500', new Date(store.clock()).toISOString().slice(0, 10), 3),
    { testLearnedAt: new Date(store.clock()).toISOString() });
}
