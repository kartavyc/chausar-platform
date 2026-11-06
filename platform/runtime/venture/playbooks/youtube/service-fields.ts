// Original browser-safe service identity and owner intake validation.
import {check} from '../../../portable.ts';
import {YOUTUBE_OFFERS2,type YoutubeServiceId} from './offers2.ts';
import {ownerHoursMinutes} from './research-source.ts';
export const isYoutubeService=(value:unknown):value is YoutubeServiceId=>typeof value==='string'&&YOUTUBE_OFFERS2.some(offer=>offer.id===value);
export function youtubeServiceIntake(service:string){return [
 {id:'channelUrl',kind:'text' as const,label:'Channel address',help:'Your client channel. Public reads still ask before each request.',required:true},
 {id:'hoursPerWeek',kind:'text' as const,label:'Hours available each week',help:'The weekly plan must fit this owner allowance. Use decimal hours.',required:service==='weekly-plan'},
 {id:'targetQueries',kind:'list' as const,label:'Three target searches',help:'Write the exact searches the title and opening description must answer.',required:service==='packaging-per-video'},
 {id:'scripted',kind:'yes-no' as const,label:'Scripted recording',help:'A scripted recording needs the approved script checked against the recorded speech.',required:service==='screencast-tutorial'},
 ];}
export function validateYoutubeServiceIntake(fields:Record<string,unknown>|undefined,service:string){
 check(fields&&typeof fields.channelUrl==='string','YOUTUBE_SERVICE_INVALID','Complete the channel service intake.');
 let url:URL;try{url=new URL(String(fields.channelUrl));}catch{check(false,'YOUTUBE_SERVICE_INVALID','Use the client YouTube channel address.');}
 check(url!.protocol==='https:'&&['www.youtube.com','youtube.com'].includes(url!.hostname)&&!url!.username&&!url!.password&&!url!.port&&/^\/(?:@[A-Za-z0-9_.-]+|channel\/UC[A-Za-z0-9_-]{22})\/?$/.test(url!.pathname)&&!url!.search&&!url!.hash,'YOUTUBE_SERVICE_INVALID','Use the exact HTTPS channel address, without a query or sign-in information.');
 if(service==='weekly-plan'||fields.hoursPerWeek!==undefined)ownerHoursMinutes(fields.hoursPerWeek);
 if(service==='packaging-per-video'||fields.targetQueries!==undefined)check(Array.isArray(fields.targetQueries)&&fields.targetQueries.length===3&&fields.targetQueries.every(value=>typeof value==='string'&&value.trim())&&new Set(fields.targetQueries.map(value=>(value as string).trim().toLowerCase())).size===3,'YOUTUBE_SERVICE_INVALID','Record three distinct target searches.');
 if(service==='screencast-tutorial'||fields.scripted!==undefined)check(typeof fields.scripted==='boolean','YOUTUBE_SERVICE_INVALID','Record whether the recording is scripted.');
}
