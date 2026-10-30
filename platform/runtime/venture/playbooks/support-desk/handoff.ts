// Support human takeover: nexusdesk (Apache-2.0), agentbehavior (Apache-2.0); original code, no copied text.
import { check } from '../../../contracts.ts';
import type { SupportDraft, SupportMessageBody, SupportTicketBody } from './records.ts';
export type SupportRun = { id: string; state: 'queued'|'running'|'done'|'cancelled'; stopRequested?: boolean };
/** Recognizes direct requests for a human in English and Hindi, without using tone as severity. */
export function needsPerson(text:string):boolean { return /\b(?:human|person|real agent|manager)\b|(?:इंसान|व्यक्ति|किसी से बात|मैनेजर|मानव)/i.test(text); }
/** Pauses auto drafts and records takeover; queued work cancels and running work gets a stop request. */
export function humanHandoff<T extends SupportTicketBody>(ticket:T,runs:readonly SupportRun[],now:string):{ticket:T;runs:SupportRun[];summary:{subject:string;messages:SupportMessageBody[];openQuestions:string[]}} {
  const messages=ticket.messages.filter(m=>m.messageKind!=='system').slice(-10);
  return {ticket:{...ticket,autoDraftsPaused:true,revision:ticket.revision+1,messages:[...ticket.messages,{ticketId:'',messageId:null,sender:'Chausar',text:'A person will handle this ticket. Automatic drafts are paused.',at:now,messageKind:'system',references:[],untrusted:false}]},runs:runs.map(r=>r.state==='queued'?{...r,state:'cancelled'}:r.state==='running'?{...r,stopRequested:true}:{...r}),summary:{subject:ticket.subject,messages,openQuestions:['What should the owner do next?']}};
}
/** Keeps the untranslated draft beside the customer-language draft, with sources; neither is approved. */
export function replyPair(original:string,translated:string,language:string,sources:readonly string[],policyChange=false):SupportDraft {
  check(typeof original==='string'&&original.trim().length>0&&original.length<=12000&&typeof translated==='string'&&translated.trim().length>0&&translated.length<=12000, 'SUPPORT_REPLY_INVALID','Keep both the original and customer-language draft.');
  check(/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)&&sources.length>0&&sources.length<=20&&sources.every(s=>typeof s==='string'&&s.trim().length>0&&s.length<=200),'SUPPORT_SOURCE_REQUIRED','A reply needs its customer language and source names.');
  return {original,translated,language,sources:[...sources],approved:false,policyChange};
}
/** Severity follows the impact and available evidence, never the customer's tone. */
export function triageSupport(input:{impact:string;evidence:readonly string[];tone?:string}):{priority:'urgent'|'normal'|'needs-facts';summary:string;openQuestions:string[]} {
  if(!input.evidence.length)return {priority:'needs-facts',summary:'The owner needs evidence before deciding.',openQuestions:['Which shop record supports the request?']};
  return {priority:['safety','delivery-blocked','service-down'].includes(input.impact)?'urgent':'normal',summary:`Impact: ${input.impact}. Evidence: ${input.evidence.join(', ')}.`,openQuestions:[]};
}
