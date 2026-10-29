// Same setup source and first-provider validation as the real route. Demo has no remote accounting evidence.
import {EngineError,type OrderLite} from './types';
import type {W4DeskHost} from './fake-w4';
import type {FakeDeskKind} from './fake-playbooks';
import type {BooksPostingBody} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import {check,digest} from '../../../../platform/runtime/portable';
import {setupDraft} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/setup';
import {setupSource} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/setup-source';
import {setupMappings} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/setup-posting-core';
import {validateSetupMaster} from '../../../../platform/runtime/adapters/accounting/zoho-setup-validation';

type Row=BooksPostingBody&{id:string};
function exact(raw:unknown,keys:string[],required=keys){check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.getPrototypeOf(raw)===Object.prototype,'INVALID_VENTURE_REQUEST','Use one request object.');const value=raw as Record<string,unknown>;check(Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),'INVALID_VENTURE_REQUEST','Use the exact required fields.');return value;}
const top=(raw:unknown,op:'list'|'get'|'act')=>exact(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
function guarded<T>(run:()=>T):T{try{return run();}catch(error){if(error instanceof Error&&'code'in error)throw new EngineError(String(error.code),error.message);throw error;}}
export function fakeBooksSetup(host:W4DeskHost,rows:()=>Row[],requireConnection:(id:string)=>void):FakeDeskKind{
 const current=(id:unknown)=>{const row=rows().find(value=>value.id===id);check(row?.entry.kind==='setup','BOOKS_WORK_NOT_FOUND','Choose the client setup source.');return row as Row&{entry:Extract<Row['entry'],{kind:'setup'}>};};
 return {
 list(p){return guarded(()=>{top(p,'list');const filter=p.filter===undefined?{}:exact(p.filter,['cycleId'],[]),cycle=filter.cycleId===undefined?null:rows().find(row=>row.id===filter.cycleId&&row.entry.kind==='cycle');check(filter.cycleId===undefined||cycle,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');return {playbook:'bookkeeping-cfo',kind:'setup',rows:structuredClone(rows().filter(row=>row.entry.kind==='setup'&&(!cycle||row.cycleId===cycle.cycleId))),line:'Review exact source mappings before separate master and opening approvals.'};});},
 get(p){return guarded(()=>{top(p,'get');const row=current(p.id);return {playbook:'bookkeeping-cfo',kind:'setup',item:structuredClone(row),digest:row.entry.posting?.reviewDigest??digest(row)};});},
 act(p){return guarded(()=>{top(p,'act');check(['stage-masters','apply-masters','stage-opening','apply-opening','reconcile'].includes(p.action as string),'INVALID_VENTURE_REQUEST','Choose an available setup action.');if(p.action==='reconcile'){exact(p.payload,[]);current(p.id);throw new EngineError('BOOKS_NOT_INTERRUPTED','Only interrupted setup needs recovery.');}
 requireConnection(p.id as string);let b:Record<string,unknown>;if(p.action==='stage-masters'){check(p.digest===undefined,'INVALID_VENTURE_REQUEST','New master preparation has no earlier approval.');b=exact(p.payload,['mappings']);}else b=exact(p.payload,p.action==='stage-opening'?['migrationDate']:[]);
 const row=current(p.id);
 const order=(host.ask('venture.order.list',{}) as OrderLite[]).find(value=>value.id===row.orderId),cycle=rows().find(value=>value.entry.kind==='cycle'&&value.cycleId===row.cycleId);check(order&&order.clientId===row.clientId&&order.status!=='cancelled'&&order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','Use an active client order with current consent.');check(cycle?.entry.kind==='cycle'&&cycle.clientId===row.clientId&&cycle.entry.cycle.system==='zoho','BOOKS_CYCLE_INVALID','Use this client Zoho finance cycle.');
 const file=host.orderFiles?.(row.orderId).find(value=>value.id===row.entry.uploadId);check(file?.format==='csv'&&digest({id:file.id,bytes:file.contentBase64})===row.entry.sourceDigest,'BOOKS_SOURCE_CHANGED','The client setup file changed.');const bytes=Uint8Array.from(atob(file.contentBase64),char=>char.charCodeAt(0));check(bytes.length<=500000,'BOOKS_SOURCE_CHANGED','The client setup file changed.');const setup=setupDraft({cycle:cycle.entry.cycle,...setupSource(new TextDecoder().decode(bytes))});check(digest(setup)===digest(row.entry.setup),'BOOKS_SOURCE_CHANGED','The setup or cycle changed.');
 if(p.action==='apply-masters'||p.action==='apply-opening')throw new EngineError('APPROVAL_STALE','Review the exact setup proposal.');if(p.action==='stage-opening')throw new EngineError('APPROVAL_STALE','Confirm every master before a separate opening approval.');const maps=setupMappings(setup,b.mappings);validateSetupMaster(maps[0]!);throw new EngineError('BOOKS_READ_FAILED','The existing books could not be read. Nothing was proposed or written.');
 });}
 };
}
