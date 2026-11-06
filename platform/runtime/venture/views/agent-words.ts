// Chausar venture launcher, views: the words an agent wrote, as the screens show them (catalogue Q3). Each number with
// no receipt is labelled "model estimate" and each one the calculator refutes is replaced by its figure
// (delivery/checks.ts summaryReceipts), against the run's own receipts (the order's price receipt and the run's work
// receipts), the client's words and files, and the tool results. Words with no number pass as they are, and the run's
// evidence is gathered and indexed once, only when some words need it.
import type { State } from '../../contracts.ts';
import { findRecord, listRecords, modelNumbers } from '../records.ts';
import type { DeliveryRunRecord, VentureRecord } from '../contracts.ts';
import { summaryChecker } from '../delivery/checks.ts';
import type { AnyReceipt } from '../delivery/deliverable.ts';
import { clientNameFor } from './shared.ts';

/** A labeller for one run's agent words: the draft title, a hand-off question, a step's note. */
export function agentWordsLabeller(state: State, venture: VentureRecord, run: DeliveryRunRecord): (words: string) => string {
  let check: ((text: string) => { labelled: string }) | null = null;
  const gather = () => {
    const harness = run.harness ?? null;
    const order = findRecord(state, 'venture-order', run.orderId);
    const ours = order && order.ventureId === venture.id ? order : null;
    const price = ours ? findRecord(state, 'venture-price-receipt', ours.priceReceiptId) : null;
    const work = harness ? listRecords(state, 'venture-work-receipt', venture.id).filter(item => harness.workReceiptIds.includes(item.id)) : [];
    const files = harness ? listRecords(state, 'venture-upload', venture.id).filter(item => harness.uploadIds.includes(item.id)) : [];
    const receipts: AnyReceipt[] = [...(price && price.ventureId === venture.id ? [price] : []), ...work];
    const answers = harness ? harness.handoffs.flatMap(handoff => handoff.answer === null ? [] : [handoff.answer]) : [];
    return summaryChecker({
      receipts, ventureId: venture.id, clientRequest: ours?.request ?? '', answers, harness, files,
      known: [venture.workingName, clientNameFor(state, venture.id, run.orderId)], dateOrder: venture.country.dateOrder, ownerWords: [venture.idea],
    });
  };
  return words => {
    if (!/\p{N}/u.test(words) && !modelNumbers(words)) return words;
    check ??= gather();
    return check(words).labelled;
  };
}
