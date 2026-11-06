// Original per-order YouTube service workflow. Research never implies that footage was cut or published.
import {check,type State} from '../../../contracts.ts';
import type {OrderRecord,PlaybookRecord,VentureRecord} from '../../contracts.ts';
import {findRecord} from '../../records.ts';
import {isYoutubeService,validateYoutubeServiceIntake} from './service-offer.ts';
import {requireYoutubeServiceBinding} from './service-binding.ts';
import {YOUTUBE_STEPS} from './playbook.ts';
export function youtubeServiceWorkflow(state:State,venture:VentureRecord,base:PlaybookRecord,order:OrderRecord,offerId:string|null){
 if(!isYoutubeService(offerId))return null;
 check(base.flagship==='youtube','YOUTUBE_SERVICE_INVALID','This service belongs to the YouTube team.');
 const blueprint=venture.acceptedBlueprintId?findRecord(state,'venture-blueprint',venture.acceptedBlueprintId):undefined,offer=blueprint?.offers.find(row=>row.id===order.offerId);
 check(offer&&offer.playbookOffer===offerId,'YOUTUBE_SERVICE_INVALID','Use the current exact owner-added service.');requireYoutubeServiceBinding(state,venture,offer);validateYoutubeServiceIntake(order.intake?.fields,offerId!);
 const ids=offerId==='screencast-tutorial'?['intake','clarify','probe','find','score','edit','assemble',offerId,'verify','review','publish']:['intake','clarify',offerId!,'verify','review','publish'];
 return ids.map(id=>{const declared=YOUTUBE_STEPS.find(step=>step.id===id),step=base.steps.find(step=>step.id===id);check(declared&&step&&step.kind===declared.kind,'PLAYBOOK_ROUTE_INVALID','A service workflow step or its approval boundary changed.');const ceiling=new Set(declared.tools);return {...step,...(id==='publish'&&offerId!=='screencast-tutorial'?{title:'You share the approved service report or publishing texts'}:{}),tools:(step.tools??[]).filter(tool=>ceiling.has(tool))};});
}
