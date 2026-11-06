// Original source-bound tender owner desk. Countersign supplied workflow ideas only; no AGPL code copied.
import type { DeskHandlers,DeskKindTypes } from '../desk-types.ts';
import {check} from '../../../contracts.ts';
import {digest,exactPayload,identifier,listRecords,readVenture,requireAppChannel,ventureAction,type VentureTx} from '../../records.ts';
import type {TenderQuestionRecord} from '../../contracts.ts';
import {extractTenderQuestions,tenderQuestionFromCell,type TenderKind} from './questions.ts';
import {prepareTenderRows,changeTenderAnswer,changeTenderType,changeTenderControls,tenderTypeDigest,approveTenderType,tenderApproved} from './state.ts';
import {loadTenderSources,requireTenderSources,type TenderSourceRead} from './sources.ts';
import {groundTenderAnswer,groundTenderCommercial,aggregateTenderGaps} from './ground.ts';
import {tenderExportPack,fillIssuerTender} from './export.ts';
import {tenderAi} from './ai.ts';
import {tenderMoneyReceipts,type TenderMoneyReceipt} from './money.ts';

/** One bid groups all source questions for an existing client order. */
export type TenderDeskDeskTypes = {bid:DeskKindTypes};
function request(raw:unknown,op:'list'|'get'|'act'){
 const p=exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
 check(p.playbook==='tender-desk'&&p.kind==='bid','INVALID_VENTURE_REQUEST','Choose a tender bid.');return p;
}
const bidDigest=(rows:readonly TenderQuestionRecord[])=>digest(rows);
const groundRow=(row:TenderQuestionRecord,documents:{id:string;text:string}[])=>row.question.ownerOnly?groundTenderCommercial(row.question.answer,documents):groundTenderAnswer(row.question.question,row.question.answer,documents);
const grounded=(row:TenderQuestionRecord,documents:{id:string;text:string}[])=>(!row.question.ownerOnly||row.question.authoredBy==='owner')&&groundRow(row,documents).passed;
function currentRows(tx:Pick<VentureTx,'list'>,orderId:string){return tx.list('venture-tender-question').filter(row=>row.orderId===orderId);}
export const TENDER_DESK_DESK: DeskHandlers = {bid:{
 async list(deps,ctx,raw){const p=request(raw,'list');check(p.filter===undefined,'INVALID_VENTURE_REQUEST','The tender list takes no filter.');const {state,venture}=readVenture(deps,ctx),rows=listRecords(state,'venture-tender-question',venture.id);return {playbook:'tender-desk',kind:'bid',rows:[...new Set(rows.map(row=>row.orderId))].map(orderId=>({orderId,questions:rows.filter(row=>row.orderId===orderId).length})),line:'Source-bound tender answers. Portal submission stays with you.'};},
 async get(deps,ctx,raw){const p=request(raw,'get'),orderId=identifier(p.id,'Order'),{state,venture}=readVenture(deps,ctx);const rows=listRecords(state,'venture-tender-question',venture.id).filter(row=>row.orderId===orderId);check(rows.length,'TENDER_NOT_FOUND','Import this order RFP first.');const read:TenderSourceRead={find:(kind,id)=>listRecords(state,kind,venture.id).find(row=>row.id===id)};let stale=false;let checks:{id:string;result:ReturnType<typeof groundTenderAnswer>}[]=[];let moneyReceipts:(TenderMoneyReceipt&{questionId:string})[]=[];
  try{const source=await requireTenderSources(deps,read,orderId,rows[0]!.selection,rows[0]!.sourceDigest);checks=rows.filter(row=>row.question.answer.trim()).map(row=>({id:row.question.id,result:groundRow(row,source.documents)}));moneyReceipts=rows.flatMap(row=>tenderMoneyReceipts(row.question.answer,source.documents).receipts.map(receipt=>({...receipt,questionId:row.question.id})));}catch{stale=true;}
  return {playbook:'tender-desk',kind:'bid',item:{orderId,rows,stale,checks,gaps:aggregateTenderGaps(checks),moneyReceipts,approved:!stale&&rows.every(tenderApproved)},digest:bidDigest(rows)};
 },
 async act(deps,ctx,raw){requireAppChannel(ctx,'venture.desk.act');const p=request(raw,'act'),orderId=identifier(p.id,'Order');if(p.action==='ai-preview'||p.action==='ai-confirm')return tenderAi(deps,ctx,p,orderId);return ventureAction(deps,ctx,'approve','tender.desk',async tx=>{
  let rows=currentRows(tx,orderId);let result:unknown;
  if(p.action==='import'||p.action==='reimport'){
   check(p.action==='import'?rows.length===0&&p.digest===undefined:rows.length>0&&p.digest===bidDigest(rows),'APPROVAL_CHANGED','Review the saved questions before replacing them from current sources.');
   const source=await loadTenderSources(deps,tx,orderId,p.payload),sourceId=source.selection.rfpFileId??source.selection.issuerFileId??orderId;
   const questions=source.mappedRows.length?source.mappedRows.map(row=>tenderQuestionFromCell(row.question,sourceId+':'+source.selection.mapping!.sheet+'!'+row.questionCell)):extractTenderQuestions(source.rfpText,sourceId);
   const prepared=prepareTenderRows({orderId,clientId:source.order.clientId,sourceDigest:source.digest,selection:source.selection,questions});
   // Keep only opaque call links across a reimport, so Forget can erase all earlier source payloads too.
   prepared[0]!.aiCallIds=[...new Set(rows.flatMap(row=>row.aiCallIds))];
   for(const callId of prepared[0]!.aiCallIds){const call=tx.find('venture-model-call',callId);if(call?.status==='preview')tx.replace({...call,payloadText:'',payloadTruncated:false,status:'expired',erasedAt:tx.now});}
   tx.state.conversations=tx.state.conversations.filter(row=>!(row.kind==='venture-tender-question'&&row.ventureId===tx.venture!.id&&row.orderId===orderId));
   rows=prepared.map(body=>tx.put<TenderQuestionRecord>({...tx.base('venture-tender-question'),...body}));result={rows};
  }else{
   check(rows.length,'TENDER_NOT_FOUND','Import this order RFP first.');check(p.digest===bidDigest(rows),'APPROVAL_CHANGED','Review the current answers before changing or exporting them.');
   const source=await requireTenderSources(deps,tx,orderId,rows[0]!.selection,rows[0]!.sourceDigest);
   check(rows.every(row=>row.clientId===source.order.clientId&&row.sourceDigest===source.digest),'DERIVED_STALE','Import this current client source bucket again.');
   if(p.action==='answer'||p.action==='assign'){
    const b=exactPayload(p.payload,p.action==='answer'?['questionId','answer']:['questionId','kind'],p.action==='answer'?['questionId','answer']:['questionId','kind']);const row=rows.find(row=>row.question.id===b.questionId);check(row,'TENDER_NOT_FOUND','Choose a question from this bid.');
    const updated=p.action==='answer'?changeTenderAnswer(row,b.answer as string,'owner'):changeTenderType(row,b.kind as TenderKind);tx.replace(updated);result=updated;
   }else if(p.action==='controls'){
    const b=exactPayload(p.payload,['kind','lengthWords','tone'],['kind','lengthWords','tone']);tenderTypeDigest(rows,b.kind as TenderKind);result={rows:rows.filter(row=>row.question.kind===b.kind).map(row=>tx.replace(changeTenderControls(row,{lengthWords:b.lengthWords,tone:b.tone})))};
   }else if(p.action==='approve-type'){
    const b=exactPayload(p.payload,['kind'],['kind']);const approved=approveTenderType(rows,b.kind as TenderKind,tenderTypeDigest(rows,b.kind as TenderKind),row=>grounded(row,source.documents));result={rows:approved.map(row=>tx.replace(row))};
   }else{
    check(p.action==='export','INVALID_VENTURE_REQUEST','Choose a tender action.');exactPayload(p.payload,[]);check(rows.every(row=>tenderApproved(row)&&grounded(row,source.documents)),'TENDER_APPROVAL_REQUIRED','Approve every exact answer by type before exporting.');
    const pack=tenderExportPack({title:'Tender response',coverLines:['Prepared for owner review and manual submission.','Commercial answers are written and priced by the owner.'],rows:rows.map(row=>({id:row.question.id,kind:row.question.kind,question:row.question.question,answer:row.question.answer}))});
    const files=[{name:'tender-response.docx',bytes:pack.docx},{name:'tender-response.xlsx',bytes:pack.xlsx},{name:'compliance-matrix.csv',bytes:Buffer.from(pack.csv,'utf8')}];
    const moneyReceipts=rows.flatMap(row=>tenderMoneyReceipts(row.question.answer,source.documents).receipts.map(receipt=>({...receipt,questionId:row.question.id})));
    if(moneyReceipts.length)files.push({name:'price-receipts.json',bytes:Buffer.from(JSON.stringify(moneyReceipts,null,2),'utf8')});
    if(source.issuer){check(source.mappedRows.length===rows.length,'DERIVED_STALE','The issuer question mapping changed. Import it again.');files.push({name:'issuer-filled.xlsx',bytes:fillIssuerTender(Buffer.from(source.issuer.contentBase64,'base64'),source.selection.mapping,source.mappedRows.map((mapped,index)=>({row:mapped.row,answer:rows[index]!.question.answer})))});}
    result={files:files.map(file=>({name:file.name,bytes:file.bytes.length,contentBase64:Buffer.from(file.bytes).toString('base64')})),submitted:false,manualPath:'Review the exported pack and submit it yourself on the issuer portal.'};
   }
  }
  tx.emit('desk.changed',{playbook:'tender-desk'});tx.emit('queue.changed',{});return {playbook:'tender-desk' as const,kind:'bid',id:orderId,result,line:'Saved for review. Nothing was submitted.'};
 });}
}};
