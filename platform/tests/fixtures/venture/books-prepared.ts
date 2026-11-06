// Synthetic provider proposal for journal tests. No provider account or network is used.
import {digest} from '../../../runtime/portable.ts';
import type {PostingDecision} from '../../../runtime/venture/playbooks/bookkeeping-cfo/posting-core.ts';
import type {ZohoPreparedDraft} from '../../../runtime/adapters/accounting/zoho-write-types.ts';
export function preparedBooksFixture(row:PostingDecision,identity:string):ZohoPreparedDraft{
 const mapping={customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer' as const,gstNo:null,taxSpecification:'inter' as const,lineMode:'aggregate-non-inventory' as const,lines:row.lines.map(line=>({itemId:line.itemId!,taxId:'88',taxKind:'tax' as const}))};
 const result:ZohoPreparedDraft={kind:'zoho-draft',materialDigest:digest(row),connectionIdentity:identity,decision:structuredClone(row),mapping,decisionDigest:digest(row),mappingDigest:digest(mapping),lineMode:'aggregate-non-inventory',method:'POST',path:row.action==='create-refund-draft'?'creditnotes':'invoices',query:{},body:JSON.stringify({syntheticTotalMinor:row.totalMinor}),evidenceDigest:digest({synthetic:true}),digest:''};result.digest=digest({...result,digest:''});return result;
}
