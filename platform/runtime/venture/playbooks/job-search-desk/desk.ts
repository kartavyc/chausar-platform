// Chausar playbook: Job-search and career desk (Ink v2 wave 5, packages 5I). Its desk: the handlers venture.desk.list,
// .get and .act reach for its own record kinds (playbooks/desks.ts), and their types (playbooks/desk-types.ts). Package
// 5-0 left it empty, so every desk method for this playbook answers NOT_BUILT_YET. Written for Chausar; nothing here is
// learned from an outside source.
import type {DeskHandlers,DeskKindTypes} from '../desk-types.ts';
import {check,ChausarError} from '../../../contracts.ts';
import type {CareerFactRecord,CareerListingRecord} from '../../contracts.ts';
import {digest,exactPayload,identifier,listRecords,readVenture,requireAppChannel,ventureAction} from '../../records.ts';
import {hash} from '../../../portable.ts';
import {pinnedSend} from '../../core/net-guard.ts';
import {careerOrder} from './order.ts';
import {proposeCareerFact,approveCareerFact} from './state.ts';
import {validateFact,type CareerFact} from './facts.ts';
import {captureCareerListing} from './capture.ts';
import {CAREER_THREAD_DESK} from './thread-desk.ts';
import {CAREER_RESEARCH_DESK} from './research-desk.ts';

/** This desk's record kinds, each a DeskKindTypes (desk-types.ts) by kind; none until the package lands. */
export type JobSearchDeskDeskTypes={fact:DeskKindTypes;listing:DeskKindTypes;thread:DeskKindTypes;research:DeskKindTypes};
/** This desk's handlers by record kind; none until the package lands. */
const kinds={fact:'venture-career-fact',listing:'venture-career-listing'} as const;
function request(raw:unknown,op:'list'|'get'|'act'){
 const p=exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
 check(p.playbook==='job-search-desk'&&typeof p.kind==='string'&&Object.hasOwn(kinds,p.kind),'INVALID_VENTURE_REQUEST','Choose a career record.');return p;
}
const handler:NonNullable<DeskHandlers[string]>={
 async list(deps,ctx,raw){const p=request(raw,'list'),filter=p.filter===undefined?{}:exactPayload(p.filter,['orderId'],[]),{state,venture}=readVenture(deps,ctx);check(filter.orderId===undefined||typeof filter.orderId==='string','INVALID_VENTURE_REQUEST','Choose a current order.');const rows=listRecords(state,kinds[p.kind as keyof typeof kinds],venture.id).filter(row=>filter.orderId===undefined||row.orderId===filter.orderId);return {playbook:'job-search-desk',kind:String(p.kind),rows,line:'Career evidence. No message or application was sent.'};},
 async get(deps,ctx,raw){const p=request(raw,'get'),id=identifier(p.id,'Career record'),{state,venture}=readVenture(deps,ctx),row=listRecords(state,kinds[p.kind as keyof typeof kinds],venture.id).find(row=>row.id===id);check(row,'CAREER_NOT_FOUND','Choose a current career record.');return {playbook:'job-search-desk',kind:String(p.kind),item:row,digest:digest(row)};},
 async act(deps,ctx,raw){
  requireAppChannel(ctx,'venture.desk.act');const p=request(raw,'act'),id=identifier(p.id,'Career record');
  const {state,venture}=readVenture(deps,ctx),saved=listRecords(state,kinds[p.kind as keyof typeof kinds],venture.id).find(row=>row.id===id),scope=careerOrder(deps,ctx,saved?.orderId??id),orderDigest=digest(scope.order);
  const fresh=()=>{const live=careerOrder(deps,ctx,scope.order.id);check(digest(live.order)===orderDigest,'APPROVAL_STALE','The client or order changed. Review it again.');};
  let fetched:Awaited<ReturnType<typeof captureCareerListing>>|null=null;
  if(p.kind==='listing'&&p.action==='capture'){
   const b=exactPayload(p.payload,['url','approvedUrl'],['url','approvedUrl']);check(typeof b.url==='string'&&b.approvedUrl===b.url&&p.digest===undefined&&!saved,'APPROVAL_STALE','Approve the exact job address.');
   fetched=await captureCareerListing(b.url,{...deps.net,send:async target=>{fresh();return (deps.net?.send??pinnedSend)(target);}});fresh();
  }
  return ventureAction(deps,ctx,'approve','career.desk',tx=>{
   fresh();const order=tx.find('venture-order',scope.order.id);check(order&&digest(order)===orderDigest,'APPROVAL_STALE','Review the current career order.');let row:CareerFactRecord|CareerListingRecord;
   if(p.kind==='fact'){
    if(p.action==='propose'){
     check(!saved&&p.digest===undefined,'APPROVAL_STALE','Use a new proposal for this order.');const b=exactPayload(p.payload,['value'],['value']),value=b.value as CareerFact;validateFact(value);
     check(!tx.list('venture-career-fact').some(f=>f.orderId===order.id&&(f.state.approved?.id??f.state.proposal?.id)===value.id),'INVALID_VENTURE_REQUEST','This fact already has a ledger entry.');
     row=tx.put<CareerFactRecord>({...tx.base('venture-career-fact'),orderId:order.id,clientId:order.clientId,state:proposeCareerFact(null,value)});
    }else{
     const current=tx.find('venture-career-fact',id);check(current&&current.orderId===order.id&&current.clientId===order.clientId,'CAREER_NOT_FOUND','Choose this order fact.');check(p.digest===digest(current),'APPROVAL_STALE','Review the current fact proposal.');
     if(p.action==='approve'){exactPayload(p.payload,[],[]);row=tx.replace({...current,state:approveCareerFact(current.state,digest(current.state))});}
     else if(p.action==='revise'){const b=exactPayload(p.payload,['value'],['value']);row=tx.replace({...current,state:proposeCareerFact(current.state,b.value as CareerFact)});}
     else throw new ChausarError('INVALID_VENTURE_REQUEST','Choose a career fact action.');
    }
   }else{
    check(!saved&&p.digest===undefined,'APPROVAL_STALE','Add a new source listing.');let url:string,text:string,revision:string,sourceKind:CareerListingRecord['sourceKind'];
    if(p.action==='capture'){check(fetched,'CAREER_CAPTURE_INCOMPLETE','No job was saved.');({url,text,revision}=fetched);sourceKind='static-page';}
    else{check(p.action==='paste','INVALID_VENTURE_REQUEST','Choose a listing capture or pasted source.');const b=exactPayload(p.payload,['url','text'],['url','text']);check(typeof b.url==='string'&&b.url.length<=2000&&typeof b.text==='string'&&!!b.text.trim()&&b.text.length<=500000,'INVALID_VENTURE_REQUEST','Paste a bounded job text and its source address.');let parsed:URL;try{parsed=new URL(b.url);}catch{throw new ChausarError('INVALID_VENTURE_REQUEST','Use an HTTPS job source address.');}check(parsed.protocol==='https:'&&!parsed.username&&!parsed.password,'INVALID_VENTURE_REQUEST','Use an HTTPS job source address.');url=parsed.href;text=b.text;revision=hash(text);sourceKind='owner-paste';}
    row=tx.put<CareerListingRecord>({...tx.base('venture-career-listing'),orderId:order.id,clientId:order.clientId,url,text,revision,sourceKind,capturedOn:tx.now});
   }
   tx.emit('desk.changed',{playbook:'job-search-desk'});return {playbook:'job-search-desk' as const,kind:String(p.kind),id:row.id,result:row,line:'Saved for review. The client sends and applies.'};
  });
 }
};
export const JOB_SEARCH_DESK_DESK:DeskHandlers={fact:handler,listing:handler,...CAREER_THREAD_DESK,...CAREER_RESEARCH_DESK};
