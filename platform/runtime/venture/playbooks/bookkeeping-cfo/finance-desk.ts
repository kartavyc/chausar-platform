// Original 5K2 owner desk. Drafts and approvals never claim that the client's books were changed.
import {check,type State} from '../../../contracts.ts';
import type {BooksPostingRecord,VentureRecord} from '../../contracts.ts';
import {digest,listRecords,readVenture,exactPayload,requireAppChannel,ventureAction} from '../../records.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {financeCycle,type CycleInput} from './cycles.ts';
import {voucherDraft,approveVoucher,voucherLinesFromRupees} from './vouchers.ts';
import {setupDraft,type SetupInput} from './setup.ts';
import {setupSource} from './setup-source.ts';
import {sellerBooksSource} from './seller-books-source.ts';
import {sellerBooksReceipt} from './seller-books-receipt.ts';
import {financeReceipt} from './finance-receipt.ts';
import {financeAmounts} from './finance-receipt-core.ts';
import {setupHandoff} from './setup-handoff.ts';
export type FinanceDeskTypes={finance:{filter:any;row:any;item:any;actions:Record<string,{payload:any;result:any}>}};
function orderFor(state:State,venture:VentureRecord,id:unknown,consent=true){const order=listRecords(state,'venture-order',venture.id).find(row=>row.id===id);check(order,'ORDER_NOT_FOUND','Choose a client bookkeeping order.');if(consent)check(order.status!=='cancelled'&&order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','Use only an active client order with current consent.');return order;}
function fileFor(state:State,venture:VentureRecord,orderId:string,id:unknown){const file=listRecords(state,'venture-upload',venture.id).find(row=>row.id===id&&row.scope.kind==='order'&&row.scope.orderId===orderId);check(file,'BOOKS_RECEIPT_REQUIRED','Choose a file uploaded to this client order.');return {file,digest:digest({id:file.id,bytes:file.contentBase64})};}
function find(state:State,venture:VentureRecord,id:unknown){const record=listRecords(state,'venture-books-posting',venture.id).find(row=>row.id===id);check(record,'BOOKS_WORK_NOT_FOUND','That finance work was not found.');return record;}
function cycleFor(state:State,venture:VentureRecord,id:unknown,clientId:string){const record=find(state,venture,id);check(record.entry.kind==='cycle'&&record.clientId===clientId,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');return record.entry.cycle;}
function view(state:State,venture:VentureRecord,row:BooksPostingRecord){
 let stale=false;try{const order=orderFor(state,venture,row.orderId,row.entry.kind!=='cycle');stale=order.clientId!==row.clientId;
  if(row.entry.kind==='voucher')stale=stale||fileFor(state,venture,row.orderId,row.entry.voucher.receipt.uploadId).digest!==row.entry.voucher.receipt.digest;
  if(row.entry.kind==='setup'||row.entry.kind==='seller-month')stale=stale||fileFor(state,venture,row.orderId,row.entry.uploadId).digest!==row.entry.sourceDigest;
 }catch{stale=true;}
 const item=structuredClone(row);if(stale&&item.entry.kind==='voucher'){const prior=item.entry.voucher;item.entry.voucher=voucherDraft({cycle:prior.cycle,date:prior.date,description:prior.description,receipt:prior.receipt,lines:prior.lines});}
 return {...item,stale,amounts:item.entry.kind==='cycle'||item.entry.kind==='posting'||item.entry.kind==='seller-month'?[]:financeAmounts(item.entry.kind==='voucher'?item.entry.voucher.lines:item.entry.setup.opening),...(item.entry.kind==='seller-month'?{figures:sellerBooksReceipt(item.id,{id:item.entry.uploadId,name:'Monthly source',digest:item.entry.sourceDigest},item.entry.report).figures}:{})};
}
const top=(raw:unknown,op:'list'|'get'|'act')=>exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
export const FINANCE_DESK:DeskHandlers={finance:{
 async list(deps,ctx,p){top(p,'list');const filter=p.filter===undefined?{}:exactPayload(p.filter,['cycleId'],[]);const {state,venture}=readVenture(deps,ctx);let cycleId:string|undefined;if(filter.cycleId!==undefined){const row=find(state,venture,filter.cycleId);check(row.entry.kind==='cycle','BOOKS_CYCLE_INVALID','Choose a finance cycle.');cycleId=row.cycleId;}return {playbook:'bookkeeping-cfo',kind:'finance',rows:listRecords(state,'venture-books-posting',venture.id).filter(row=>cycleId?row.cycleId===cycleId:row.entry.kind==='cycle').map(row=>view(state,venture,row)),line:'Choose a client finance cycle. Entries never mix years.'};},
 async get(deps,ctx,p){top(p,'get');const {state,venture}=readVenture(deps,ctx),item=view(state,venture,find(state,venture,p.id));return {playbook:'bookkeeping-cfo',kind:'finance',item,digest:digest(item)};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');top(p,'act');return ventureAction(deps,ctx,'approve','bookkeeping.finance.'+p.action,tx=>{
  const state=tx.state,venture=tx.venture!;
  const save=(row:BooksPostingRecord,replace=false)=>{if(replace)tx.replace(row);else tx.put(row);tx.emit('desk.changed',{playbook:'bookkeeping-cfo',kind:'finance',id:row.id});return {playbook:'bookkeeping-cfo' as const,kind:'finance',id:row.id,result:view(state,venture,row),line:'Finance work saved. Nothing was posted to the client books.'};};
  if(p.action==='create-cycle'){
   check(p.id==='new'&&p.digest===undefined,'INVALID_VENTURE_REQUEST','A new cycle has no prior approval.');const b=exactPayload(p.payload,['orderId','system','companyId','from','to'],['orderId','system','companyId','from','to']);const order=orderFor(state,venture,b.orderId,false);
   const cycle=financeCycle({businessId:state.workspace.id,clientId:order.clientId,system:b.system as CycleInput['system'],companyId:b.companyId as string,from:b.from as string,to:b.to as string});
   check(!tx.list('venture-books-posting').some(row=>row.ventureId===venture.id&&row.entry.kind==='cycle'&&row.cycleId===cycle.id),'BOOKS_CYCLE_EXISTS','This client finance cycle already exists.');
   return save({...tx.base('venture-books-posting'),clientId:order.clientId,orderId:order.id,cycleId:cycle.id,entry:{kind:'cycle',cycle}});
  }
  if(p.action==='draft-voucher'||p.action==='draft-setup'){
   check(p.id==='new'&&p.digest===undefined,'INVALID_VENTURE_REQUEST','A new draft has no previous approval.');const keys=p.action==='draft-voucher'?['cycleId','orderId','receiptUploadId','date','description','lines']:['cycleId','orderId','uploadId'];const b=exactPayload(p.payload,keys,keys),order=orderFor(state,venture,b.orderId),cycle=cycleFor(state,venture,b.cycleId,order.clientId);
   if(p.action==='draft-voucher'){
    const source=fileFor(state,venture,order.id,b.receiptUploadId);const voucher=voucherDraft({cycle,date:b.date as string,description:b.description as string,lines:voucherLinesFromRupees(b.lines),receipt:{uploadId:source.file.id,digest:source.digest,clientId:order.clientId,orderId:order.id}});
    const base=tx.base('venture-books-posting'),receiptId=financeReceipt(tx,base.id,{id:source.file.id,name:source.file.name,digest:source.digest},voucher.lines);
    return save({...base,clientId:order.clientId,orderId:order.id,cycleId:cycle.id,entry:{kind:'voucher',voucher,receiptId}});
   }
   const source=fileFor(state,venture,order.id,b.uploadId),bytes=Buffer.from(source.file.contentBase64,'base64');check(source.file.format==='csv'&&bytes.length<=500000,'BOOKS_SETUP_INVALID','Use a setup CSV below five hundred kilobytes.');
   const setup=setupDraft({cycle,...setupSource(bytes.toString('utf8'))});
   const base=tx.base('venture-books-posting'),receiptId=financeReceipt(tx,base.id,{id:source.file.id,name:source.file.name,digest:source.digest},setup.opening);
   return save({...base,clientId:order.clientId,orderId:order.id,cycleId:cycle.id,entry:{kind:'setup',setup,uploadId:source.file.id,sourceDigest:source.digest,receiptId}});
  }
  if(p.action==='monthly-seller'){
   check(p.id==='new'&&p.digest===undefined,'INVALID_VENTURE_REQUEST','A new monthly report has no prior approval.');const b=exactPayload(p.payload,['cycleId','orderId','uploadId','month'],['cycleId','orderId','uploadId','month']),order=orderFor(state,venture,b.orderId),cycle=cycleFor(state,venture,b.cycleId,order.clientId),source=fileFor(state,venture,order.id,b.uploadId);
   check(source.file.format==='csv','BOOKS_SETUP_INVALID','Upload the monthly seller CSV.');const report=sellerBooksSource(Buffer.from(source.file.contentBase64,'base64').toString('utf8'),cycle,b.month as string),base=tx.base('venture-books-posting');
   const proof={...tx.base('venture-work-receipt'),...sellerBooksReceipt(base.id,{id:source.file.id,name:source.file.name,digest:source.digest},report)};proof.digest=digest({...proof,digest:''});tx.put(proof);
   return save({...base,clientId:order.clientId,orderId:order.id,cycleId:cycle.id,entry:{kind:'seller-month',report,uploadId:source.file.id,sourceDigest:source.digest,receiptId:proof.id}});
  }
  if(p.action==='export-setup'){exactPayload(p.payload,[]);const row=find(state,venture,p.id),item=view(state,venture,row);check(row.entry.kind==='setup','BOOKS_WORK_NOT_FOUND','Choose the client setup draft.');check(!item.stale,'BOOKS_SOURCE_CHANGED','The setup source changed. Prepare it again.');check(p.digest===digest(item),'APPROVAL_STALE','Read this exact setup draft before exporting it.');return {playbook:'bookkeeping-cfo',kind:'finance',id:row.id,result:setupHandoff(row.entry.setup,row.entry.receiptId,row.entry.sourceDigest),line:'The review package is ready for the bookkeeper. Nothing was created in the client accounting system.'};}
  check(p.action==='approve-voucher','INVALID_VENTURE_REQUEST','Choose an available finance action.');exactPayload(p.payload,[],[]);const record=find(state,venture,p.id),item=view(state,venture,record);
  check(record.entry.kind==='voucher','BOOKS_WORK_NOT_FOUND','Choose a receipt voucher.');check(!item.stale,'BOOKS_RECEIPT_CHANGED','The receipt changed or was removed. Draft the voucher again.');check(p.digest===digest(item),'APPROVAL_STALE','This voucher changed. Read it again.');check(record.entry.voucher.state==='draft','APPROVAL_STALE','This voucher is already approved.');
  const source=fileFor(state,venture,record.orderId,record.entry.voucher.receipt.uploadId),voucher=approveVoucher(record.entry.voucher,{digest:record.entry.voucher.digest,receiptDigest:source.digest,by:ctx.memberId,at:tx.now});return save({...record,entry:{...record.entry,voucher}},true);
 });}
}};
