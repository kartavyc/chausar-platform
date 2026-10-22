/**
 * Where an order stands, in one word the Work place turns into one plain sentence (CogSend wording). Read from the
 * engine's own records: the order, its newest delivery run, its invoices, and the engine's run state when it has one.
 * Nothing here counts money or dates; it only reads statuses the engine set.
 */

import type { DeliveryLite, InvoiceLite, OrderLite, RunSummary } from '../../engine/types';

export type OrderState =
  | 'received' | 'working' | 'waiting' | 'practice' | 'draft-ready' | 'approved' | 'returned' | 'stopped'
  | 'delivered' | 'invoiced' | 'paid' | 'cancelled';

/** The one thing a row can do: start the first run, run again after a stop or a send-back, or mark it delivered. */
export type OrderAction = 'start' | 'run-again' | 'deliver';

export interface OrderView {
  order: OrderLite;
  state: OrderState;
  /** The newest delivery run for the order, if any. */
  run?: DeliveryLite | undefined;
  /** The invoice that decides the state: paid, else issued or part paid, else a draft. */
  invoice?: InvoiceLite | undefined;
  partPaid: boolean;
  /** Delivered, with an invoice drafted and not yet issued (it waits on Today). */
  draftInvoice: boolean;
  delivered: boolean;
  action?: OrderAction | undefined;
}

/** The newest run for an order; of two at the same moment, the later one in the list (the engine's tie rule). */
export function newestRun(orderId: string, deliveries: readonly DeliveryLite[]): DeliveryLite | undefined {
  let newest: DeliveryLite | undefined;
  for (const run of deliveries) if (run.orderId === orderId && (!newest || run.at >= newest.at)) newest = run;
  return newest;
}

/** Where one delivery run stands, in the same words as an order (used for an order's runs when it is focused). */
export function runStateOf(run: DeliveryLite, summaries: readonly RunSummary[] = []): OrderState {
  return fromRun(run, summaries);
}

function fromRun(run: DeliveryLite, summaries: readonly RunSummary[]): OrderState {
  switch (run.status) {
    case 'failed': return 'stopped';
    case 'rejected': return 'returned';
    case 'accepted':
    case 'edited': return run.practice ? 'practice' : 'approved';
    case 'ready-for-review': return run.practice ? 'practice' : 'draft-ready';
    default: {
      // Still going. The engine's run state says whether it waits on the owner; without it, the delivery run does.
      const engine = summaries.find((s) => s.runId === run.id);
      if (engine) return engine.state === 'waiting' ? 'waiting' : 'working';
      return (run.awaitingYou ?? run.status !== 'brief-waiting') ? 'waiting' : 'working';
    }
  }
}

export function orderView(order: OrderLite, deliveries: readonly DeliveryLite[], invoices: readonly InvoiceLite[], summaries: readonly RunSummary[] = []): OrderView {
  const run = newestRun(order.id, deliveries);
  const mine = invoices.filter((i) => i.orderId === order.id && i.status !== 'void');
  const paid = mine.find((i) => i.status === 'paid');
  const open = mine.find((i) => i.status === 'issued' || i.status === 'part-paid');
  const draft = mine.find((i) => i.status === 'draft');
  const delivered = order.status === 'delivered' || order.deliveredOn !== null;

  let state: OrderState;
  if (order.status === 'cancelled') state = 'cancelled';
  else if (paid) state = 'paid';
  else if (open || order.status === 'invoiced') state = 'invoiced';
  else if (delivered) state = 'delivered';
  else state = run ? fromRun(run, summaries) : 'received';

  const isOpen = order.status === 'open';
  const approvedRun = !!run && !run.practice && (run.status === 'accepted' || run.status === 'edited');
  let action: OrderAction | undefined;
  if (state === 'received' && isOpen) action = 'start';
  else if ((state === 'stopped' || state === 'returned') && isOpen) action = 'run-again';
  else if (approvedRun && state !== 'cancelled' && !delivered) action = 'deliver';

  return {
    order, state, run, invoice: paid ?? open ?? draft,
    partPaid: open?.status === 'part-paid' && !paid, draftInvoice: !!draft && !open && !paid, delivered, action,
  };
}

/** What a failed run says went wrong: the engine's error from the run itself, else the summary's result line. */
export function previousFailure(run: RunSummary, error: string | undefined): string | undefined {
  return error ?? run.result;
}
