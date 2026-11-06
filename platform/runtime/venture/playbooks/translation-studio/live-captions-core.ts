// Original bounded local caption reducer. Mimi and hayamimi (MIT) informed tier and identity rules; no code copied.
import {check} from '../../../portable.ts';
export type CaptionLine={id:string;sequence:number;tier:'draft'|'final'|'refined';speaker:string;text:string};
export type CaptionSession={id:string;orderId:string;saving:boolean;sequence:number;inProgress:CaptionLine|null;confirmed:CaptionLine[];saved:CaptionLine[]};
/** Capture permission never implies permission to save. */
export function newCaptionSession(id:string,orderId:string,hostPermission:boolean):CaptionSession{check(hostPermission===true,'CAPTION_PERMISSION_REQUIRED','Record the event host permission before capturing audio.');return {id,orderId,saving:false,sequence:0,inProgress:null,confirmed:[],saved:[]};}
/** Consume one local recognizer event; confirmed identity and speaker survive later refinement. */
export function captionEvent(session:CaptionSession,event:CaptionLine):CaptionSession{
 check(Number.isSafeInteger(event.sequence)&&event.sequence>session.sequence&&typeof event.id==='string'&&event.id.length>0&&event.id.length<=100&&typeof event.text==='string'&&event.text.length<=10000&&typeof event.speaker==='string'&&event.speaker.length>0&&event.speaker.length<=100&&['draft','final','refined'].includes(event.tier),'CAPTION_EVENT_STALE','Use the next bounded local caption event.');
 const next=structuredClone(session),old=next.confirmed.find(l=>l.id===event.id);if(old)check(old.speaker===event.speaker,'VOICE_MISMATCH','A refinement cannot change the recorded speaker.');
 if(event.tier==='draft'){check(!old,'CAPTION_EVENT_STALE','A confirmed line cannot return to draft.');next.inProgress={...event};}
 else if(event.tier==='refined'){check(old,'CAPTION_EVENT_STALE','Only a confirmed line can be refined.');Object.assign(old,event);const saved=next.saved.find(l=>l.id===event.id);if(saved&&next.saving)Object.assign(saved,event);}
 else {check(!old,'CAPTION_EVENT_STALE','This line is already confirmed.');next.confirmed.push({...event});if(next.saving){check(next.saved.length<1000,'CAPTION_SAVE_FULL','Save or clear these captions before recording more.');next.saved.push({...event});}if(next.inProgress?.id===event.id)next.inProgress=null;}
 next.sequence=event.sequence;next.confirmed=next.confirmed.slice(-200);return next;
}
/** Turning saving off preserves existing records and never saves earlier unsaved speech retroactively. */
export function captionSaving(session:CaptionSession,on:boolean):CaptionSession{check(typeof on==='boolean','INVALID_VENTURE_REQUEST','Choose whether future captions should be saved.');return {...structuredClone(session),saving:on};}
/** A local download includes only explicitly saved confirmed lines. */
export const captionExport=(session:CaptionSession)=>session.saved.length?session.saved.map(l=>`${l.speaker}: ${l.text}`).join('\n'):null;
