// Original demo planning and disclosure, informed by eve (Apache-2.0) workflow. No copied implementation.
import {check,digest} from '../../../portable.ts';
import {validateCues,type CaptionCue} from '../kit/captions.ts';
export type DemoPlan={title:string;script:string;shots:{id:string;action:string;seconds:number}[];clientTestAccount:true;aiVoice:boolean;description:string;digest:string};
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{check(!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'INVALID_VENTURE_REQUEST','Use only the named demo plan fields.');}
function text(value:unknown,max:number):asserts value is string{check(typeof value==='string'&&value.trim().length>0&&value.length<=max,'INVALID_VENTURE_REQUEST','Use bounded plain words for the demo.');}
/** The approved artifact is a complete shot list and description, never a grant to record the owner desktop. */
export function demoPlan(input:unknown):DemoPlan{
 exact(input,['title','script','shots','clientTestAccount','aiVoice','description']);text(input.title,200);text(input.script,12000);text(input.description,4000);check(input.clientTestAccount===true,'TEST_ACCOUNT_REQUIRED','Use a test account the client made, with fictional data.');check(typeof input.aiVoice==='boolean','INVALID_VENTURE_REQUEST','Say whether the demo uses an AI voice.');check(!input.aiVoice||input.description.split(/\r?\n/).some(line=>['This video uses an AI voice.','इस वीडियो में एआई आवाज़ का उपयोग हुआ है।'].includes(line.trim())),'AI_DISCLOSURE_REQUIRED','The video description must say it uses an AI voice.');
 check(Array.isArray(input.shots)&&input.shots.length>0&&input.shots.length<=30,'INVALID_VENTURE_REQUEST','Plan one to thirty short shots.');let total=0;const ids=new Set<string>();const shots=input.shots.map(row=>{exact(row,['id','action','seconds']);text(row.id,60);text(row.action,1000);check(/^[a-z][a-z0-9-]*$/.test(row.id)&&!ids.has(row.id)&&Number.isInteger(row.seconds)&&Number(row.seconds)>=1&&Number(row.seconds)<=60,'INVALID_VENTURE_REQUEST','Give each shot its own name and one to sixty seconds.');ids.add(row.id);total+=Number(row.seconds);return {id:row.id,action:row.action,seconds:Number(row.seconds)};});check(total<=300,'INVALID_VENTURE_REQUEST','Keep each demo within five minutes.');
 const value={title:input.title,script:input.script,shots,clientTestAccount:true as const,aiVoice:input.aiVoice,description:input.description};return {...value,digest:digest(value)};
}
/** Return actual 5A4 findings; a planned caption is never a passed caption. */
export function checkDemoCaptions(cues:readonly CaptionCue[]){return validateCues(cues,'web');}
