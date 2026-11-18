// Chausar venture launcher, delivery: the one eraser of work records, for every playbook's privacy file (DPDP: Forget
// really deletes). Each playbook picks which runs, model calls and orders hold the erased client's data; what erasing
// one means is said here once. A run is stopped as erased by the machine, which also removes every copy of the
// client's words the run kept (run-machine.ts erase). A model call loses its payload, and a preview nobody sent can
// never be sent. An order loses its request and intake and is cancelled. Inside the caller's transaction.
import type { VentureTx } from '../records.ts';
import type { DeliveryRunRecord, OrderRecord, RecordOf } from '../contracts.ts';
import { erase } from './run-machine.ts';

/** Stops the run as erased and removes the client's words it held. */
export function eraseRun(tx: VentureTx, run: DeliveryRunRecord): DeliveryRunRecord {
  const stored = tx.replace(erase(run, tx.now));
  tx.emit('run.stopped', { runId: run.id });
  return stored;
}

/** Empties a model call's payload; a preview is expired, so the model port never sends it. */
export function eraseCall(tx: VentureTx, call: RecordOf<'venture-model-call'>): void {
  tx.replace({ ...call, payloadText: '', payloadTruncated: false, error: null, erasedAt: tx.now, ...(call.status === 'preview' ? { status: 'expired' as const } : {}) });
}

/** Cancels the order and removes the client's request and intake; request: the words left in their place; stopChain: its chain stops too. */
export function eraseOrder(tx: VentureTx, order: OrderRecord, request = '', stopChain = false): void {
  const { intake: _intake, ...rest } = order;
  tx.replace({ ...rest, request, status: 'cancelled', ...(stopChain ? { chainState: 'stopped' as const } : {}) });
}
