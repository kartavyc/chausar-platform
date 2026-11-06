import {authorize,check} from '../../../contracts.ts';
import {exactPayload,listRecords,readVenture,requireAppChannel,digest} from '../../records.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {booksZohoSession} from './posting-desk.ts';
import {createZohoSettlementAdapter} from '../../../adapters/accounting/zoho-settlement.ts';
import {stageSettlementPosting,applySettlementPosting,reconcileSettlementPosting,type SettlementTarget} from '../../build/accounting-settlements.ts';
export type SettlementDeskTypes={settlement:{filter:any;row:any;item:any;actions:Record<string,{payload:any;result:any}>}};
const top=(raw:unknown,op:'list'|'get'|'act')=>exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
export const SETTLEMENT_DESK:DeskHandlers={settlement:{
 async list(deps,ctx,p){top(p,'list');const filter=p.filter===undefined?{}:exactPayload(p.filter,['cycleId'],[]),{state,venture}=readVenture(deps,ctx);const cycle=filter.cycleId===undefined?null:listRecords(state,'venture-books-posting',venture.id).find(row=>row.id===filter.cycleId&&row.entry.kind==='cycle');check(filter.cycleId===undefined||cycle,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');return {playbook:'bookkeeping-cfo',kind:'settlement',rows:listRecords(state,'venture-books-posting',venture.id).filter(row=>row.entry.kind==='seller-month'&&(!cycle||row.cycleId===cycle.cycleId)),line:'Review the monthly source and record only confirmed received payments.'};},
 async get(deps,ctx,p){top(p,'get');const {state,venture}=readVenture(deps,ctx),row=listRecords(state,'venture-books-posting',venture.id).find(row=>row.id===p.id);check(row?.entry.kind==='seller-month','BOOKS_WORK_NOT_FOUND','Choose monthly seller work.');return {playbook:'bookkeeping-cfo',kind:'settlement',item:row,digest:row.entry.posting?.reviewDigest??digest(row)};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');top(p,'act');authorize(deps.store,ctx,'approve');check(['stage','apply','reconcile'].includes(p.action),'INVALID_VENTURE_REQUEST','Choose an available settlement action.');
  if(p.action==='reconcile'){exactPayload(p.payload,[]);const row=await reconcileSettlementPosting(deps,ctx,p.id);return {playbook:'bookkeeping-cfo',kind:'settlement',id:row.id,result:row,line:'Read the recorded settlement outcome before taking another action.'};}
  const {cycle,config,guard}=booksZohoSession(deps,ctx,p.id);const mapping=config.mapping;check(mapping,'BOOKS_MAPPING_REQUIRED','Map the customer before preparing received payments.');const adapter=createZohoSettlementAdapter({dataCenter:config.dataCenter,accessToken:config.accessToken,revision:config.revision,organizationId:cycle.companyId},deps.net),target:SettlementTarget={identity:adapter.connectionIdentity,companyId:cycle.companyId,
   async preparePayment(payment){guard();const result=await adapter.preparePayment(payment,mapping.customerId);guard();return result;},
   async sendPayment(prepared,beforeSend){guard();await adapter.sendPayment(prepared,()=>{guard();beforeSend();});},
   async readPayment(externalId){guard();const result=await adapter.readPayment(externalId);guard();return result;}};
  let row;if(p.action==='stage'){check(p.digest===undefined,'INVALID_VENTURE_REQUEST','A new dry run has no prior approval.');const b=exactPayload(p.payload,['uploadId'],['uploadId']);row=await stageSettlementPosting(deps,ctx,target,{id:p.id,uploadId:b.uploadId});}else{exactPayload(p.payload,[]);row=await applySettlementPosting(deps,ctx,target,{id:p.id,digest:p.digest});}
  return {playbook:'bookkeeping-cfo',kind:'settlement',id:row.id,result:row,line:'Read the recorded settlement outcome. No charge or bank transfer was made.'};
 }
}};
