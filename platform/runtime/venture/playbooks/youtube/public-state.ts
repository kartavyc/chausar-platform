// Original public-read approval and local quota state. Google remains authoritative for project-wide quota.
import {check,digest,type Json} from '../../../portable.ts';
import {researchExact} from './research-state.ts';
export type YoutubePublicRequest={kind:'videos'|'channels';ids:string[]}|{kind:'search';query:string;pageToken?:string};
export type YoutubeQuotaUse={project:string;day:string;shared:number;search:number};
export type YoutubePublicRead={id:string;project:string;connection:string;request:YoutubePublicRequest;orderDigest:string;state:'prepared'|'running'|'completed'|'failed';preparedAt:string;attemptedAt:string|null;result:Json|null;error:string|null;receiptId:string|null;uploadId:string|null;uploadDigest:string|null};
export const YOUTUBE_QUOTA_LIMITS={shared:10000,search:100} as const;
export function youtubePublicRequest(raw:unknown):YoutubePublicRequest{
 const first=researchExact(raw,['kind','ids','query','pageToken'],['kind']);
 check(typeof first.kind==='string'&&['videos','channels','search'].includes(first.kind),'YOUTUBE_RESEARCH_INVALID','Choose public videos, channels or one search page.');
 if(first.kind==='search'){const p=researchExact(raw,['kind','query','pageToken'],['kind','query']);check(typeof p.query==='string'&&p.query.trim().length>0&&p.query.length<=200,'YOUTUBE_RESEARCH_INVALID','Use a search of up to two hundred characters.');check(p.pageToken===undefined||typeof p.pageToken==='string'&&/^[A-Za-z0-9_=-]{1,500}$/.test(p.pageToken),'YOUTUBE_RESEARCH_INVALID','Use the exact next-page token from this search.');return {kind:'search',query:p.query.trim(),...(p.pageToken===undefined?{}:{pageToken:p.pageToken as string})};}
 const p=researchExact(raw,['kind','ids']);check(Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=50&&new Set(p.ids).size===p.ids.length&&p.ids.every(id=>typeof id==='string'&&(p.kind==='videos'?/^[A-Za-z0-9_-]{11}$/:/^UC[A-Za-z0-9_-]{22}$/).test(id)),'YOUTUBE_RESEARCH_INVALID','Choose one to fifty distinct public YouTube IDs.');return {kind:p.kind as 'videos'|'channels',ids:[...p.ids] as string[]};
}
export function youtubeQuotaDay(now:string){check(typeof now==='string'&&Number.isFinite(Date.parse(now)),'YOUTUBE_RESEARCH_INVALID','Use the current engine clock.');const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));const value=(key:string)=>parts.find(part=>part.type===key)!.value;return value('year')+'-'+value('month')+'-'+value('day');}
export function reserveYoutubeQuota(history:readonly YoutubeQuotaUse[],project:string,day:string,bucket:'shared'|'search'){
 check(typeof project==='string'&&/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&['shared','search'].includes(bucket),'YOUTUBE_RESEARCH_INVALID','Use the owner Google project ID and current quota day.');
 check(Array.isArray(history)&&history.length<10000&&history.every(row=>Number.isSafeInteger(row.shared)&&row.shared>=0&&Number.isSafeInteger(row.search)&&row.search>=0)&&new Set(history.map(row=>row.project+'|'+row.day)).size===history.length,'YOUTUBE_RESEARCH_INVALID','The local quota history needs owner review.');
 const next=history.map(row=>({...row}));let row=next.find(row=>row.project===project&&row.day===day);if(!row){row={project,day,shared:0,search:0};next.push(row);}check(row[bucket]<YOUTUBE_QUOTA_LIMITS[bucket],'QUOTA_REACHED','YouTube local '+bucket+' budget reached. Check your Google project; daily quotas reset at midnight Pacific Time.');row[bucket]++;return next;
}
export function youtubePublicView(row:YoutubePublicRead){return {...structuredClone(row),digest:digest(row),quotaNote:'Attempts tracked in this workspace only. Google also counts other apps and workspaces. This is not guaranteed remaining Google quota.'};}
