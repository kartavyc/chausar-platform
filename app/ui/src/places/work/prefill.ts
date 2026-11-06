/**
 * A New order the owner did not type themselves (W4 4B3): an agent in its chat suggests starting the owner's request
 * as a new order, and the New order sheet opens with that service and request filled in. Nothing is created until the
 * owner presses Create. Held in memory for the one sheet that opens next, never in the address or browser storage.
 */

export interface OrderPrefill { offerId: string | null; request: string }

let next: OrderPrefill | null = null;

/** Fills the next New order sheet that opens. */
export function prefillOrder(prefill: OrderPrefill): void {
  next = { ...prefill };
}

/** The prefill waiting for the sheet opening now (read in its first render, which may run twice). */
export function peekPrefill(): OrderPrefill | null {
  return next;
}

/** The sheet has it: a later New order opens empty. */
export function clearPrefill(): void {
  next = null;
}
