// SEO5 measurement and finding lifecycle. seo-agent MIT ideas; independent code.
import {seoNeed} from './content-core.ts';
export type SearchMetrics={clicks:number;impressions:number;position:number};
export function seoDay(value:string):number {seoNeed(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'SEO_DATE_INVALID','Give a real calendar date.');return Date.parse(value);}
/** Windows are read after a three-day settle, with missing data kept explicit. */
export function measureImpact(input:{appliedAt:string;asOf:string;windowDays:14|28;before:SearchMetrics;after:SearchMetrics}) {
 seoNeed(input.windowDays===14||input.windowDays===28,'SEO_INPUT_INVALID','Choose the fourteen or twenty-eight day window.');for(const row of [input.before,input.after])seoNeed(row&&Number.isSafeInteger(row.clicks)&&Number.isSafeInteger(row.impressions)&&row.clicks>=0&&row.impressions>=row.clicks&&Number.isFinite(row.position)&&row.position>=0,'SEO_INPUT_INVALID','Use non-negative measured Search Console counts.');
 const applied=seoDay(input.appliedAt),asOf=seoDay(input.asOf),readyAt=new Date(applied+(input.windowDays+3)*86400000).toISOString().slice(0,10);
 let verdict:'waiting'|'insufficient-data'|'helped'|'hurt'|'neutral'='neutral';
 if(asOf<Date.parse(readyAt))verdict='waiting';else if(input.before.impressions<50||input.after.impressions<50)verdict='insufficient-data';else {const b=input.before,a=input.after,ctrBefore=b.clicks/b.impressions,ctrAfter=a.clicks/a.impressions;const gain=(ctrBefore>0&&ctrAfter>=ctrBefore*1.15)||(b.position-a.position>=1);const loss=(ctrBefore>0&&ctrAfter<=ctrBefore*.85)||(a.position-b.position>=1);if(gain&&!loss&&a.impressions>=b.impressions*.8)verdict='helped';else if(loss&&!gain&&a.impressions<=b.impressions*1.2)verdict='hurt';}
 return {verdict,readyAt,before:input.before,after:input.after,windowDays:input.windowDays,settleDays:3,line:verdict==='hurt'?'Inspect the change. This is a prompt to look, not proof of harm.':verdict==='waiting'?'Wait for the complete window after the settling period.':verdict==='insufficient-data'?'Insufficient data: each window needs at least fifty impressions.':'Observed change under our rubric. This does not prove causation.'};
}
/** Dismissal mutes the current episode only; a fixed issue that returns is open again. */
export function findingState(prior:'open'|'muted'|'resolved',present:boolean){return !present?'resolved':prior==='muted'?'muted':'open';}
