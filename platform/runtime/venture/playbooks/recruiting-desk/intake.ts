// Original Chausar role intake; interview and separate private-note ideas from recruiting-copilot (MIT).
import {assertJobRelated,need,type Criterion} from './criteria.ts';
const QUESTIONS=[
 ['roleTitle','Which role does the client need?','Name the role and the work it must deliver.'],
 ['location','Where can this work be done?','State the workplace or remote scope; never use a home address as a proxy.'],
 ['payRange','What pay range has the client authorised you to share?','Client to confirm.'],
 ['hardRules','Which job requirements must every candidate meet?','Describe observable work skills, not a strong or young person.'],
 ['mustHaves','How will each required skill be verified?','Skill | A relevant work sample or explicit resume quote'],
 ['exclusions','Which professional evidence would contradict the requirements?','Use explicit job-related contradictions; missing evidence stays unknown.'],
 ['targetCompanies','Which companies are useful sourcing leads?','List client-approved companies, or leave the list empty.'],
 ['searchWords','Which search words describe the work?','Use the role title and the confirmed professional skills.'],
 ['privacyNoticeUrl','Where can the candidate read the privacy notice?','Use the client approved public privacy-notice address.'],
 ['retentionDays','How long should candidate records remain after this role closes?','90'],
] as const;
export const ROLE_QUESTION_IDS=QUESTIONS.map(q=>q[0]);
/** Exactly the first unanswered question, with a suggested answer for the owner to correct. */
export function roleQuestion(answers:Record<string,unknown>){const row=QUESTIONS.find(q=>!Object.hasOwn(answers,q[0]));return row?{id:row[0],question:row[1],suggestedAnswer:row[2]}:null;}
const LISTS=new Set(['hardRules','mustHaves','exclusions','targetCompanies','searchWords']);
function answer(id:string,value:unknown):string|string[]{
 if(LISTS.has(id)){need(Array.isArray(value)&&value.length<=20&&value.every(item=>typeof item==='string'&&item.trim().length>0&&item.length<=1000),'INVALID_VENTURE_REQUEST','Use a short list of written requirements.');need(!['hardRules','mustHaves'].includes(id)||value.length>0,'RECRUIT_INTAKE_INCOMPLETE','Give the role requirements and how to verify them.');const clean: string[]=value.map((s: string)=>s.trim());for(const text of clean)assertJobRelated(text);if(id==='mustHaves')need(clean.every(text=>text.split('|').length===2&&text.split('|').every(part=>part.trim())),'RECRUIT_VERIFICATION_REQUIRED','Give each required skill as Skill | How to verify.');return clean;}
 need(typeof value==='string'&&value.trim().length>0&&value.length<=1000,'INVALID_VENTURE_REQUEST','Write one answer to this role question.');const clean=value.trim();
 if(id==='retentionDays')need(/^\d{1,4}$/.test(clean)&&Number(clean)>=1&&Number(clean)<=3650,'INVALID_VENTURE_REQUEST','Choose retention from one day to ten years.');
 else if(id==='privacyNoticeUrl'){let url:URL|null=null;try{url=new URL(clean);}catch{}need(url?.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'INVALID_VENTURE_REQUEST','Use a public HTTPS privacy-notice address.');}
 else assertJobRelated(clean);
 return clean;
}
/** A stale question cannot overwrite a different field or silently skip the interview. */
export function answerRole(answers:Record<string,unknown>,questionId:string,value:unknown){need(roleQuestion(answers)?.id===questionId,'RECRUIT_QUESTION_CHANGED','Answer the current role question first.');return {...answers,[questionId]:answer(questionId,value)};}
/** All source words remain owner-supplied; the private sourcing strategy never enters the public description. */
export function roleBrief(raw:Record<string,unknown>,version:number){
 need(raw&&typeof raw==='object'&&!Array.isArray(raw)&&QUESTIONS.every(q=>Object.hasOwn(raw,q[0])),'RECRUIT_INTAKE_INCOMPLETE','Finish the role questions before approving its rules.');need(Object.keys(raw).every(id=>ROLE_QUESTION_IDS.includes(id as typeof ROLE_QUESTION_IDS[number])),'INVALID_VENTURE_REQUEST','Use only the role interview fields.');
 const a=Object.fromEntries(QUESTIONS.map(([id])=>[id,answer(id,raw[id])]));const text=(id:string)=>a[id] as string,list=(id:string)=>a[id] as string[];
 const criteria:Criterion[]=[...list('hardRules').map((text,n)=>({id:'rule-'+(n+1),text,required:true,verify:'An explicit professional resume quote'})),...list('mustHaves').map((row,n)=>({id:'skill-'+(n+1),text:row.split('|')[0]!.trim(),required:true,verify:row.split('|')[1]!.trim()}))];need(criteria.length<=20,'INVALID_VENTURE_REQUEST','Keep the combined criteria to twenty or fewer.');
 return {title:text('roleTitle'),location:text('location'),payRange:text('payRange'),criteria,exclusions:list('exclusions'),targetCompanies:list('targetCompanies'),privacyNoticeUrl:text('privacyNoticeUrl'),retentionDays:Number(text('retentionDays')),keywords:{version,words:list('searchWords')},publicDescription:[text('roleTitle'),text('location'),text('payRange'),'Requirements:',...criteria.map(c=>c.text)].join('\n'),privateSourcingNote:['Private sourcing note. Do not send.',...criteria.map(c=>c.text+' | '+c.verify),'Exclusions:',...list('exclusions'),'Target companies:',...list('targetCompanies'),'Search words:',...list('searchWords')].join('\n')};
}
