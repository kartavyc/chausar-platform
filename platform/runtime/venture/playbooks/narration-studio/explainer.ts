// Original quoted-span storyboard after reels-af workflow ideas. No third-party implementation copied.
import {check,hash} from '../../../portable.ts';
export type ExplainerQuote={start:number;end:number;text:string};
/** Every spoken line is a contiguous quotation in reading order from the rights-cleared fetched source. */
export function explainerQuotes(source:string,lines:readonly ExplainerQuote[]){
 const code='EXPLAINER_QUOTE_REQUIRED',line='Use exact, non-overlapping quoted spans from the source.';
 check(typeof source==='string'&&source.trim()&&source.length<=500000&&Array.isArray(lines)&&lines.length>0&&lines.length<=100,code,line);let prior=0;
 for(const q of lines){check(q&&Number.isSafeInteger(q.start)&&Number.isSafeInteger(q.end)&&q.start>=prior&&q.end>q.start&&q.end<=source.length&&typeof q.text==='string'&&q.text.trim()&&q.text===source.slice(q.start,q.end)&&q.text.length<=5000,code,line);prior=q.end;}
 return {sourceDigest:hash(source),lines:lines.map(q=>({...q})),disclosure:'AI narration' as const};
}
