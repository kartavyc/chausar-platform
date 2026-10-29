import type {SettlementPayment} from '../../venture/playbooks/bookkeeping-cfo/settlement-payments.ts';
export type ZohoPreparedPayment={kind:'settlement-payment';connectionIdentity:string;payment:SettlementPayment;customerId:string;invoiceId:string;method:'POST';path:'customerpayments';query:Record<string,string>;body:string;evidenceDigest:string;materialDigest:string;digest:string};
export type ZohoPaymentEvidence={id:string;externalId:string;materialDigest:string|null};
