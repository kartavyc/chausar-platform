// Original Chausar parser inspired by LocalText2Voice's MIT markup documentation. No source code copied.
import {check,digest} from '../../../portable.ts';
export type NarrationVoice={id:string;language:string;licence:string};
export type NarrationMarkupOptions={voices:readonly NarrationVoice[];voice:string;language:string;requestRevision:string;providerModelRevision:string|null;maxBytes:number};
export type NarrationTextSegment={id:string;text:string;voice:string;language:string;pauseAfterMs:number;requestRevision:string;providerModelRevision:string|null;timing:'unconfirmed'};
const valid=(ok:unknown)=>check(!!ok,'NARRATION_MARKUP_INVALID','Use known licensed voices, matching languages and pauses from 0 to 7000 milliseconds.');
/** Strict, bounded markup. Request revision is stored separately from an unavailable provider model revision. */
export function parseNarrationMarkup(source:string,options:NarrationMarkupOptions):NarrationTextSegment[]{
 valid(typeof source==='string'&&source.length>0&&source.length<=500000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source));
 valid(Number.isSafeInteger(options.maxBytes)&&options.maxBytes>=16&&options.maxBytes<=5000&&options.requestRevision.trim());
 let voice=options.voice,language=options.language;const rows:NarrationTextSegment[]=[];
 const voiceCheck=()=>{const item=options.voices.find(v=>v.id===voice);valid(item&&item.language===language);check(!!item?.licence.trim(),'CONSENT_REQUIRED','Choose a licensed stock voice. Voice cloning is not available.');};
 voiceCheck();
 const append=(raw:string)=>{const words=raw.trim().split(/\s+/u).filter(Boolean);if(!words.length)return;voiceCheck();let text='';
  const flush=()=>{if(text)rows.push({id:digest({index:rows.length,text,voice,language,requestRevision:options.requestRevision,providerModelRevision:options.providerModelRevision}),text,voice,language,pauseAfterMs:0,requestRevision:options.requestRevision,providerModelRevision:options.providerModelRevision,timing:'unconfirmed'});text='';};
  for(const word of words){valid(new TextEncoder().encode(word).length<=options.maxBytes);const next=text?`${text} ${word}`:word;if(new TextEncoder().encode(next).length>options.maxBytes)flush();text=text?`${text} ${word}`:word;}flush();valid(rows.length<=10000);
 };
 let at=0;const re=/\{\{([^{}]*)\}\}/gu;for(const match of source.matchAll(re)){const before=source.slice(at,match.index);valid(!before.includes('{{')&&!before.includes('}}'));append(before);const directive=match[1]!.trim();let token:RegExpExecArray|null;
  if((token=/^voice\s+"([^"\r\n]+)"$/u.exec(directive))){valid(options.voices.some(v=>v.id===token![1]));voice=token[1]!;}
  else if((token=/^lang\s+([A-Za-z]{2,3}-[A-Za-z]{2})$/u.exec(directive))){valid(options.voices.some(v=>v.language===token![1]));language=token[1]!;}
  else if((token=/^pause\s+(\d{1,4})$/u.exec(directive))){valid(rows.length&&Number(token[1])<=7000);rows[rows.length-1]!.pauseAfterMs=Number(token[1]);}
  else if(directive==='reset'){voice=options.voice;language=options.language;}
  else valid(false);at=match.index+match[0].length;
 }
 const tail=source.slice(at);valid(!tail.includes('{{')&&!tail.includes('}}'));append(tail);valid(rows.length>0);return rows;
}
