// Collections record bodies after finance-skills (MIT ideas); original Chausar shapes.
import type { CollectionStage } from './collections.ts';
export type PromiseToPayBody = { clientId: string; serviceOrderId: string; sourceName: string; invoiceIds: string[]; amountMinor: string; promisedOn: string; recordedOn: string; recordedPaymentIds: string[]; method: string; statedBy: string };
export type CollectionStageBody = { clientId: string | null; ladder: CollectionStage[] };
/** Accounting posting remains for 5K2. */
export type BooksPostingBody = { placeholder: true };
