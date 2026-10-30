// Original browser delivery source bridge. It reads only the desk's current saved evidence and real file bytes.
import {check,digest} from '../../../../platform/runtime/portable';
import {careerFileBinding} from '../../../../platform/runtime/venture/playbooks/job-search-desk/thread-state';
import {careerPackBinding} from '../../../../platform/runtime/venture/playbooks/job-search-desk/pack';
import type {CareerDraftEvidence} from '../../../../platform/runtime/venture/playbooks/job-search-desk/draft-check';
import {fakeCareerFilesValid} from './fake-job-search-desk-files';
import type {CareerFakeState} from './fake-job-search-desk-core';
export type CareerDeliverySource=CareerDraftEvidence&{sourceBinding:string};
export function fakeCareerSource(c:CareerFakeState,orderId:string):CareerDeliverySource{
 const order=c.order(orderId),row=[...c.rows().threads.values()].filter(r=>r.orderId===orderId&&r.category==='pack').at(-1),pack=row?.pack;
 check(row?.clientId===order.clientId&&pack,'CAREER_APPROVAL_REQUIRED','Create and approve this order exact rendered pack in the career desk.');
 const e=c.evidence(orderId);check(pack.orderDigest===digest(order)&&pack.factsDigest===e.factsDigest&&pack.sourcesDigest===e.sourcesDigest,'CAREER_SOURCE_CHANGED','The career facts, source or order changed. Create a new pack.');
 check(fakeCareerFilesValid(pack)&&pack.ownerApproval===careerFileBinding(pack),'CAREER_APPROVAL_REQUIRED','Render and approve the exact current pack files in the career desk.');
 const binding=careerPackBinding(pack.text,e.factsDigest);return {text:pack.text,factsDigest:pack.factsDigest,currentFactsDigest:e.factsDigest,ownerApproval:binding,binding,sourceBinding:careerFileBinding(pack)};
}
