// Browser rehearsal of the document desk (wave 6, 6E4). Every rule is the engine's own pure code (document-desk/core.ts)
// with the engine desk's exact request grammar, codes and words; the fake keeps its records per business.
import { check, digest } from '../../../../platform/shared/portable.ts';
import { exactTender as exact } from '../../../../platform/shared/venture/playbooks/tender-desk/sources-core.ts';
import { approveBrief, approveDocument, briefApproved, documentApproved, documentExportParts, draftLines, figureLines, newDocument, rebindSources, setFigures, setOutline, setSection, sourceDigestOf, takeDraft, unreceiptedAmounts } from '../../../../platform/shared/venture/playbooks/document-desk/core.ts';
import type { DocumentBody } from '../../../../platform/runtime/venture/playbooks/document-desk/records.ts';
import { storedZipBytes } from '../../../../platform/shared/venture/playbooks/kit/ooxml/browser.ts';
import {roomGuard} from './fake-client-room';
import type {FakePlaybookDesk} from './fake-playbooks';
import type {W4DeskHost} from './fake-w4';
import type {OrderLite} from './types';

type Row=DocumentBody&{id:string;at:string};
const P='document-desk';
const OFFERS=['handbook-sop','project-report','estimate','thesis-edit','technical-writing'];
const identifier=(value:unknown,field:string)=>{check(typeof value==='string'&&/^[A-Za-z0-9_.:-]{3,80}$/.test(value),'INVALID_VENTURE_REQUEST',`${field} must be a known identifier.`);return value as string;};
const base64=(bytes:Uint8Array)=>{let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);};

export function fakeDocumentDeskDesk(host:W4DeskHost):FakePlaybookDesk{
 const spaces=new Map<string,Row[]>();let seq=0;
 const rows=()=>spaces.get(host.current())??[],save=(next:Row[])=>spaces.set(host.current(),next);
 const request=(raw:unknown,op:'list'|'get'|'act')=>{const p=exact(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);check(p.playbook===P&&p.kind==='document','INVALID_VENTURE_REQUEST','Choose the document desk.');if(op==='list')check(p.filter===undefined,'INVALID_VENTURE_REQUEST','The document list takes no filter.');return p;};
 const orderOf=(id:string)=>{const order=(host.ask('venture.order.list',{}) as OrderLite[]).find(row=>row.id===id),offer=host.acceptedOffers?.().find(row=>row.id===order?.offerId);
  check(order&&order.status!=='cancelled'&&OFFERS.includes(offer?.playbookOffer??''),'ORDER_NOT_FOUND','Choose a current document order.');check((host.ask('venture.client.list',{}) as {id:string}[]).some(client=>client.id===order.clientId),'CLIENT_NOT_FOUND','Choose a current client.');return order;};
 const filesOf=(orderId:string,ids:unknown)=>{check(Array.isArray(ids)&&ids.length>=1&&ids.length<=20&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'),'DOCUMENT_SOURCE_REQUIRED','Choose one to twenty client files the document rests on.');
  const files=host.orderFiles?.(orderId)??[];return (ids as string[]).map(id=>{const file=files.find(row=>row.id===id);check(file,'DOCUMENT_SOURCE_REQUIRED','Use only files attached to this client order.');return {id,digest:file.digest};});};
 const stale=(body:DocumentBody)=>{const files=host.orderFiles?.(body.orderId)??[],found=body.sourceFileIds.map(id=>files.find(row=>row.id===id));return found.some(file=>!file)||sourceDigestOf(found.map(file=>({id:file!.id,digest:file!.digest})))!==body.sourceDigest;};
 const bodyOf=(row:Row):DocumentBody=>{const {id:_i,at:_a,...body}=row;return body;};
 const itemOf=(row:Row)=>{const body=bodyOf(row);return {...body,id:row.id,stale:stale(body),briefApproved:briefApproved(body),approved:documentApproved(body),figureWords:body.figures?figureLines(body.figures):[],
  unreceipted:body.sections.flatMap(section=>{const amounts=unreceiptedAmounts(section.text,body.figures);return amounts.length?[{sectionId:section.id,amounts}]:[];}),missing:body.sections.filter(section=>!section.text.trim()).map(section=>section.id)};};
 const emit=()=>host.emit({type:'desk.changed',businessId:host.current(),at:host.now()} as never);
 return {playbook:P,
  forgetPeople(people){const clients=new Set(people.flatMap(p=>p.clientId?[p.clientId]:[])),handles=people.flatMap(p=>[...p.names,...p.emails,...p.phones,...p.urls??[]]).filter(h=>h.length>=3),named=(v:unknown)=>handles.some(h=>JSON.stringify(v).toLowerCase().includes(h.toLowerCase()));const kept=rows().filter(row=>!clients.has(row.clientId)&&!named(row));if(kept.length!==rows().length){save(kept);emit();}},
  kinds:{document:{
   list:raw=>roomGuard(()=>{request(raw,'list');return {playbook:P,kind:'document',rows:rows().map(row=>({orderId:row.orderId,title:row.title,docType:row.docType,briefApproved:briefApproved(bodyOf(row)),approved:documentApproved(bodyOf(row))})),line:'Client documents built from their own files. Every amount comes from the figures table.'};}),
   get:raw=>roomGuard(()=>{const p=request(raw,'get'),orderId=identifier(p.id,'Order'),row=rows().find(item=>item.orderId===orderId);check(row,'DOCUMENT_NOT_FOUND','Set up this order\'s document first.');return {playbook:P,kind:'document',item:itemOf(row),digest:digest(row)};}),
   act:raw=>roomGuard(()=>{const p=request(raw,'act'),orderId=identifier(p.id,'Order'),order=orderOf(orderId),row=rows().find(item=>item.orderId===orderId);let body:DocumentBody,line='Saved for your review. Nothing was sent.';
    if(p.action==='create'){
     check(!row&&p.digest===undefined,'APPROVAL_CHANGED','This order already has a document.');
     const b=exact(p.payload,['docType','title','sourceFileIds'],['docType','title','sourceFileIds']);
     body=newDocument({orderId,clientId:order.clientId,docType:b.docType,title:b.title,files:filesOf(orderId,b.sourceFileIds)});
     const made:Row={...body,id:'document_'+(++seq),at:host.now()};save([...rows(),made]);emit();
     return {playbook:P,kind:'document',id:orderId,result:itemOf(made),line};
    }
    check(row,'DOCUMENT_NOT_FOUND','Set up this order\'s document first.');check(p.digest===digest(row),'APPROVAL_CHANGED','The document changed. Read it again.');
    check(row.clientId===order.clientId,'DERIVED_STALE','The order\'s client changed. Set up the document again.');
    const current=bodyOf(row);
    if(p.action!=='sources')check(!stale(current),'DERIVED_STALE','A client file changed. Choose the document\'s files again.');
    if(p.action==='sources')body=rebindSources(current,filesOf(orderId,exact(p.payload,['sourceFileIds'],['sourceFileIds']).sourceFileIds));
    else if(p.action==='outline')body=setOutline(current,exact(p.payload,['sections'],['sections']).sections);
    else if(p.action==='figures')body=setFigures(current,exact(p.payload,['currency','lines'],['currency','lines']));
    else if(p.action==='section'){const b=exact(p.payload,['sectionId','text'],['sectionId','text']);body=setSection(current,b.sectionId,b.text,'owner');}
    else if(p.action==='approve-brief'){exact(p.payload,[]);body=approveBrief(current);line='Brief approved. Start the work in Work.';}
    else if(p.action==='take-draft'){
     const b=exact(p.payload,['runId'],['runId']),runId=identifier(b.runId,'Draft'),run=(host.ask('venture.delivery.list',{}) as {id:string;orderId:string;status:string;practice:boolean;editedText?:string|null;deliverable:{sections?:{heading:string;parts:{kind:string;text?:string}[]}[]}|null}[]).find(item=>item.id===runId);
     check(run&&run.orderId===orderId&&run.status==='accepted'&&!run.practice,'DOCUMENT_NOT_FOUND','Choose an accepted draft of this order.');
     body=takeDraft(current,run.id,run.editedText??(run.deliverable?.sections?draftLines({sections:run.deliverable.sections}):''));
    }
    else if(p.action==='approve'){exact(p.payload,[]);body=approveDocument(current);line='Document approved. Export it when you are ready.';}
    else{
     check(p.action==='export','INVALID_VENTURE_REQUEST','Choose a document desk action.');exact(p.payload,[]);
     const parts=documentExportParts(current),files=[{name:'document.docx',bytes:storedZipBytes(parts.docx)}];
     if(parts.xlsx)files.push({name:'figures.xlsx',bytes:storedZipBytes(parts.xlsx)});
     if(parts.csv)files.push({name:'figures.csv',bytes:new TextEncoder().encode(parts.csv)});
     if(parts.receipt)files.push({name:'figures-receipt.json',bytes:new TextEncoder().encode(parts.receipt)});
     emit();
     return {playbook:P,kind:'document',id:orderId,result:{files:files.map(file=>({name:file.name,bytes:file.bytes.length,contentBase64:base64(file.bytes)})),sent:false,manualPath:'Review the exported files and send them to your client yourself.'},line:'Exported for your review. Nothing was sent.'};
    }
    const saved:Row={...row,...body};save(rows().map(item=>item.id===row.id?saved:item));emit();
    return {playbook:P,kind:'document',id:orderId,result:itemOf(saved),line};
   })
  }}
 };
}
