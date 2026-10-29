// Shared accounting work shape, with no server imports.
import type {ZohoPreparedDraft} from '../../../adapters/accounting/zoho-write-types.ts';
import type {prepareBooksBatch} from './posting-core.ts';
export type BooksPostingEntry={kind:'posting';uploadId:string;sourceDigest:string;target:string;prepared:ZohoPreparedDraft[];batch:Awaited<ReturnType<typeof prepareBooksBatch>>;state:'staged'|'applying'|'issuing'|'drafted'|'stopped'|'outcome_unknown';outcomes:{externalId:string;state:'pending'|'issuing'|'drafted'|'issued'|'not-sent'|'outcome_unknown';remoteId:string|null}[];receiptId:string;reviewDigest:string};
