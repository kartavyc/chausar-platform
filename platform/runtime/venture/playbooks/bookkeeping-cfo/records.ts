// Collections record bodies after finance-skills (MIT ideas); original Chausar shapes.
import type { CollectionStage } from './collections.ts';
import type {FinanceCycle} from './cycles.ts';
import type {VoucherDraft,approveVoucher} from './vouchers.ts';
import type {setupDraft} from './setup.ts';
export type PromiseToPayBody = { clientId: string; serviceOrderId: string; sourceName: string; invoiceIds: string[]; amountMinor: string; promisedOn: string; recordedOn: string; recordedPaymentIds: string[]; method: string; statedBy: string };
export type CollectionStageBody = { clientId: string | null; ladder: CollectionStage[] };
export type BooksPostingBody = {clientId:string;orderId:string;cycleId:string;entry:
 |{kind:'cycle';cycle:FinanceCycle}
 |{kind:'voucher';voucher:VoucherDraft|ReturnType<typeof approveVoucher>;receiptId:string}
 |{kind:'setup';setup:ReturnType<typeof setupDraft>;uploadId:string;sourceDigest:string;receiptId:string;posting?:import('./setup-posting-types.ts').SetupPosting}
 |{kind:'seller-month';report:ReturnType<typeof import('./seller-books.ts').sellerBooks>;uploadId:string;sourceDigest:string;receiptId:string;posting?:import('./settlement-posting-types.ts').SettlementPosting}
 |import('./posting-types.ts').BooksPostingEntry
};
