// Original source-derived Today request. Reading the queue does not draft, send, or approve anything.
import type {Context,State} from '../../../contracts.ts';
import type {VentureDeps,VentureRecord} from '../../contracts.ts';
import {listRecords,digest} from '../../records.ts';
import type {W4RowItem} from '../../views/queue-w4.ts';
import {requireTenderSources} from './sources.ts';
import {aggregateTenderGaps,groundTenderAnswer,groundTenderCommercial} from './ground.ts';
export async function tenderGapRows(deps:VentureDeps,_ctx:Context,state:State,venture:VentureRecord):Promise<W4RowItem[]>{
 const all=listRecords(state,'venture-tender-question',venture.id),result:W4RowItem[]=[];
 for(const orderId of new Set(all.map(row=>row.orderId))){
  const rows=all.filter(row=>row.orderId===orderId),first=rows[0]!;let terms:string[]=[];let stale=false;
  try{const source=await requireTenderSources(deps,{find:(kind,id)=>listRecords(deps.store.read(),kind,venture.id).find(row=>row.id===id)},orderId,first.selection,first.sourceDigest);
   const checks=rows.filter(row=>!row.question.ownerOnly||row.question.answer.trim()).map(row=>({id:row.question.id,result:row.question.ownerOnly?groundTenderCommercial(row.question.answer,source.documents):groundTenderAnswer(row.question.question,row.question.answer||'Not confirmed in the supplied documents.',source.documents)}));
   terms=aggregateTenderGaps(checks).terms.map(row=>row.term);
  }catch{stale=true;}
  if(!stale&&!terms.length)continue;
  result.push({kind:'notice',subject:'tender-gap:'+orderId,version:digest({rows,terms,stale}),createdAt:first.at,title:'Tender source gaps need you',line:stale?'The client sources changed. Import the current sources again.':'Add client evidence for: '+terms.slice(0,8).join(', ')+'.',actions:[{id:'open',label:'Open tender desk',primary:true},{id:'later',label:'Later',primary:false}],navigate:'Open Work to review the tender sources.',notice:{probe:'drafts',severity:'medium',link:'#/work?tenderOrder='+encodeURIComponent(orderId)}});
 }return result;
}
