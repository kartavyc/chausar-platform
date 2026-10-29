// Type-only provider shapes for exact owner-reviewed Tally drafts.
import type {PostingDecision} from '../../venture/playbooks/bookkeeping-cfo/posting-core.ts';
export type TallyWriteConnection={companyName:string;companyGuid:string;port:number;revision:string;enabled:true;baseCurrency:'INR';currencyName:string};
export type TallyDraftMapping={lineMode:'accounting-ledger-amounts';taxTreatment:'not-applicable';partyLedger:{name:string;guid:string};lines:{itemId:string;ledgerName:string;ledgerGuid:string}[];optionalTemplateXml:string};
export type TallyPreparedDraft={kind:'tally-draft';connectionIdentity:string;decision:PostingDecision;decisionDigest:string;mapping:TallyDraftMapping;mappingDigest:string;evidenceDigest:string;lineMode:'accounting-ledger-amounts';method:'POST';body:string;materialDigest:string;digest:string};
