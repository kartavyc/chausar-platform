// Owner setup actions. Session credentials are used only by the guarded provider factory.
import {authorize,check} from '../../../contracts.ts';
import {readVenture,listRecords,exactPayload,requireAppChannel,digest} from '../../records.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {booksZohoSession} from './posting-desk.ts';
import {createZohoSetupAdapter} from '../../../adapters/accounting/zoho-setup.ts';
import {stageSetupMasters,applySetupMasters,stageSetupOpening,applySetupOpening,reconcileSetupPosting,type SetupTarget} from '../../build/accounting-setup.ts';
export type SetupDeskTypes={setup:{filter:any;row:any;item:any;actions:Record<string,{payload:any;result:any}>}};
const top=(raw:unknown,op:'list'|'get'|'act')=>exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
export const SETUP_DESK:DeskHandlers={setup:{
 async list(deps,ctx,p){top(p,'list');const filter=p.filter===undefined?{}:exactPayload(p.filter,['cycleId'],[]),{state,venture}=readVenture(deps,ctx);const cycle=filter.cycleId===undefined?null:listRecords(state,'venture-books-posting',venture.id).find(row=>row.id===filter.cycleId&&row.entry.kind==='cycle');check(filter.cycleId===undefined||cycle,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');return {playbook:'bookkeeping-cfo',kind:'setup',rows:listRecords(state,'venture-books-posting',venture.id).filter(row=>row.entry.kind==='setup'&&(!cycle||row.cycleId===cycle.cycleId)),line:'Review exact source mappings before separate master and opening approvals.'};},
 async get(deps,ctx,p){top(p,'get');const {state,venture}=readVenture(deps,ctx),row=listRecords(state,'venture-books-posting',venture.id).find(row=>row.id===p.id);check(row?.entry.kind==='setup','BOOKS_WORK_NOT_FOUND','Choose the client setup source.');return {playbook:'bookkeeping-cfo',kind:'setup',item:row,digest:row.entry.posting?.reviewDigest??digest(row)};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');top(p,'act');authorize(deps.store,ctx,'approve');check(['stage-masters','apply-masters','stage-opening','apply-opening','reconcile'].includes(p.action),'INVALID_VENTURE_REQUEST','Choose an available setup action.');
  if(p.action==='reconcile'){exactPayload(p.payload,[]);const row=await reconcileSetupPosting(deps,ctx,p.id);return {playbook:'bookkeeping-cfo',kind:'setup',id:row.id,result:row,line:'Read the durable setup outcome before another action.'};}
  const {cycle,config,guard}=booksZohoSession(deps,ctx,p.id),adapter=createZohoSetupAdapter({dataCenter:config.dataCenter,accessToken:config.accessToken,revision:config.revision,organizationId:cycle.companyId},deps.net);
  const target:SetupTarget={identity:adapter.connectionIdentity,companyId:cycle.companyId,
   async readMaster(input){guard();const value=await adapter.readMaster(input);guard();return value;},async prepareMaster(input){guard();const value=await adapter.prepareMaster(input);guard();return value;},async sendMaster(prepared,beforeSend){guard();await adapter.sendMaster(prepared,()=>{guard();beforeSend();});},
   async readOpening(){guard();const value=await adapter.readOpening();guard();return value;},async prepareOpening(input){guard();const value=await adapter.prepareOpening(input);guard();return value;},async sendOpening(prepared,beforeSend){guard();await adapter.sendOpening(prepared,()=>{guard();beforeSend();});}};
  let row;if(p.action==='stage-masters'){check(p.digest===undefined,'INVALID_VENTURE_REQUEST','New master preparation has no earlier approval.');const b=exactPayload(p.payload,['mappings'],['mappings']);row=await stageSetupMasters(deps,ctx,target,{id:p.id,mappings:b.mappings});}
  else if(p.action==='stage-opening'){const b=exactPayload(p.payload,['migrationDate'],['migrationDate']);row=await stageSetupOpening(deps,ctx,target,{id:p.id,digest:p.digest,migrationDate:b.migrationDate});}
  else{exactPayload(p.payload,[]);row=await (p.action==='apply-masters'?applySetupMasters:applySetupOpening)(deps,ctx,target,{id:p.id,digest:p.digest});}
  return {playbook:'bookkeeping-cfo',kind:'setup',id:row.id,result:row,line:'Read the actual setup outcome. Opening balances require their own approval.'};
 }
}};
