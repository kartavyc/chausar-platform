// Original Chausar S6 reply classification, instagram-agent-skill MIT ideas only. Browser-safe.
import {requireSocial,socialText} from './d2-core.ts';
export const REPLY_BUCKETS = ['complaint','lead','question','request','praise','noise'] as const;
export type ReplyBucket = typeof REPLY_BUCKETS[number];
/** Counts precede any generated reply. Ambiguous messages remain questions for owner review. */
export function replyBuckets(rows: {id:string;text:string}[]) {
 requireSocial(Array.isArray(rows)&&rows.length<=500&&new Set(rows.map(row=>row?.id)).size===rows.length);
 const counts = Object.fromEntries(REPLY_BUCKETS.map(bucket=>[bucket,0])) as Record<ReplyBucket,number>;
 const sorted=rows.map(row=>{requireSocial(socialText(row.id,120)&&socialText(row.text));const text=row.text.toLowerCase();
 const bucket:ReplyBucket=/follow.?for.?follow|buy followers|crypto giveaway|फॉलो.*फॉलो/u.test(text)?'noise':/broken|refund|complaint|wrong order|खराब|शिकायत|वापस/u.test(text)?'complaint':/buy|price|book|order please|खरीद|कीमत|बुक/u.test(text)?'lead':/send|menu|link|भेज|मेन्यू|लिंक/u.test(text)?'request':/love|thank|great|धन्यवाद|अच्छा/u.test(text)?'praise':'question';counts[bucket]++;return {...row,bucket,priority:REPLY_BUCKETS.indexOf(bucket)};}).sort((a,b)=>a.priority-b.priority);
 return {counts,drafts:sorted.filter(row=>row.bucket!=='noise'),skipped:sorted.filter(row=>row.bucket==='noise')};
}
