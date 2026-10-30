// Owner-scoped career research. Public board indices never masquerade as complete captured listings.
import {check,ChausarError} from '../../../contracts.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {digest,exactPayload,identifier,requireAppChannel} from '../../records.ts';
import {pinnedSend} from '../../core/net-guard.ts';
import {careerOrder} from './order.ts';
import {careerEvidence} from './source-state.ts';
import {readCareerBoard} from './boards.ts';
import {careerShortlist,type CareerMatch,type CareerVerdict} from './shortlist.ts';
import {beforeCareerSend} from './before-send.ts';
import {renderClaims} from './facts.ts';
import {careerCoaching,type CareerCoachingInput} from './coaching.ts';
import type {BoardGates} from '../recruiting-desk/boards.ts';
const base={playbook:'job-search-desk' as const,kind:'research'};
function request(raw:unknown,act=false){const p=exactPayload(raw,act?['playbook','kind','id','action','payload','digest']:['playbook','kind','id'],act?['playbook','kind','id','action','payload','digest']:['playbook','kind','id']);check(p.playbook===base.playbook&&p.kind===base.kind,'INVALID_VENTURE_REQUEST','Choose career research.');return p;}
export const CAREER_RESEARCH_DESK:DeskHandlers={research:{
 async get(deps,ctx,raw){const p=request(raw),scope=careerOrder(deps,ctx,identifier(p.id,'Order')),evidence=careerEvidence(deps.store.read(),scope.venture.id,scope.order.id);return{...base,item:{orderId:scope.order.id,facts:evidence.facts,listings:evidence.listings,humanPath:'The client sends and applies.'},digest:digest({order:scope.order,...evidence})};},
 async act(deps,ctx,raw){requireAppChannel(ctx,'venture.desk.act');const p=request(raw,true),id=identifier(p.id,'Order');const current=()=>{const scope=careerOrder(deps,ctx,id),evidence=careerEvidence(deps.store.read(),scope.venture.id,id);check(p.digest===digest({order:scope.order,...evidence}),'CAREER_SOURCE_CHANGED','Review the current order, facts and sources.');return{...scope,evidence};};const first=current(),reply=(result:unknown)=>({...base,id,result,line:'Review this research. The client sends and applies.'});
  if(p.action==='read-board'){const b=exactPayload(p.payload,['provider','slug','gates'],['provider','slug','gates']);check(typeof b.provider==='string'&&typeof b.slug==='string','INVALID_VENTURE_REQUEST','Choose the public board and company.');try{const result=await readCareerBoard(b.provider,b.slug,b.gates as BoardGates,{...deps.net,send:async target=>{current();return(deps.net?.send??pinnedSend)(target);}});current();return reply(result);}catch(error){if(error instanceof Error&&'code'in error&&typeof error.code==='string')throw new ChausarError(error.code,error.message);throw error;}}
  if(p.action==='shortlist'){const b=exactPayload(p.payload,['matches','threshold'],['matches','threshold']),matches=b.matches as CareerMatch[];check(Array.isArray(matches)&&matches.every(r=>r&&first.evidence.listings.some(l=>l.id===r.id)),'CAREER_NOT_FOUND','Review only saved listings from this order.');const links=first.order.intake?.fields?.links,total=Math.max(Array.isArray(links)?new Set(links).size:0,first.evidence.listings.length);return reply({...careerShortlist(total,matches,b.threshold as CareerVerdict),needsOwnerReview:true,saved:false});}
  if(p.action==='coaching'){const b=exactPayload(p.payload,['input'],['input']),input=b.input as CareerCoachingInput;check(input&&input.research&&first.evidence.listings.some(l=>l.url===input.research!.url&&l.text.includes(input.research!.text)),'CAREER_SOURCE_CHANGED','Choose a researched quote from this order saved listings.');return reply({...careerCoaching(first.evidence.facts,input),saved:false});}
  check(p.action==='check-outreach','INVALID_VENTURE_REQUEST','Choose a career research action.');const b=exactPayload(p.payload,['text','listingId','quote','factId','clientConfirmed','voiceConfirmed'],['text','listingId','quote','factId','clientConfirmed','voiceConfirmed']),listing=first.evidence.listings.find(l=>l.id===b.listingId);check(listing&&typeof b.quote==='string'&&!!b.quote.trim()&&listing.text.includes(b.quote),'CAREER_SOURCE_CHANGED','Choose an exact quote from this order saved listing.');const claims=renderClaims(first.evidence.facts,[{factId:b.factId as string,use:'career outreach'}]);check(claims.ok,claims.ok?'CAREER_UNSTATED_FACT':claims.code==='claim-boundary'?'CAREER_CLAIM_BOUNDARY':'CAREER_UNSTATED_FACT','Use an approved client fact within its boundaries.');return reply({...beforeCareerSend({text:b.text as string,researchedFact:{text:b.quote,url:listing.url},clientFact:{factId:b.factId as string,text:claims.lines[0]!},clientConfirmed:b.clientConfirmed===true,voiceConfirmed:b.voiceConfirmed===true}),sent:false});
 }
}};
