// Original Chausar S6. instagram-agent-skill (MIT) supplies workflow ideas, no copied code.
import { requireSocial, socialDay, socialNumber, socialText } from './d2-core.ts';
import { projectPlan, SEQUENCE_STEPS } from '../../network/followups.ts';
export {REPLY_BUCKETS,replyBuckets,type ReplyBucket} from './reply-buckets.ts';
/** The delivered resource comes first, with one short question afterwards. No DM API is called. */
export function keywordDelivery(promise:string,question:string) { requireSocial(socialText(promise,2000)&&socialText(question,160)&&question.endsWith('?')&&(question.match(/\?/g)??[]).length===1);return {messages:[promise.trim(),question.trim()],capability:'handoff' as const}; }
/** Use W4 C7's actual sends and allowed weekdays; the second date is a projection until the first is recorded. */
export function warmFollowups(input:{sentOn:string;replied:boolean;optedOut:boolean;already:number;sentDates?:string[];weekdays?:number[]}) {
 requireSocial(socialDay(input.sentOn)&&typeof input.replied==='boolean'&&typeof input.optedOut==='boolean'&&socialNumber(input.already,2));if(input.replied||input.optedOut)return [];
 const dates=input.sentDates??[input.sentOn],weekdays=input.weekdays??[1,2,3,4,5,6,7];requireSocial(dates.length===input.already+1&&dates[0]===input.sentOn&&dates.every(socialDay)&&weekdays.length>0&&weekdays.every(day=>socialNumber(day,7)&&day>0));
 return projectPlan({stage:'asked',blocked:false,sequence:{kind:'message',steps:SEQUENCE_STEPS.message.map(afterDays=>({afterDays,channel:null})),weekdays,sendTime:'09:30',copiedAt:input.sentOn+'T09:30:00Z'},touches:dates.map(on=>({what:'sent' as const,on,channel:null,at:on+'T09:30:00Z',kind:null,ref:null,by:'owner'}))}).filter(row=>row.kind==='nudge').map(row=>row.kind==='nudge'?row.due:'');
}
export function carouselSize(){return {width:1080,height:1350};}
