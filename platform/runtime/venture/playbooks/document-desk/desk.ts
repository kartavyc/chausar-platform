// Chausar playbook: the document desk (wave 6, 6E4). One record kind on venture.desk.*, 'document', one per client
// order: create it from the order's files, set the outline and the figures table (computed by code, with a receipt),
// approve the brief before AI work, take the accepted draft's sections, edit them, approve the finished document and
// export the pack (Word, figures workbook, CSV and receipt). Every change after an approval clears it; a changed client
// file makes the document stale until its sources are chosen again. Nothing is sent. Written for Chausar.
import type {DeskHandlers,DeskKindTypes} from '../desk-types.ts';
import {check,type State} from '../../../contracts.ts';
import type {DocumentRecord,VentureRecord} from '../../contracts.ts';
import {digest,exactPayload,identifier,listRecords,readVenture,requireAppChannel,ventureAction,type VentureTx} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import {storedZipBytes} from '../kit/ooxml/browser.ts';
import {approveBrief,approveDocument,briefApproved,documentApproved,documentExportParts,figureLines,newDocument,rebindSources,draftLines,setFigures,setOutline,setSection,sourceDigestOf,takeDraft,unreceiptedAmounts} from './core.ts';
import type {DocumentBody} from './records.ts';

export type DocumentDeskDeskTypes={document:DeskKindTypes};
const P='document-desk';
export const DOCUMENT_OFFERS=['handbook-sop','project-report','estimate','thesis-edit','technical-writing'] as const;

function request(raw:unknown,op:'list'|'get'|'act'){
 const p=exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
 check(p.playbook===P&&p.kind==='document','INVALID_VENTURE_REQUEST','Choose the document desk.');
 if(op==='list')check(p.filter===undefined,'INVALID_VENTURE_REQUEST','The document list takes no filter.');
 return p;
}
/** A current client order on one of this desk's offers. */
function orderOf(state:State,venture:VentureRecord,orderId:string){
 const order=listRecords(state,'venture-order',venture.id).find(row=>row.id===orderId);
 const offer=acceptedBlueprintOrNull(state,venture)?.offers.find(row=>row.id===order?.offerId);
 check(order&&order.status!=='cancelled'&&(DOCUMENT_OFFERS as readonly string[]).includes(offer?.playbookOffer??''),'ORDER_NOT_FOUND','Choose a current document order.');
 check(listRecords(state,'venture-client',venture.id).some(client=>client.id===order.clientId),'CLIENT_NOT_FOUND','Choose a current client.');
 return order;
}
/** The order's attached files by id, as id and digest; a file not attached to this order is refused. */
function filesOf(state:State,venture:VentureRecord,orderId:string,ids:unknown){
 check(Array.isArray(ids)&&ids.length>=1&&ids.length<=20&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'),'DOCUMENT_SOURCE_REQUIRED','Choose one to twenty client files the document rests on.');
 const uploads=listRecords(state,'venture-upload',venture.id);
 return (ids as string[]).map(id=>{const file=uploads.find(row=>row.id===id);check(file&&file.scope.kind==='order'&&file.scope.orderId===orderId,'DOCUMENT_SOURCE_REQUIRED','Use only files attached to this client order.');return {id,digest:file.digest};});
}
/** True when a client file the document rests on changed or went away since it was chosen. */
function staleOf(state:State,venture:VentureRecord,body:DocumentBody):boolean{
 const uploads=listRecords(state,'venture-upload',venture.id),files=body.sourceFileIds.map(id=>uploads.find(row=>row.id===id));
 return files.some(file=>!file||file.scope.kind!=='order'||file.scope.orderId!==body.orderId)||sourceDigestOf(files.map(file=>({id:file!.id,digest:file!.digest})))!==body.sourceDigest;
}
const bodyOf=(row:DocumentRecord):DocumentBody=>{const {id:_i,kind:_k,ventureId:_v,memberId:_m,epoch:_e,at:_a,...body}=row;return body as DocumentBody;};
function itemOf(state:State,venture:VentureRecord,row:DocumentRecord){
 const body=bodyOf(row);
 return {...body,id:row.id,stale:staleOf(state,venture,body),briefApproved:briefApproved(body),approved:documentApproved(body),figureWords:body.figures?figureLines(body.figures):[],
  unreceipted:body.sections.flatMap(section=>{const amounts=unreceiptedAmounts(section.text,body.figures);return amounts.length?[{sectionId:section.id,amounts}]:[];}),
  missing:body.sections.filter(section=>!section.text.trim()).map(section=>section.id)};
}
function rowOf(tx:Pick<VentureTx,'list'>,orderId:string){return tx.list('venture-document').find(row=>row.orderId===orderId)??null;}

export const DOCUMENT_DESK_DESK:DeskHandlers=Object.freeze({document:{
 async list(deps,ctx,raw){request(raw,'list');const {state,venture}=readVenture(deps,ctx);
  return {playbook:P,kind:'document',rows:listRecords(state,'venture-document',venture.id).map(row=>({orderId:row.orderId,title:row.title,docType:row.docType,briefApproved:briefApproved(bodyOf(row)),approved:documentApproved(bodyOf(row))})),line:'Client documents built from their own files. Every amount comes from the figures table.'};},
 async get(deps,ctx,raw){const p=request(raw,'get'),orderId=identifier(p.id,'Order'),{state,venture}=readVenture(deps,ctx);
  const row=listRecords(state,'venture-document',venture.id).find(item=>item.orderId===orderId);check(row,'DOCUMENT_NOT_FOUND','Set up this order\'s document first.');
  return {playbook:P,kind:'document',item:itemOf(state,venture,row),digest:digest(row)};},
 async act(deps,ctx,raw){requireAppChannel(ctx,'venture.desk.act');const p=request(raw,'act'),orderId=identifier(p.id,'Order');
  return ventureAction(deps,ctx,'approve','document.'+String(p.action),tx=>{
   const venture=tx.venture!,order=orderOf(tx.state,venture,orderId),row=rowOf(tx,orderId);let body:DocumentBody,line='Saved for your review. Nothing was sent.',result:unknown;
   if(p.action==='create'){
    check(!row&&p.digest===undefined,'APPROVAL_CHANGED','This order already has a document.');
    const b=exactPayload(p.payload,['docType','title','sourceFileIds'],['docType','title','sourceFileIds']);
    body=newDocument({orderId,clientId:order.clientId,docType:b.docType,title:b.title,files:filesOf(tx.state,venture,orderId,b.sourceFileIds)});
    const made=tx.put<DocumentRecord>({...tx.base('venture-document'),...body});result=itemOf(tx.state,venture,made);
   }else{
    check(row,'DOCUMENT_NOT_FOUND','Set up this order\'s document first.');check(p.digest===digest(row),'APPROVAL_CHANGED','The document changed. Read it again.');
    check(row.clientId===order.clientId,'DERIVED_STALE','The order\'s client changed. Set up the document again.');
    const current=bodyOf(row);
    if(p.action!=='sources')check(!staleOf(tx.state,venture,current),'DERIVED_STALE','A client file changed. Choose the document\'s files again.');
    if(p.action==='sources')body=rebindSources(current,filesOf(tx.state,venture,orderId,exactPayload(p.payload,['sourceFileIds'],['sourceFileIds']).sourceFileIds));
    else if(p.action==='outline')body=setOutline(current,exactPayload(p.payload,['sections'],['sections']).sections);
    else if(p.action==='figures')body=setFigures(current,exactPayload(p.payload,['currency','lines'],['currency','lines']));
    else if(p.action==='section'){const b=exactPayload(p.payload,['sectionId','text'],['sectionId','text']);body=setSection(current,b.sectionId,b.text,'owner');}
    else if(p.action==='approve-brief'){exactPayload(p.payload,[]);body=approveBrief(current);line='Brief approved. Start the work in Work.';}
    else if(p.action==='take-draft'){
     const b=exactPayload(p.payload,['runId'],['runId']),run=tx.find('venture-delivery-run',identifier(b.runId,'Draft'));
     check(run&&run.ventureId===venture.id&&run.orderId===orderId&&run.status==='accepted'&&!run.practice,'DOCUMENT_NOT_FOUND','Choose an accepted draft of this order.');
     body=takeDraft(current,run.id,run.editedText??(run.deliverable?draftLines(run.deliverable):''));
    }
    else if(p.action==='approve'){exactPayload(p.payload,[]);body=approveDocument(current);line='Document approved. Export it when you are ready.';}
    else{
     check(p.action==='export','INVALID_VENTURE_REQUEST','Choose a document desk action.');exactPayload(p.payload,[]);
     const parts=documentExportParts(current),files=[{name:'document.docx',bytes:storedZipBytes(parts.docx)}];
     if(parts.xlsx)files.push({name:'figures.xlsx',bytes:storedZipBytes(parts.xlsx)});
     if(parts.csv)files.push({name:'figures.csv',bytes:new TextEncoder().encode(parts.csv)});
     if(parts.receipt)files.push({name:'figures-receipt.json',bytes:new TextEncoder().encode(parts.receipt)});
     tx.emit('desk.changed',{playbook:P});
     return {playbook:P,kind:'document',id:orderId,result:{files:files.map(file=>({name:file.name,bytes:file.bytes.length,contentBase64:Buffer.from(file.bytes).toString('base64')})),sent:false,manualPath:'Review the exported files and send them to your client yourself.'},line:'Exported for your review. Nothing was sent.'};
    }
    const saved=tx.replace({...row,...body});result=itemOf(tx.state,venture,saved);
   }
   tx.emit('desk.changed',{playbook:P});tx.emit('queue.changed',{});
   return {playbook:P,kind:'document',id:orderId,result,line};
  });}
}});
