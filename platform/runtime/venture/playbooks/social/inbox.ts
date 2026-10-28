// Original Chausar S7 inbox. postmill AGPL UI ideas only; no source copied.
import { requireSocial, socialText } from './d2-core.ts';
import { replyBuckets, type ReplyBucket } from './reply-buckets.ts';
export type InboxItem = {orderId:string;channel:string;externalId:string;author:string;text:string;source:'paste'|'export';syncedAt:string;bucket:ReplyBucket;priority:number;state:'needs-reply'|'handled'|'ignored';assignee:string|null;reply:string;ownerApproved:boolean;clientApproved:boolean;optedOut:boolean};
export type InboxView=InboxItem&{id:string;digest:string};
/** Owner imports are the only inbox source while comment APIs await review. */
export function importInbox(input:{orderId:string;channel:string;source:'paste'|'export';importedAt:string;items:{id:string;author:string;text:string}[]}):InboxItem[]{
 requireSocial(socialText(input.orderId,120)&&socialText(input.channel,50)&&['paste','export'].includes(input.source)&&/^\d{4}-\d{2}-\d{2}T/.test(input.importedAt)&&!Number.isNaN(Date.parse(input.importedAt))&&Array.isArray(input.items));
 input.items.forEach(row=>requireSocial(socialText(row.author,200)));const sorted=replyBuckets(input.items);
 return [...sorted.drafts,...sorted.skipped].map(row=>({orderId:input.orderId,channel:input.channel,externalId:row.id,author:input.items.find(item=>item.id===row.id)!.author,text:row.text,source:input.source,syncedAt:input.importedAt,bucket:row.bucket,priority:row.priority,state:row.bucket==='noise'?'ignored':'needs-reply',assignee:null,reply:'',ownerApproved:false,clientApproved:false,optedOut:false}));
}
/** Editing exact reply words clears both approvals. Ignored and opted-out entries cannot be handed off. */
export function editInbox(row:InboxItem,input:{reply?:string;assignee?:string|null;state?:InboxItem['state'];optedOut?:boolean}):InboxItem{
 requireSocial(Object.keys(input).every(key=>['reply','assignee','state','optedOut'].includes(key)));
 requireSocial(input.reply===undefined||typeof input.reply==='string'&&input.reply.length<=5000);requireSocial(input.assignee===undefined||input.assignee===null||socialText(input.assignee,100));requireSocial(input.state===undefined||['needs-reply','handled','ignored'].includes(input.state));requireSocial(input.optedOut===undefined||typeof input.optedOut==='boolean');
 const changed=input.reply!==undefined&&input.reply!==row.reply||input.optedOut===true||input.state==='ignored';return {...row,...input,...(row.optedOut||input.optedOut===true?{optedOut:true,state:'ignored' as const}:{}),...(changed?{ownerApproved:false,clientApproved:false}:{})};
}
export function decideReply(row:InboxItem,who:'owner'|'client',approved:boolean):InboxItem{
 requireSocial(['owner','client'].includes(who)&&typeof approved==='boolean');requireSocial(row.state==='needs-reply'&&!row.optedOut&&socialText(row.reply),'SOCIAL_APPROVAL_REQUIRED','Draft this reply before approving it.');
 requireSocial(who==='owner'||row.ownerApproved,'SOCIAL_APPROVAL_REQUIRED','The owner approves this exact reply before the client.');return {...row,...(who==='owner'?{ownerApproved:approved,clientApproved:false}:{clientApproved:approved})};
}
export function replyHandoff(row:InboxItem){requireSocial(row.state==='needs-reply'&&!row.optedOut&&row.ownerApproved&&row.clientApproved&&socialText(row.reply),'SOCIAL_APPROVAL_REQUIRED','The owner and client must approve this reply before handoff.');return {capability:'handoff' as const,sent:false,text:row.reply,channel:row.channel,to:row.author};}
