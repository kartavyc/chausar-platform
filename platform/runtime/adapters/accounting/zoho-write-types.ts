import type { ZohoDraftMapping } from '../../../contract/adapters/accounting/zoho-write-types.ts';
export type { ZohoDraftMapping } from '../../../contract/adapters/accounting/zoho-write-types.ts';
// Shared exact Zoho proposal shapes. Type-only imports keep UI records free of server dependencies.
import type {PostingDecision} from '../../venture/playbooks/bookkeeping-cfo/posting-core.ts';

export type ZohoPreparedDraft={kind:'zoho-draft';connectionIdentity:string;decisionDigest:string;mappingDigest:string;lineMode:'aggregate-non-inventory';decision:PostingDecision;mapping:ZohoDraftMapping;method:'POST';path:'invoices'|'creditnotes';query:Record<string,string>;body:string;materialDigest:string;evidenceDigest:string;digest:string};
