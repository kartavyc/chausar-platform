// Original code-owned career packs. Model selections can choose evidence but cannot rewrite a client's experience.
import {check,digest} from '../../../portable.ts';
import {renderClaims,careerNeed,type CareerFact,type CareerClaim} from './facts.ts';
export type CareerPackKind='resume'|'cover-letter'|'interview-prep'|'title-audit';
export type CareerSource={id:string;url:string;text:string;revision:string};
export type CareerPackInput={kind:CareerPackKind;claims:CareerClaim[];sources:{listingId:string;quote:string}[]};
const names:Record<CareerPackKind,string>={'resume':'Resume','cover-letter':'Cover letter','interview-prep':'Interview preparation','title-audit':'Job title audit'};
export const careerPackBinding=(text:string,factsDigest:string)=>digest({text,factsDigest});
export function careerPackDeliverable(text:string){return {title:'Career pack',sections:[{heading:'Approved evidence',parts:[{kind:'text' as const,text}]}],questionsForClient:[]};}
export function careerPack(facts:readonly CareerFact[],listings:readonly CareerSource[],input:CareerPackInput){
 careerNeed(input&&typeof input==='object'&&Object.keys(input).sort().join(',')==='claims,kind,sources'&&typeof input.kind==='string'&&Object.hasOwn(names,input.kind),'Use a supported career pack and exact evidence selections.');
 const claims=renderClaims(facts,input.claims);check(claims.ok,claims.ok?'CAREER_UNSTATED_FACT':claims.code==='claim-boundary'?'CAREER_CLAIM_BOUNDARY':'CAREER_UNSTATED_FACT',claims.ok?'Choose approved facts.':`Review fact ${claims.factId}.`);
 careerNeed(claims.lines.length>0&&Array.isArray(input.sources)&&input.sources.length<=30,'Choose at least one approved fact and bounded role evidence.');
 const sources=input.sources.map(p=>{careerNeed(p&&Object.keys(p).sort().join(',')==='listingId,quote'&&typeof p.listingId==='string'&&typeof p.quote==='string'&&p.quote.trim().length>0&&p.quote.length<=4000,'Choose an exact listing quote.');const source=listings.find(s=>s.id===p.listingId);check(source&&source.text.includes(p.quote),'CAREER_SOURCE_CHANGED','The selected quote is absent from the current job source.');return{listingId:source.id,revision:source.revision,url:source.url,quote:p.quote};});
 const lines=[names[input.kind],'Confirmed client facts',...claims.lines];
 if(sources.length)lines.push('Role evidence',...sources.flatMap(s=>['"'+s.quote+'"',s.url]));
 if(input.kind==='cover-letter')lines.push('I would welcome a conversation about how these experiences relate to the role.');
 if(input.kind==='interview-prep')lines.push('Practice questions','Which example best supports the role requirement?','What did you do yourself, and what did others do?','What limits or qualifiers should the interviewer know?');
 if(input.kind==='title-audit')lines.push('Review the named role against these facts. Confirm the title with the client. No hiring or salary prediction is made.');
 lines.push('The client reviews, sends and applies. No application has been submitted by Chausar.');
 return {text:lines.join('\n'),kind:input.kind,claims:input.claims.map(c=>({...c})),sources};
}
