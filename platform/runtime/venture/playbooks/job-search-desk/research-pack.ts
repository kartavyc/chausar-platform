// Original source-bound reports. Ratings are owner assessments, never independently verified client facts.
import {check} from '../../../portable.ts';
import type {CareerFact} from './facts.ts';
import type {CareerSource} from './pack.ts';
import {careerShortlist,type CareerMatch,type CareerVerdict} from './shortlist.ts';
import {careerCoaching,type CareerCoachingInput} from './coaching.ts';
import {beforeCareerSend} from './before-send.ts';
export type CareerResearchPackInput={kind:'weekly-shortlist';matches:CareerMatch[];threshold:CareerVerdict}|{kind:'career-coaching';input:CareerCoachingInput;outreach:{text:string;clientConfirmed:boolean;voiceConfirmed:boolean}|null};
export function careerResearchPack(facts:readonly CareerFact[],listings:readonly CareerSource[],input:CareerResearchPackInput,total:number){
 check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_VENTURE_REQUEST','Choose a career research report.');
 if(input.kind==='weekly-shortlist'){
  check(Object.keys(input).sort().join(',')==='kind,matches,threshold'&&Array.isArray(input.matches)&&input.matches.every(r=>r&&listings.some(l=>l.id===r.id)),'CAREER_NOT_FOUND','Rate only saved listings from this order.');
  const result=careerShortlist(total,input.matches,input.threshold),section=(label:string,rows:CareerMatch[])=>[label,...rows.flatMap(row=>[row.verdict+' | '+row.reason,listings.find(l=>l.id===row.id)!.url])];
  return {text:[result.coverage,'Owner assessments. Review fit with the client.',...section('Kept',result.kept),...section('Dropped',result.dropped),'The client sends and applies.'].join('\n'),ready:true};
 }
 check(input.kind==='career-coaching'&&Object.keys(input).sort().join(',')==='input,kind,outreach','INVALID_VENTURE_REQUEST','Use the exact coaching report fields.');
 check(input.input?.research&&listings.some(l=>l.url===input.input.research!.url&&l.text.includes(input.input.research!.text)),'CAREER_SOURCE_CHANGED','Choose an exact researched quote from a saved listing.');
 const result=careerCoaching(facts,input.input),outreach=input.outreach;
 check(outreach===null||outreach&&Object.keys(outreach).sort().join(',')==='clientConfirmed,text,voiceConfirmed'&&typeof outreach.clientConfirmed==='boolean'&&typeof outreach.voiceConfirmed==='boolean','INVALID_VENTURE_REQUEST','Record the exact outreach and both reviews.');
 const text=outreach?.text??result.outreach,send=beforeCareerSend({text,clientFact:result.clientFact,researchedFact:result.researchedFact,clientConfirmed:outreach?.clientConfirmed??false,voiceConfirmed:outreach?.voiceConfirmed??false});
 return {text:[result.positioning,'Target assessments',...result.targets.flatMap(target=>[target.name,target.score.total+' of '+target.score.max,...target.score.criteria.map(c=>c.id+': '+c.score+' | '+c.evidence)]),'Outreach draft',text,'Source: '+result.researchedFact!.url,'Voice review: '+send.verdict,'Call plan',...result.callPlan,'Paid pilot',...result.pilot.lines,'The price is in the separately approved pilot proposal.','The client sends and applies.'].join('\n'),ready:send.verdict==='PASS'};
}
