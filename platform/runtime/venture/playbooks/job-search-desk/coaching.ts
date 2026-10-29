// Original coaching composition from approved evidence; seven-criterion and paid-pilot ideas from paulklayvc/skills (MIT).
import {check} from '../../../portable.ts';
import {careerNeed,renderClaims,type CareerFact,type CareerClaim} from './facts.ts';
import {beforeCareerSend,scoreCareerTarget} from './before-send.ts';
import {pilotOf,type PilotTerms} from '../kit/pilot.ts';
import {CAREER_PILOT} from './metadata-core.ts';
export type CareerCoachingInput={claims:CareerClaim[];targets:{name:string;criteria:Parameters<typeof scoreCareerTarget>[0]}[];research:{text:string;url:string}|null;clientFactId:string;pilot:PilotTerms};
export function careerCoaching(facts:readonly CareerFact[],input:CareerCoachingInput){
 careerNeed(input&&Object.keys(input).sort().join(',')==='claims,clientFactId,pilot,research,targets','Use the exact coaching evidence fields.');
 const claims=renderClaims(facts,input.claims);check(claims.ok,'CAREER_CLAIM_BOUNDARY','Use approved facts within every boundary.');
 careerNeed(claims.lines.length>0&&Array.isArray(input.targets)&&input.targets.length<=50,'Choose approved facts and at most fifty target teams.');
 const targets=input.targets.map(target=>{careerNeed(target&&Object.keys(target).sort().join(',')==='criteria,name'&&typeof target.name==='string'&&!!target.name.trim()&&target.name.length<=200,'Name each target without inventing a result.');return{name:target.name,score:scoreCareerTarget(target.criteria)};});
 const selected=facts.find(f=>f.id===input.clientFactId);check(selected,'CAREER_UNSTATED_FACT','Choose an approved client fact for outreach.');
 const rendered=renderClaims(facts,[{factId:selected.id,use:'career outreach'}]);check(rendered.ok,'CAREER_CLAIM_BOUNDARY','This fact is not approved for career outreach.');
 const client={factId:selected.id,text:rendered.lines[0]!};
 careerNeed(input.research===null||typeof input.research.text==='string'&&input.research.text.length>0&&input.research.text.length<=4000&&typeof input.research.url==='string','Quote one bounded researched fact.');
 const outreach=[input.research?.text??'[RESEARCH FACT]',client.text,'[YOUR TAKE]','Would a short conversation help?'].join('\n');
 const positioning=['Positioning evidence',...claims.lines,'What to stop claiming',...facts.flatMap(f=>f.forbiddenUses.map(use=>f.id+': '+use)),'Keep every qualifier when describing this experience.'].join('\n');
 const pilot=pilotOf({offers:[CAREER_PILOT]},CAREER_PILOT.id,input.pilot);
 return {positioning,targets,outreach,clientFact:client,researchedFact:input.research,send:beforeCareerSend({text:outreach,clientFact:client,researchedFact:input.research,clientConfirmed:false,voiceConfirmed:false}),callPlan:['Confirm the target team problem and its source.','Describe one approved client example with its limits.','Ask what evidence the team needs next.','Discuss the paid pilot and agree a measure before starting.'],pilot};
}
