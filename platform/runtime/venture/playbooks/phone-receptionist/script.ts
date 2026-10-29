// Original source-only receptionist script. Uses Chausar's untrusted-input screen and integer money formatter.
import {check,digest} from '../../../portable.ts';import {formatMinor} from '../../../currency.ts';import {screenUntrusted} from '../../policy/untrusted.ts';
type Price={id:string;label:string;minor:string;currency:'INR'|'USD'};
type FactsBody={business:string;hours:string;services:string[];faq:{question:string;answer:string}[];prices:Price[]};
export type ReceptionistFacts=FactsBody&{digest:string};
function record(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{check(!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'CALL_FACTS_INVALID','Use only the client facts and price list fields.');}
function words(value:unknown,max=1000){check(typeof value==='string'&&value.trim().length>0&&value.length<=max,'CALL_FACTS_INVALID','Use bounded client facts.');const screened=screenUntrusted({source:'client-answer',text:value},{mode:'enforce'});check(screened.status==='clean'&&screened.text===value,'CALL_FACTS_HELD','These client facts need review. Remove private details or instructions before approving a script.');return value;}
/** Capture client-provided facts, never a model's guessed hours, claim or price. */
export function receptionistFacts(input:unknown):ReceptionistFacts{
 record(input,['business','hours','services','faq','prices']);check(Array.isArray(input.services)&&input.services.length>0&&input.services.length<=100&&Array.isArray(input.faq)&&input.faq.length<=100&&Array.isArray(input.prices)&&input.prices.length<=100,'CALL_FACTS_INVALID','Use up to 100 client services, answers and prices.');
 const seen=new Set<string>();const prices=input.prices.map<Price>(value=>{record(value,['id','label','minor','currency']);check(typeof value.id==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id)&&!seen.has(value.id),'CALL_FACTS_INVALID','Give each client price a unique name.');seen.add(value.id);check(typeof value.minor==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(value.minor)&&(value.currency==='INR'||value.currency==='USD'),'CALL_FACTS_INVALID','Use exact whole minor units and the price currency.');return {id:value.id,label:words(value.label,200),minor:value.minor,currency:value.currency};});
 const body:FactsBody={business:words(input.business,200),hours:words(input.hours),services:input.services.map(v=>words(v,300)),faq:input.faq.map(v=>{record(v,['question','answer']);return {question:words(v.question,300),answer:words(v.answer)};}),prices};return {...body,digest:digest(body)};
}
const disclosure={en:'I am an AI assistant. This call may be recorded.',hi:'मैं एक एआई सहायक हूँ। यह कॉल रिकॉर्ड की जा सकती है।'};
const handoff={en:'A person needs to handle this request. Nothing has been booked or charged.',hi:'यह अनुरोध किसी व्यक्ति को संभालना होगा। कोई बुकिंग या भुगतान नहीं किया गया है।'};
export function receptionistScript(input:ReceptionistFacts,approvedDigest:string,language:'en'|'hi'){
 const {digest:original,...raw}=input,facts=receptionistFacts(raw);check(original===facts.digest&&approvedDigest===facts.digest,'APPROVAL_STALE','Approve these exact current client facts.');check(language==='en'||language==='hi','CALL_FACTS_INVALID','Choose English or Hindi.');
 const prices=facts.prices.map(p=>({...p,display:formatMinor(p.minor,p.currency),receipt:{id:'call-price-'+digest({facts:facts.digest,price:p}),provenance:'client-price-list' as const,minor:p.minor,currency:p.currency,sourceDigest:facts.digest}}));
 const body={factsDigest:facts.digest,language,facts,prices,lines:[disclosure[language],facts.business,facts.hours,...facts.services,...facts.faq.map(f=>f.question+' '+f.answer),...prices.map(p=>p.label+': '+p.display),handoff[language]]};return {...body,digest:digest(body)};
}
/** This bounded router can quote an approved item only. It cannot accept or produce a free-form answer or booking. */
export function receptionistAnswer(script:ReturnType<typeof receptionistScript>,request:unknown){
 const {digest:expected,...body}=script;check(expected===digest(body),'APPROVAL_STALE','The approved call script changed. Review it again.');const human={mode:'human' as const,text:handoff[script.language],booked:false as const};if(!request||typeof request!=='object'||Array.isArray(request))return human;const input=request as Record<string,unknown>;
 let text:string|undefined;if(Object.keys(input).length===1&&input.intent==='hours')text=script.facts.hours;
 else if(Object.keys(input).sort().join(',')==='id,intent'&&input.intent==='price'&&typeof input.id==='string'){const price=script.prices.find(p=>p.id===input.id);if(price)text=price.label+': '+price.display;}
 return text?{mode:'fact' as const,text,sourceDigest:script.factsDigest,booked:false as const}:human;
}
