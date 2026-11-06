// Original Chausar monthly revision reminders. Reading Today never starts work or posts.
import type {Context,State} from '../../../contracts.ts';
import type {VentureDeps,VentureRecord} from '../../contracts.ts';
import {listRecords} from '../../records.ts';
import {localDayAt} from '../../local-day.ts';
import type {W4RowItem} from '../../views/queue-w4.ts';
import {socialRevisionDue} from './revision-due-core.ts';
export function revisionDueRows(deps:VentureDeps,_ctx:Context,state:State,venture:VentureRecord):W4RowItem[]{
 if(!venture.country)return [];
 const today=localDayAt(deps.clock(),venture.country);
 const blueprints=listRecords(state,'venture-blueprint',venture.id);
 return listRecords(state,'venture-order',venture.id).flatMap(order=>{
  const offer=blueprints.flatMap(plan=>plan.offers).find(item=>item.id===order.offerId);
  const due=order.intake?.fields?.revisionDue;
  if(!socialRevisionDue({status:order.status,offerKey:offer?.playbookOffer??'',revisionDue:due},today))return [];
  return [{kind:'notice' as const,subject:'social-revision:'+order.id,version:String(due),createdAt:order.at,title:'Social revisions are due',line:'Open this order to review the monthly revisions.',actions:[{id:'open' as const,label:'Open social drafts',primary:true},{id:'later' as const,label:'Later',primary:false}],navigate:'Open Work to review the social revisions.',notice:{probe:'drafts' as const,severity:'medium' as const,link:'#/work?socialOrder='+order.id}}];
 });
}
