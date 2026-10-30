import type {settlementPayments} from './settlement-payments.ts';
import type {ZohoPreparedPayment} from '../../../adapters/accounting/zoho-settlement-types.ts';
export type SettlementPosting={uploadId:string;sourceDigest:string;target:string;batch:ReturnType<typeof settlementPayments>;prepared:ZohoPreparedPayment[];state:'staged'|'applying'|'recorded'|'stopped'|'outcome_unknown';outcomes:{externalId:string;state:'pending'|'recorded'|'not-sent'|'outcome_unknown';remoteId:string|null}[];receiptId:string;reviewDigest:string};
