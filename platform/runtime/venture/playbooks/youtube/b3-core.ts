// Original Chausar 5B3 source grammar. No outside implementation copied.
import {check} from '../../../portable.ts';
export {check};
export const RESEARCH_INVALID='YOUTUBE_RESEARCH_INVALID';
/** Only exact nonnegative decimal counts enter arithmetic; missing remains missing. */
export function researchCount(value:unknown):bigint|null {if(value===null)return null;check(typeof value==='string'&&/^(0|[1-9]\d{0,24})$/.test(value),RESEARCH_INVALID,'Use exact whole counts, or mark missing data.');return BigInt(value);}
export function researchText(value:unknown,max=200):string {check(typeof value==='string'&&value.trim().length>0&&value.length<=max,RESEARCH_INVALID,'Use a short non-empty source value.');return value.trim();}
export function researchDay(value:unknown):number {check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),RESEARCH_INVALID,'Use a real date in YYYY-MM-DD form.');const time=Date.parse(value+'T00:00:00Z');check(Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value,RESEARCH_INVALID,'Use a real calendar date.');return time/86400000;}
/** Twice the median retains halves exactly without floating-point arithmetic. */
export function twiceMedian(values:readonly bigint[]):bigint|null {if(!values.length)return null;const sorted=[...values].sort((a,b)=>a<b?-1:a>b?1:0),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]!*2n:sorted[middle-1]!+sorted[middle]!;}
export function halfDecimal(twice:bigint|null):string|null {return twice===null?null:String(twice/2n)+(twice%2n?'.5':'');}
export const researchWords=(text:string):string[]=>text.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu)??[];
export type ResearchVideo={id:string;channelId:string;views:string|null;publishedOn:string|null};
export function researchVideos(input:readonly ResearchVideo[]):ResearchVideo[]{check(Array.isArray(input)&&input.length>0&&input.length<=500,RESEARCH_INVALID,'Use one to five hundred source videos.');const seen=new Set<string>();return input.map(row=>{check(row&&typeof row==='object',RESEARCH_INVALID,'Use source video rows.');const id=researchText(row.id),channelId=researchText(row.channelId);check(!seen.has(id),RESEARCH_INVALID,'Each source video must appear once.');seen.add(id);researchCount(row.views);if(row.publishedOn!==null)researchDay(row.publishedOn);return {id,channelId,views:row.views,publishedOn:row.publishedOn};});}
