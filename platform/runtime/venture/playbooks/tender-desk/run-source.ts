// Original delivery source fence. Current bytes and exact approved rows must survive every model boundary.
import {check} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {digest,listRecords} from '../../records.ts';
import {requireTenderSources} from './sources.ts';
import {groundTenderAnswer,groundTenderCommercial,aggregateTenderGaps} from './ground.ts';
import {tenderApproved} from './state.ts';
export async function tenderRunSource(deps:VentureDeps,ventureId:string,orderId:string,requireApproved=false){
 const state=deps.store.read(),rows=listRecords(state,'venture-tender-question',ventureId).filter(row=>row.orderId===orderId),first=rows[0];check(first,'TENDER_NOT_FOUND','Import this order sources in the tender desk first.');
 const source=await requireTenderSources(deps,{find:(kind,id)=>listRecords(deps.store.read(),kind,ventureId).find(row=>row.id===id)},orderId,first.selection,first.sourceDigest);
 check(source.order.intake?.fields?.private!==true,'PRIVATE_NEEDS_LOCAL','Private tender documents stay in the owner desk until a qualified local model is available.');
 check(rows.every(row=>row.clientId===source.order.clientId&&row.sourceDigest===source.digest)&&digest(rows)===digest(listRecords(deps.store.read(),'venture-tender-question',ventureId).filter(row=>row.orderId===orderId)),'DERIVED_STALE','The tender sources or answers changed. Review them again.');
 const checks=rows.map(row=>({id:row.question.id,result:row.question.ownerOnly?groundTenderCommercial(row.question.answer||'Not confirmed.',source.documents):groundTenderAnswer(row.question.question,row.question.answer||'Not confirmed in the supplied documents.',source.documents)}));
 const ready=rows.every(row=>tenderApproved(row)&&(!row.question.ownerOnly||row.question.authoredBy==='owner'))&&checks.every(row=>row.result.passed);
 check(!requireApproved||ready,'TENDER_APPROVAL_REQUIRED','Resolve source gaps and approve every answer by type in the tender desk.');
 return {rows,checks,gaps:aggregateTenderGaps(checks),ready};
}
