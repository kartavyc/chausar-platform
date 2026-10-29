// Same source checks as the real settlement desk; no remote provider evidence is invented in the demo.
import {EngineError,type OrderLite} from './types';
import type {W4DeskHost} from './fake-w4';
import type {FakeDeskKind} from './fake-playbooks';
import type {BooksPostingBody} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import {check,digest} from '../../../../platform/runtime/portable';
import {sellerBooksSource} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/seller-books-source';
import {settlementPayments,settlementPaymentSource} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/settlement-payments';
type Row=BooksPostingBody&{id:string};
function exact(raw:unknown,keys:string[],required=keys){check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.getPrototypeOf(raw)===Object.prototype,'INVALID_VENTURE_REQUEST','Use one request object.');const value=raw as Record<string,unknown>;check(Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),'INVALID_VENTURE_REQUEST','Use the exact required fields.');return value;}
const top=(raw:unknown,op:'list'|'get'|'act')=>exact(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
function guarded<T>(run:()=>T):T{try{return run();}catch(error){if(error instanceof Error&&'code'in error)throw new EngineError(String(error.code),error.message);throw error;}}
export function fakeBooksSettlement(host:W4DeskHost,rows:()=>Row[],requireMapping:(id:unknown)=>void):FakeDeskKind{
 const current=(id:unknown)=>{const row=rows().find(value=>value.id===id);check(row?.entry.kind==='seller-month','BOOKS_WORK_NOT_FOUND','Choose monthly seller work.');return row as Row&{entry:Extract<Row['entry'],{kind:'seller-month'}>};};
 return {
  list(p){return guarded(()=>{top(p,'list');const filter=p.filter===undefined?{}:exact(p.filter,['cycleId'],[]),cycle=filter.cycleId===undefined?null:rows().find(row=>row.id===filter.cycleId&&row.entry.kind==='cycle');check(filter.cycleId===undefined||cycle,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');return {playbook:'bookkeeping-cfo',kind:'settlement',rows:structuredClone(rows().filter(row=>row.entry.kind==='seller-month'&&(!cycle||row.cycleId===cycle.cycleId))),line:'Review the monthly source and record only confirmed received payments.'};});},
  get(p){return guarded(()=>{top(p,'get');const row=current(p.id);return {playbook:'bookkeeping-cfo',kind:'settlement',item:structuredClone(row),digest:row.entry.posting?.reviewDigest??digest(row)};});},
  act(p){return guarded(()=>{top(p,'act');check(['stage','apply','reconcile'].includes(p.action as string),'INVALID_VENTURE_REQUEST','Choose an available settlement action.');if(p.action==='reconcile'){exact(p.payload,[]);current(p.id);throw new EngineError('BOOKS_NOT_INTERRUPTED','Only interrupted settlement work needs reconciliation.');}
   requireMapping(p.id);const row=current(p.id);if(p.action==='apply'){exact(p.payload,[]);throw new EngineError('APPROVAL_STALE','Review the exact current settlement dry run.');}
   check(p.digest===undefined,'INVALID_VENTURE_REQUEST','A new dry run has no prior approval.');const b=exact(p.payload,['uploadId']),order=(host.ask('venture.order.list',{}) as OrderLite[]).find(value=>value.id===row.orderId),cycle=rows().find(value=>value.entry.kind==='cycle'&&value.cycleId===row.cycleId);
   check(order&&order.clientId===row.clientId&&order.status!=='cancelled'&&order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','Use only current client records with consent.');check(cycle?.entry.kind==='cycle'&&cycle.clientId===row.clientId&&cycle.entry.cycle.system==='zoho','BOOKS_CYCLE_INVALID','Use this client Zoho finance cycle.');
   const file=(id:unknown)=>{const value=host.orderFiles?.(row.orderId).find(value=>value.id===id);check(value?.format==='csv','BOOKS_SOURCE_CHANGED','Use the current bounded CSV from this client order.');const bytes=Uint8Array.from(atob(value.contentBase64),char=>char.charCodeAt(0));check(bytes.length<=500000,'BOOKS_SOURCE_CHANGED','Use the current bounded CSV from this client order.');return {...value,text:new TextDecoder().decode(bytes)};};
   const monthly=file(row.entry.uploadId),payment=file(b.uploadId);check(digest({id:monthly.id,bytes:monthly.contentBase64})===row.entry.sourceDigest,'BOOKS_SOURCE_CHANGED','The monthly reconciliation source changed.');const report=sellerBooksSource(monthly.text,cycle.entry.cycle,row.entry.report.month);check(digest(report)===digest(row.entry.report),'BOOKS_SOURCE_CHANGED','The monthly reconciliation changed.');settlementPayments(cycle.entry.cycle,report,settlementPaymentSource(payment.text));
   throw new EngineError('BOOKS_READ_FAILED','The existing books could not be read. Nothing was proposed or written.');
  });}
 };
}
