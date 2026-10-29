// Current file and source evidence for every career delivery boundary. Only the owner desk creates approved packs.
import {check,type State} from '../../../contracts.ts';
import {digest,listRecords} from '../../records.ts';
import {careerEvidence} from './source-state.ts';
import {careerFileBinding} from './thread-state.ts';
import {careerFilesValid,careerClientApproved} from './share-current.ts';
import {careerPackBinding} from './pack.ts';
import type {DeliveryRunRecord} from '../../contracts.ts';
import {playbookForRun} from '../../delivery/workflow.ts';
import {requireCareerClientRule} from './rules.ts';
import type {CareerDraftEvidence} from './checks.ts';
export function careerRunSource(state:State,ventureId:string,orderId:string,clientApprovedAt:string|null=null):CareerDraftEvidence&{sourceBinding:string}{
 const order=listRecords(state,'venture-order',ventureId).find(r=>r.id===orderId),row=listRecords(state,'venture-career-thread',ventureId).filter(r=>r.orderId===orderId&&r.category==='pack').at(-1),pack=row?.pack;
 check(order&&order.status!=='cancelled'&&row?.clientId===order.clientId&&pack,'CAREER_APPROVAL_REQUIRED','Create and approve this order exact rendered pack in the career desk.');
 const evidence=careerEvidence(state,ventureId,orderId);
 check(pack.orderDigest===digest(order)&&pack.factsDigest===evidence.factsDigest&&pack.sourcesDigest===evidence.sourcesDigest,'CAREER_SOURCE_CHANGED','The career facts, source or order changed. Create a new pack.');
 check(careerFilesValid(pack)&&pack.ownerApproval===careerFileBinding(pack),'CAREER_APPROVAL_REQUIRED','Render and approve the exact current pack files in the career desk.');
 if(clientApprovedAt){const now=clientApprovedAt;check(pack.clientShareId&&careerClientApproved(state,row.id,pack.clientShareId,now),'CAREER_CLIENT_APPROVAL_REQUIRED','The client must approve the current rendered pack through its review link.');}
 const binding=careerPackBinding(pack.text,evidence.factsDigest);
 return{text:pack.text,factsDigest:pack.factsDigest,currentFactsDigest:evidence.factsDigest,ownerApproval:binding,binding,sourceBinding:careerFileBinding(pack)};
}

export function careerRunCurrent(state:State,ventureId:string,run:DeliveryRunRecord,now:string|undefined=undefined,clientApproved=false){
 if(playbookForRun(state,run)?.flagship!=='job-search-desk')return;
 requireCareerClientRule();const source=careerRunSource(state,ventureId,run.orderId);
 check(run.careerPackBinding===source.sourceBinding,'CAREER_SOURCE_CHANGED','The rendered career pack changed. Start a new delivery from its approved files.');
 check(run.renderedText===source.text&&(!run.editedText||run.editedText===source.text),'CAREER_CLAIM_BOUNDARY','Use the exact approved career pack text.');
 if(clientApproved){check(now,'INVALID_VENTURE_REQUEST','Use the current review time.');careerRunSource(state,ventureId,run.orderId,now);}
 return source;
}
