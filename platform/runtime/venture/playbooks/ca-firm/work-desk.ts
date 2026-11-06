import {healthReportText} from './c2-checks.ts';
import {caExample} from './examples.ts';
// C2 original owner calculator and persistent review boundary. Source figures remain typed facts, never model amounts.
import {check,ChausarError} from '../../../contracts.ts';
import type {CaWorkingRecord,WorkReceiptRecord} from '../../contracts.ts';
import {digest,exactPayload,readVenture,listRecords,findRecord,requireAppChannel,ventureAction} from '../../records.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {ownerWorking} from './owner-input.ts';
import {whatIf,type WhatIfInput} from './what-if.ts';
import {documentEntries,type DocumentEntryInput} from './doc-entry.ts';
import {booksHealthCheck,type HealthInput} from './health-check.ts';
import type {CaReceipt} from './receipt.ts';
import {rateUseFor,caOfRecord} from './signoff.ts';
import {validateFinding,type CaWorkingBody} from './work-core.ts';
import {caWorkReceipt} from '../../delivery/harness/tools-ca.ts';
import {newLog} from './tool-inputs.ts';
import type {ToolEnv} from '../../delivery/harness/tools.ts';
import {rederiveCaReceipt} from './stored-receipt.ts';
const view=(row:CaWorkingRecord)=>({...row,digest:digest(row),...(row.mode==='health'?{reportText:healthReportText(row.receipt.working as import('./health-check.ts').HealthWorking,row.decisions)}:{})});
const out=(row:CaWorkingRecord)=>({playbook:'ca-firm' as const,kind:'working',id:row.id,result:view(row),line:'Preparation and review only. Nothing filed, sent or posted externally.'});
export const CA_WORK_DESK:DeskHandlers={working:{
 async list(deps,ctx,p){exactPayload(p,['playbook','kind','filter'],['playbook','kind']);const f=exactPayload(p.filter??{},['clientId']);const {state,venture}=readVenture(deps,ctx);return {playbook:'ca-firm',kind:'working',rows:listRecords(state,'venture-ca-working',venture.id).filter(row=>!f.clientId||row.clientId===f.clientId).map(view).reverse(),line:'Saved calculator workings and CA decisions.'};},
 async get(deps,ctx,p){exactPayload(p,['playbook','kind','id'],['playbook','kind','id']);const {state,venture}=readVenture(deps,ctx);const row=findRecord(state,'venture-ca-working',p.id);check(row?.ventureId===venture.id,'CA_WORK_NOT_FOUND','Choose a saved working.');return {playbook:'ca-firm',kind:'working',item:view(row),digest:digest(row)};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');check(ctx.role==='owner','OWNER_REQUIRED','Only the owner can record this review.');exactPayload(p,['playbook','kind','id','action','payload','digest'],['playbook','kind','id','action','payload']);check(['prepare','adopt','example','decide-finding','approve-vouchers'].includes(p.action),'CA_WORK_ACTION_INVALID','Choose a working action.');
  if(p.action==='example'){const body=exactPayload(p.payload,['mode'],['mode']);return {playbook:'ca-firm',kind:'working',id:'example',result:caExample(String(body.mode)),line:'Assumed example only. No client record was saved.'};}
  if(p.action==='prepare'||p.action==='adopt'){
   const body=p.action==='prepare'?exactPayload(p.payload,['clientId','mode','input'],['clientId','mode','input']):exactPayload(p.payload,['receiptId'],['receiptId']);
   return ventureAction(deps,ctx,'approve','ca.work.prepare',tx=>{let clientId:string,orderId:string|null=null,receiptId:string,receiptDigest:string,receipt:CaReceipt,mode:CaWorkingBody['mode'];const base=tx.base('venture-ca-working');
    if(p.action==='adopt'){
     const stored=tx.find('venture-work-receipt',String(body.receiptId));check(stored?.ca&&['books-health','doc-entry','what-if'].includes(stored.ca.engine)&&rederiveCaReceipt(stored).rederived==='same','CA_WORK_SOURCE_CHANGED','Choose a current CA calculator receipt.');check(stored.runRef.kind==='delivery','CA_WORK_SOURCE_CHANGED','Only client-delivery receipts can be adopted.');const run=tx.find('venture-delivery-run',stored.runRef.runId);const order=run?tx.find('venture-order',run.orderId):null;check(order,'ORDER_NOT_FOUND','Choose a receipt from a client order.');clientId=order.clientId;orderId=order.id;receiptId=stored.id;receiptDigest=stored.digest;receipt={...stored.ca,id:stored.ca.caReceiptId,figures:stored.figures} as unknown as CaReceipt;mode=stored.ca.engine==='books-health'?'health':stored.ca.engine==='doc-entry'?'document':'what-if';
     const existing=tx.list('venture-ca-working').find(row=>row.receiptId===receiptId&&row.receiptDigest===receiptDigest);if(existing)return out(existing);
    }else{
     clientId=String(body.clientId);check(tx.find('venture-client',clientId),'CLIENT_NOT_FOUND','Choose a current client.');check(['what-if','document','health'].includes(String(body.mode)),'CA_WORK_INPUT_INVALID','Choose a calculator working.');mode=body.mode as CaWorkingBody['mode'];const use=rateUseFor(tx.state,tx.venture!.id,'client');if((body.input as any)?.ownerForm===true)body.input=ownerWorking(mode,body.input as Record<string,unknown>);receipt=mode==='what-if'?whatIf(body.input as WhatIfInput,use):mode==='document'?documentEntries(body.input as DocumentEntryInput):booksHealthCheck(body.input as HealthInput,use);
     const env={deps,ventureId:tx.venture!.id,memberId:ctx.memberId,epoch:ctx.epoch,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'delivery',runId:base.id},files:[],tables:[],receipts:[],dictionary:[],allowed:[],sandbox:undefined,now:()=>tx.now} as ToolEnv;
     const stored=caWorkReceipt(env,receipt,body.input,newLog()).record;tx.put<WorkReceiptRecord>(stored);receiptId=stored.id;receiptDigest=stored.digest;
    }
    const vouchers=mode==='document'?(receipt.working as ReturnType<typeof documentEntries>['working']).vouchers:[];return out(tx.put<CaWorkingRecord>({...base,clientId,orderId,receiptId,receiptDigest,mode,receipt,decisions:[],vouchers,postedExternally:false}));
   });
  }
  const body=p.action==='decide-finding'?exactPayload(p.payload,['findingId','decision','membershipNo','evidence','note'],['findingId','decision','membershipNo','evidence','note']):exactPayload(p.payload,['voucherIds'],['voucherIds']);
  return ventureAction(deps,ctx,'approve',`ca.work.${p.action}`,tx=>{const row=tx.find('venture-ca-working',p.id);check(row,'CA_WORK_NOT_FOUND','Choose a saved working.');check(digest(row)===p.digest,'CA_WORK_CHANGED','The working changed. Review it again.');const stored=tx.find('venture-work-receipt',row.receiptId);check(stored&&stored.digest===row.receiptDigest&&rederiveCaReceipt(stored).rederived==='same','CA_WORK_SOURCE_CHANGED','The source receipt changed or was removed.');
   if(p.action==='approve-vouchers'){check(row.mode==='document','CA_WORK_INPUT_INVALID','Choose document vouchers.');const ids=body.voucherIds;check(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>row.vouchers.some(v=>v.id===id)),'CA_VOUCHER_UNKNOWN','Choose exact vouchers from this draft.');return out(tx.replace({...row,vouchers:row.vouchers.map(v=>ids.includes(v.id)?{...v,state:'approved' as const,approvedAt:tx.now}:v)}));}
   check(row.mode==='health','CA_WORK_INPUT_INVALID','Choose a health working.');const ca=caOfRecord(tx.state,tx.venture!.id);check(ca&&body.membershipNo===ca.membershipNumber,'CA_NOT_OF_RECORD','The named CA of record must decide this finding.');let decision;try{decision=validateFinding(body,row.receipt);}catch(e){throw new ChausarError((e as any).code,(e as Error).message);}return out(tx.replace({...row,decisions:[...row.decisions.filter(d=>d.findingId!==decision.findingId),{...decision,caName:ca.name,membershipNumber:ca.membershipNumber,at:tx.now}]}));
  });
 }
}};
