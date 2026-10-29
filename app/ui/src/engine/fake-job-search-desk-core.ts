// Career browser state uses the same portable fact, source and file contracts. No provider call is simulated.
import {check,digest} from '../../../../platform/runtime/portable';
import {EngineError,type OrderLite,type BlueprintViewLite} from './types';
import type {W4DeskHost} from './fake-w4';
import type {CareerFactBody,CareerListingBody,CareerThreadBody} from '../../../../platform/runtime/venture/playbooks/job-search-desk/records';
import {currentCareerFacts} from '../../../../platform/runtime/venture/playbooks/job-search-desk/state';
import {CAREER_PRIVACY_RULE} from '../../../../platform/runtime/venture/playbooks/job-search-desk/metadata-core';
export type CareerRow<T> = T&{id:string;kind:string;ventureId:string;memberId:string;epoch:number;at:string};
export type FactRow=CareerRow<CareerFactBody>;export type ListingRow=CareerRow<CareerListingBody>;export type ThreadRow=CareerRow<CareerThreadBody>;
export const exact=(raw:unknown,keys:string[],required=keys)=>{check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&(Object.getPrototypeOf(raw)===Object.prototype||Object.getPrototypeOf(raw)===null),'INVALID_VENTURE_REQUEST','Send one request object.');const p=raw as Record<string,unknown>;check(Object.keys(p).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(p,k)),'INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');return p;};
export function careerIdentifier(value:unknown,label:string):string{check(typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value),'INVALID_VENTURE_REQUEST',label+' must be a known identifier.');return value;}
export const clientRule=()=>check(CAREER_PRIVACY_RULE.confirmedBy,'RULE_UNCONFIRMED','A lawyer has not confirmed the rule "Client privacy review" yet. It works in practice runs only until they do.');
export async function guarded<T>(run:()=>T|Promise<T>){try{return structuredClone(await run());}catch(e){if(e instanceof Error&&'code'in e)throw new EngineError(String(e.code),e.message);throw e;}}
export function careerFakeState(host:W4DeskHost){
 const spaces=new Map<string,{facts:Map<string,FactRow>;listings:Map<string,ListingRow>;threads:Map<string,ThreadRow>}>();let seq=0;
 const rows=()=>{if(!spaces.has(host.current()))spaces.set(host.current(),{facts:new Map(),listings:new Map(),threads:new Map()});return spaces.get(host.current())!;};
 const base=(kind:string)=>({id:'career_'+(++seq),kind,ventureId:'venture_'+host.current(),memberId:'owner',epoch:1,at:host.now()});
 const order=(id:unknown)=>{check(typeof id==='string'&&!!id,'INVALID_VENTURE_REQUEST','Choose a current order.');const row=(host.ask('venture.order.list',{}) as OrderLite[]).find(o=>o.id===id&&o.status!=='cancelled');check(row,'ORDER_NOT_FOUND','Choose a current career order.');const plan=host.ask('venture.blueprint.get',{}) as BlueprintViewLite|null,offer=plan?.blueprint.offers.find(o=>o.id===row.offerId);check(offer?.playbookOffer&&['monthly-job-search','interview-prep-pack','job-title-audit','profile-and-tailoring','weekly-shortlist','career-coaching'].includes(offer.playbookOffer),'CAREER_ORDER_REQUIRED','Choose a career service order.');const view=host.ask('venture.get',{}) as {venture?:{launchStage?:string}}|null;if(!['rehearsal','shadow'].includes(view?.venture?.launchStage??''))clientRule();return row;};
 const evidence=(id:string)=>{const current=(host.ask('venture.order.list',{}) as OrderLite[]).find(o=>o.id===id);const facts=currentCareerFacts([...rows().facts.values()].filter(f=>f.orderId===id&&f.clientId===current?.clientId).map(f=>f.state)),listings=[...rows().listings.values()].filter(l=>l.orderId===id&&l.clientId===current?.clientId);return {facts,listings,factsDigest:digest(facts),sourcesDigest:digest(listings.map(l=>({id:l.id,url:l.url,text:l.text,revision:l.revision})))};};
 const emit=()=>host.emit({type:'desk.changed',businessId:host.current(),at:host.now()});
 const request=(raw:unknown,kind:string,op:'list'|'get'|'act')=>{const keys=op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],required=op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload',...(kind==='research'?['digest']:[])],p=exact(raw,keys,required);check(p.playbook==='job-search-desk'&&p.kind===kind,'INVALID_VENTURE_REQUEST',kind==='thread'?'Choose a career thread.':kind==='research'?'Choose career research.':'Choose a career record.');if((kind==='fact'||kind==='listing')&&op!=='list')careerIdentifier(p.id,'Career record');if(kind==='thread'&&op==='act')careerIdentifier(p.id,'Career thread');if(kind==='research')careerIdentifier(p.id,'Order');return p;};
 const reply=(kind:string,row:FactRow|ListingRow|ThreadRow)=>({playbook:'job-search-desk',kind,id:row.id,result:structuredClone(row),line:'Saved for review. The client sends and applies.'});
 const active=()=>check(!(host.ask('venture.get',{}) as {paused?:unknown}|null)?.paused,'BUSINESS_PAUSED','This business is paused.');
 return {host,rows,base,order,evidence,emit,request,reply,active};
}
export type CareerFakeState=ReturnType<typeof careerFakeState>;
