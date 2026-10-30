// Original owner accounting desk. Session credentials never enter durable work or provider proposals.
import {randomUUID} from 'node:crypto';
import {authorize,check,type Context} from '../../../contracts.ts';
import type {VentureDeps,BooksPostingRecord} from '../../contracts.ts';
import {readVenture,listRecords,exactPayload,requireAppChannel,digest} from '../../records.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {createZohoWriteAdapter} from '../../../adapters/accounting/zoho-write.ts';
import {stageBooksPosting,applyBooksPosting,issueBooksPosting,reconcileBooksPosting,refreshBooksConnection,type BooksTarget} from '../../build/accounting-write.ts';
import {booksSecretName,zohoConnectionInput,zohoAccountInput,type BooksConnection} from './connection-core.ts';
export type BooksPostingDeskTypes={posting:{filter:any;row:any;item:any;actions:Record<string,{payload:any;result:any}>}};
const top=(raw:unknown,op:'list'|'get'|'act')=>exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
function selected(deps:VentureDeps,ctx:Context,id:unknown){const {state,venture}=readVenture(deps,ctx),rows=listRecords(state,'venture-books-posting',venture.id),row=rows.find(value=>value.id===id);check(row,'BOOKS_WORK_NOT_FOUND','Choose a client finance cycle or dry run.');const cycle=rows.find(value=>value.entry.kind==='cycle'&&value.cycleId===row.cycleId);check(cycle?.entry.kind==='cycle'&&cycle.clientId===row.clientId&&listRecords(state,'venture-client',venture.id).some(client=>client.id===row.clientId),'BOOKS_CYCLE_INVALID','Choose an existing client finance cycle.');return {venture,row,cycle:cycle.entry.cycle,cycleRecord:cycle};}
export function booksZohoSession(deps:VentureDeps,ctx:Context,id:string){
 const selectedWork=selected(deps,ctx,id),{venture,cycle}=selectedWork;check(cycle.system==='zoho','BOOKS_CONNECTION_INVALID','This accounting installation needs its qualified connection or manual path.');
 const key=booksSecretName(venture.id,cycle.clientId,cycle.companyId),raw=deps.secrets.get(key);check(raw,'BOOKS_CONNECTION_REQUIRED','Connect this client account for the open session.');const config=JSON.parse(raw) as BooksConnection&{revision:string};
 const guard=()=>{authorize(deps.store,ctx,'approve');const live=selected(deps,ctx,id);check(live.venture.id===venture.id&&digest(live.cycle)===digest(cycle)&&deps.secrets.get(key)===raw,'APPROVAL_STALE','The client account connection changed. Review a new dry run.');};
 return {cycle,config,guard};
}
function targetFor(deps:VentureDeps,ctx:Context,id:string):BooksTarget{
 const {cycle,config,guard}=booksZohoSession(deps,ctx,id);const mapping=config.mapping;check(mapping,'BOOKS_MAPPING_REQUIRED','Map the customer and items before preparing invoice drafts.');
 const adapter=createZohoWriteAdapter({dataCenter:config.dataCenter,accessToken:config.accessToken,revision:config.revision,organizationId:cycle.companyId},deps.net);
 return {identity:adapter.connectionIdentity,system:'zoho',companyId:cycle.companyId,
  async readExisting(ids){guard();const result=await adapter.readExisting(ids);guard();return result;},
  async prepareDraft(row){guard();const lines=row.lines.map(line=>{const mapped=mapping.lines.find(value=>value.itemId===line.itemId);check(mapped,'BOOKS_MAPPING_REQUIRED','Map every source item before preparing a draft.');return mapped;});const result=await adapter.prepareDraft(row,{...mapping,lines});guard();return result;},
  async createDraft(prepared,beforeSend){guard();await adapter.sendDraft(prepared,()=>{guard();beforeSend();});},
  async issue(row,beforeSend){guard();await adapter.issue(row,()=>{guard();beforeSend();});}};
}
function connectionView(deps:VentureDeps,ctx:Context,id:unknown){const {venture,cycle,cycleRecord}=selected(deps,ctx,id);return {id:cycleRecord.id,system:cycle.system,companyId:cycle.companyId,connected:deps.secrets.has(booksSecretName(venture.id,cycle.clientId,cycle.companyId)),sessionOnly:true};}
const answer=(row:BooksPostingRecord)=>({playbook:'bookkeeping-cfo' as const,kind:'posting',id:row.id,result:row,line:'Read the recorded accounting outcome. Draft creation and issuing are separate approvals.'});
export const BOOKS_POSTING_DESK:DeskHandlers={posting:{
 async list(deps,ctx,p){top(p,'list');const filter=p.filter===undefined?{}:exactPayload(p.filter,['cycleId']);const {venture}=readVenture(deps,ctx);const cycle=filter.cycleId===undefined?null:selected(deps,ctx,filter.cycleId).cycle;return {playbook:'bookkeeping-cfo',kind:'posting',rows:listRecords(deps.store.read(),'venture-books-posting',venture.id).filter(row=>row.entry.kind==='posting'&&(!cycle||row.cycleId===cycle.id)),line:'Each dry run records its exact request and outcome.'};},
 async get(deps,ctx,p){top(p,'get');const {row}=selected(deps,ctx,p.id);if(row.entry.kind==='cycle'){const item=connectionView(deps,ctx,p.id);return {playbook:'bookkeeping-cfo',kind:'posting',item,digest:digest(item)};}check(row.entry.kind==='posting','BOOKS_WORK_NOT_FOUND','Choose an accounting dry run.');return {playbook:'bookkeeping-cfo',kind:'posting',item:row,digest:row.entry.reviewDigest};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');top(p,'act');authorize(deps.store,ctx,'approve');const {venture,row,cycle}=selected(deps,ctx,p.id);
  if(p.action==='configure-zoho'||p.action==='configure-zoho-account'||p.action==='disconnect'){check(row.entry.kind==='cycle'&&cycle.system==='zoho'&&p.digest===undefined,'BOOKS_CONNECTION_INVALID','Choose the Zoho client cycle connection.');const key=booksSecretName(venture.id,cycle.clientId,cycle.companyId);if(p.action==='disconnect'){exactPayload(p.payload,[]);deps.secrets.delete(key);}else{check(/^\d{1,100}$/.test(cycle.companyId),'BOOKS_CONNECTION_INVALID','Use the provider organisation ID for this cycle.');const input=p.action==='configure-zoho-account'?zohoAccountInput(p.payload):zohoConnectionInput(p.payload);deps.secrets.set(key,JSON.stringify({...input,revision:randomUUID()}));}return {playbook:'bookkeeping-cfo',kind:'posting',id:row.id,result:connectionView(deps,ctx,row.id),line:'This connection lasts only for the open session. Each exact draft still asks.'};}
  if(p.action==='reconcile'){exactPayload(p.payload,[]);return answer(await reconcileBooksPosting(deps,ctx,row.id));}
  check(['stage','apply','issue','refresh-connection'].includes(p.action),'INVALID_VENTURE_REQUEST','Choose a supported accounting action.');const target=targetFor(deps,ctx,row.id);
  if(p.action==='refresh-connection'){exactPayload(p.payload,[]);return answer(await refreshBooksConnection(deps,ctx,target,{id:row.id,digest:p.digest}));}
  if(p.action==='stage'){check(row.entry.kind==='cycle'&&p.digest===undefined,'INVALID_VENTURE_REQUEST','Prepare a new dry run from a client cycle.');const b=exactPayload(p.payload,['orderId','uploadId'],['orderId','uploadId']);return answer(await stageBooksPosting(deps,ctx,target,{...b,cycleId:row.id}));}
  if(p.action==='apply'){exactPayload(p.payload,[]);return answer(await applyBooksPosting(deps,ctx,target,{id:row.id,digest:p.digest}));}
  const b=exactPayload(p.payload,['externalId'],['externalId']);return answer(await issueBooksPosting(deps,ctx,target,{id:row.id,digest:p.digest,externalId:b.externalId}));
 }
}};
