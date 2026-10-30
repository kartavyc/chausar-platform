// Persisted support desk. nexusdesk (Apache-2.0), ResolveHQ (source-available ideas only). Original Chausar implementation.
import { check, type Context } from '../../../contracts.ts';
import type { Json, SupportTicketRecord, SupportMessageRecord, SupportRequestRecord, SupportRatingRecord, VentureDeps } from '../../contracts.ts';
import { digest, exactPayload, identifier, plainText, singleLine, smallInteger, requireAppChannel, ventureAction, type VentureTx } from '../../records.ts';
import { clientDraft } from '../../build/draft-text.ts';
import { readAs } from '../../delivery/shared.ts';
import { stopIn } from '../../delivery/run-controls.ts';
import { matchShopFiles } from './sources.ts';
import { signedReplyAddress } from './threading.ts';
import { mailThreadsOf, threadForAgent, threadIdOf } from '../../build/mail-in.ts';
import { redactSecrets, screenReadback } from '../../core/secrets.ts';
import { dueAt, dueBadge, queueRank, snoozeTicket, wakeTicket, supportHours, type ShopHours } from './due.ts';
import { confirmTicket, moveTicket, proposeTicket, requestMoney, checkSupportDraft, sendHandoff, type TicketInput, type TicketProposal } from './tickets.ts';
import { humanHandoff, needsPerson, replyPair, triageSupport } from './handoff.ts';
import { addRating, ratingSummary } from './ratings.ts';
import { mailReadiness } from './readiness.ts';
import { inviteRating } from './rating-link.ts';
import type { DeskHandler, DeskHandlers } from '../desk-types.ts';
import type { SupportTicketBody, TicketStatus } from './records.ts';
export type SupportTicketRow={id:string;thread:string;subject:string;customerEmail:string;status:TicketStatus;revision:number;due:string;queue:number;proposal:boolean;paused:boolean;language:string};
type ChildKind<T>={filter:Json;row:T;item:T;actions:Record<string,{payload:Json;result:unknown}>};
export type SupportDeskDeskTypes={ticket:{filter:Json;row:SupportTicketRow;item:SupportTicketRecord;actions:Record<string,{payload:Json;result:unknown}>};message:ChildKind<SupportMessageRecord>;request:ChildKind<SupportRequestRecord>;rating:ChildKind<SupportRatingRecord>};
const playbook='support-desk' as const;
const INVALID='INVALID_VENTURE_REQUEST';
const row=(t:SupportTicketRecord,now:string):SupportTicketRow=>({id:t.id,thread:t.thread,subject:t.subject,customerEmail:t.customerEmail,status:t.status,revision:t.revision,due:dueBadge(t,now),queue:queueRank(t,now),proposal:!!t.proposal,paused:t.autoDraftsPaused,language:t.language});
/** Server computes all queue order and due words. The UI renders these values without arithmetic. */
function ticketOf(tx:VentureTx,id:string):SupportTicketRecord{const ticket=tx.find('venture-support-ticket',id);check(ticket,'SUPPORT_TICKET_NOT_FOUND','That support ticket was not found.');return ticket;}
const cleaned=(value:unknown,label:string,max=12000)=>screenReadback(redactSecrets(plainText(value,label,{max})),{keep:[]}).text;
function threadRuns(tx:VentureTx,ticket:SupportTicketBody){return ticket.serviceOrderId?tx.list('venture-delivery-run').filter(r=>r.orderId===ticket.serviceOrderId):[];}
function activeThread(tx:VentureTx,ticket:SupportTicketBody){return threadRuns(tx,ticket).some(r=>['waiting-for-you','needs-answer','brief-waiting'].includes(r.status));}
function shopOrder(tx:VentureTx,ticket:SupportTicketBody){const order=ticket.serviceOrderId?tx.find('venture-order',ticket.serviceOrderId):null;check(order&&order.status!=='cancelled'&&order.clientId===ticket.shopClientId,'SUPPORT_ORDER_REQUIRED','Choose this shop service order before drafting a reply.');return order;}
function isBlocked(tx:VentureTx,ticket:SupportTicketBody){const order=shopOrder(tx,ticket);const blocked=order.intake?.fields?.blockedCustomers;return ticket.blocked||Array.isArray(blocked)&&blocked.some(value=>typeof value==='string'&&value.trim().toLowerCase()===ticket.customerEmail.toLowerCase());}
function sourceFiles(tx:VentureTx,ticket:SupportTicketBody,names:readonly string[]){shopOrder(tx,ticket);const files=tx.list('venture-upload').filter(f=>f.scope.kind==='order'&&f.scope.orderId===ticket.serviceOrderId);check(names.length>0,'SUPPORT_SOURCE_REQUIRED','Cite shop files attached to this service order.');return names.map(name=>{const matches=files.filter(f=>f.name===name);check(matches.length===1,'SUPPORT_SOURCE_REQUIRED','Cite shop files attached to this service order.');return {id:matches[0]!.id,digest:matches[0]!.digest};});}
function currentReply(tx:VentureTx,ticket:SupportTicketRecord){check(!isBlocked(tx,ticket)&&!ticket.autoDraftsPaused,'SUPPORT_PERSON_REQUIRED','A person is handling this ticket. Automatic drafts are paused.');check(ticket.draft,'SUPPORT_REPLY_INVALID','Open a customer reply before approving it.');const current=sourceFiles(tx,ticket,ticket.draft.sources);check(digest(current)===digest(ticket.draft.sourceFiles??[]),'SUPPORT_SOURCE_CHANGED','The cited shop files changed. Review a fresh reply.');}
function policyApproved(tx:VentureTx,ticket:SupportTicketRecord,shareId:string){const link=tx.find('venture-share-link',shareId);const run=link?tx.find('venture-delivery-run',link.deliveryId):null;const order=run?tx.find('venture-order',run.orderId):null;return !!(link&&run&&order&&ticket.shopClientId&&link.clientId===ticket.shopClientId&&order.id===ticket.serviceOrderId&&order.clientId===ticket.shopClientId&&ticket.draft?.policyChange&&link.text===ticket.draft.translated&&clientDraft(run).digest===link.draftDigest&&link.state!=='revoked'&&link.served&&(link.shareKind===undefined||link.shareKind==='draft')&&link.decisions.some(d=>d.decision==='approved'&&d.digest===link.draftDigest&&d.via==='share-link'&&(d.recordedFor===undefined||d.recordedFor===ticket.shopClientId)&&Date.parse(d.at)<=Date.parse(link.expiresAt)));}
function requirePolicy(tx:VentureTx,ticket:SupportTicketRecord){check(!ticket.draft?.policyChange||ticket.policyApproval&&ticket.policyApproval.replyDigest===digest({...ticket.draft,approved:false})&&policyApproved(tx,ticket,ticket.policyApproval.shareId),'SUPPORT_SHOP_APPROVAL_REQUIRED','The shop must approve the exact policy change by its share link.');}
const fields=(p:unknown,allowed:readonly string[],required:readonly string[]=allowed)=>exactPayload(p,allowed,required);
/** Exact owner actions are serialized by ventureAction, with the shown ticket digest checked inside the transaction. */
async function act(deps:VentureDeps,ctx:Context,p:{id:string;action:string;payload:Json;digest?:string}){
 requireAppChannel(ctx,'venture.desk.act');
 if(p.action==='readiness'){
  readAs(deps,ctx,'approve');const b=fields(p.payload,['domain','selector']);return {id:p.id,result:await mailReadiness(singleLine(b.domain,'Domain',{max:253}),singleLine(b.selector,'Selector',{max:63})),line:'Mail readiness checked. Re-check after changing records.'};
 }
 return ventureAction(deps,ctx,'approve','support.desk',tx=>{
  if(p.action==='propose'){
   const b=fields(p.payload,['thread','customerEmail','subject','language','blocked','firstReplyHours','resolutionHours','hours','shopHours','timeZone','holidays','serviceOrderId','customerOrderNumber','customerPhone'],['thread','customerEmail','subject','language','blocked']);
   const proposal=proposeTicket({thread:identifier(b.thread,'Conversation'),customerEmail:singleLine(b.customerEmail,'Customer email',{max:254}),subject:singleLine(b.subject,'Subject',{max:200}),language:singleLine(b.language,'Language',{max:10}),blocked:b.blocked as boolean},tx.now,tx.list('venture-support-ticket'));
   let body=confirmTicket(proposal,tx.now,false);
   const order=b.serviceOrderId===undefined?null:tx.find('venture-order',identifier(b.serviceOrderId,'Service order'));
   check(b.serviceOrderId===undefined||order&&order.status!=='cancelled','SUPPORT_ORDER_REQUIRED','Choose this shop service order before drafting a reply.');
   body={...body,serviceOrderId:order?.id??null,shopClientId:order?.clientId??null,...(b.customerOrderNumber!==undefined?{customerOrderNumber:singleLine(b.customerOrderNumber,'Customer order number',{max:80})}:{}),...(b.customerPhone!==undefined?{customerPhone:singleLine(b.customerPhone,'Customer phone',{max:40})}:{})};
   if(order)body={...body,customerMatch:matchShopFiles({email:body.customerEmail,phone:body.customerPhone,orderNumber:body.customerOrderNumber},tx.list('venture-upload').filter(f=>f.scope.kind==='order'&&f.scope.orderId===order.id))};
   if(order&&isBlocked(tx,body))body={...body,blocked:true,autoDraftsPaused:true};
   const incoming=mailThreadsOf(tx.state,tx.venture!).find(m=>m.id===proposal.thread);
   if(incoming){
    check(!incoming.held,'UNTRUSTED_HELD','Review and release the held mail before making its ticket.');
    const messages=tx.list('venture-inbound').filter(m=>threadIdOf(tx.state,tx.venture!,m.id)===proposal.thread).sort((a,b)=>a.date.localeCompare(b.date));
    check(messages.some(m=>m.from.toLowerCase()===proposal.customerEmail),'SUPPORT_THREAD_INVALID','The customer must be a sender in this imported conversation.');
    body={...body,messages:messages.map(m=>({ticketId:'',messageId:m.messageId,sender:m.from,text:m.source==='file-import'?m.text??'':'The original words remain in the mailbox. Forward or export them to read them here.',at:m.date,messageKind:'customer' as const,references:m.references??[],untrusted:true}))};
    if(body.messages.some(m=>needsPerson(m.text)))body=humanHandoff(body,[],tx.now).ticket;
   }
   const targets={...order?.intake?.fields,...b};
   const policy=b.hours===undefined?supportHours(targets):b.hours as unknown as ShopHours;
   const due=targets.firstReplyHours===undefined||targets.firstReplyHours===null||targets.firstReplyHours===''?null:dueAt(tx.now,Number(targets.firstReplyHours),policy);
   const resolution=targets.resolutionHours===undefined||targets.resolutionHours===null||targets.resolutionHours===''?null:dueAt(tx.now,Number(targets.resolutionHours),policy);
   const ticket=tx.put<SupportTicketRecord>({...tx.base('venture-support-ticket'),...body,number:String(tx.list('venture-support-ticket').length+1),proposal:{expiresAt:proposal.expiresAt},dueAt:due,resolutionDueAt:resolution});
   for(const message of ticket.messages)tx.put({...tx.base('venture-support-message'),...message,ticketId:ticket.id});
   tx.emit('desk.changed',{playbook,kind:'ticket',id:ticket.id});tx.emit('queue.changed',{});return {id:ticket.id,result:ticket,line:'Ticket proposed. Nothing has been sent.'};
  }
  const ticket=wakeTicket(ticketOf(tx,identifier(p.id,'Ticket')),tx.now);
  check(typeof p.digest==='string'&&p.digest===digest(ticket),'TICKET_STALE','This ticket changed. Open it again before deciding.');
  let next:SupportTicketRecord=ticket;let result:unknown;
  if(p.action==='confirm'){
   const b=fields(p.payload,['matchId'],[]);check(ticket.proposal,'TICKET_ALREADY_CONFIRMED','This ticket is already confirmed.');
   confirmTicket({...ticket,dedupKey:ticket.thread,expiresAt:ticket.proposal.expiresAt},tx.now,activeThread(tx,ticket));
   let customerMatch=ticket.customerMatch;
   if(customerMatch){const current=matchShopFiles({email:ticket.customerEmail,phone:ticket.customerPhone,orderNumber:ticket.customerOrderNumber},tx.list('venture-upload').filter(f=>f.scope.kind==='order'&&f.scope.orderId===ticket.serviceOrderId));check(digest(current)===digest(customerMatch),'SUPPORT_SOURCE_CHANGED','The shop customer source changed. Review a new ticket proposal.');check(!current.needsConfirmation||!current.candidates.length||Object.hasOwn(b,'matchId'),'SUPPORT_MATCH_REQUIRED','Choose the evidenced customer order or explicitly leave the match unconfirmed.');const selected=b.matchId===undefined?current.matchedId:b.matchId;check(selected===null||typeof selected==='string'&&current.candidates.some(c=>c.id===selected),'SUPPORT_MATCH_REQUIRED','Choose a customer order shown in the current shop source.');customerMatch={...current,matchedId:selected as string|null,needsConfirmation:false,confirmedBy:ctx.memberId};}
   next={...ticket,...(customerMatch?{customerMatch}:{}),proposal:null,revision:ticket.revision+1};
  }else{
   check(!ticket.proposal,'SUPPORT_CONFIRM_REQUIRED','Confirm the proposed ticket before working on it.');
   check(ticket.status!=='closed','TICKET_CLOSED','A closed ticket stays closed. Start a new conversation.');
   switch(p.action){
    case 'move':{const b=fields(p.payload,['revision','status','note']);next=moveTicket(ticket,smallInteger(b.revision,'Revision',1,1000000),b.status as TicketStatus,cleaned(b.note,'Note',2000));break;}
    case 'snooze':{const b=fields(p.payload,['until','reason']);next=snoozeTicket(ticket,tx.now,singleLine(b.until,'Wake time',{max:40}),cleaned(b.reason,'Reason',500));break;}
    case 'wake':fields(p.payload,[]);next=wakeTicket(ticket,tx.now);break;
    case 'message':{
     const b=fields(p.payload,['text','messageId','references'],['text']);const text=cleaned(b.text,'Customer message');
     const message={ticketId:ticket.id,messageId:typeof b.messageId==='string'?b.messageId:null,sender:ticket.customerEmail,text,at:tx.now,messageKind:'customer' as const,references:Array.isArray(b.references)?b.references.filter((v):v is string=>typeof v==='string').slice(0,40):[],untrusted:true};
     tx.put({...tx.base('venture-support-message'),...message});
     next={...wakeTicket(ticket,tx.now,true),messages:[...ticket.messages,message].slice(-100),revision:ticket.revision+1,draft:null};
     if(needsPerson(text)||ticket.blocked){const handoff=humanHandoff(next,[],tx.now);next=handoff.ticket;result=handoff.summary;stopRuns(tx,ticket);}
     break;
    }
    case 'take-over':{fields(p.payload,[]);const takeover=humanHandoff(ticket,[],tx.now);next=takeover.ticket;result=takeover.summary;stopRuns(tx,ticket);break;}
    case 'draft':{
     const b=fields(p.payload,['original','translated','language','sources','policyChange']);
     check(!isBlocked(tx,ticket)&&!ticket.autoDraftsPaused,'SUPPORT_PERSON_REQUIRED','A person is handling this ticket. Automatic drafts are paused.');
     check(typeof b.policyChange==='boolean'&&Array.isArray(b.sources)&&b.sources.every(v=>typeof v==='string'),INVALID,'Choose the policy state and source names.');
     const pair=replyPair(cleaned(b.original,'Draft before translation'),cleaned(b.translated,'Customer-language draft'),singleLine(b.language,'Language',{max:10}),b.sources as string[],b.policyChange);
     check(pair.language===ticket.language,'SUPPORT_LANGUAGE_MISMATCH','Use the customer language recorded on the ticket.');
     check(checkSupportDraft(pair.original).pass&&checkSupportDraft(pair.translated).pass,'SUPPORT_NOT_DONE_YET','A request is not a completed money action, and saving is not sending.');
     next={...ticket,draft:{...pair,sourceFiles:sourceFiles(tx,ticket,pair.sources)},sentAt:null,policyChangeApproved:false,policyApproval:null,revision:ticket.revision+1};break;
    }
    case 'approve-policy':{const b=fields(p.payload,['shareId']);currentReply(tx,ticket);const shareId=identifier(b.shareId,'Shop approval link');check(policyApproved(tx,ticket,shareId),'SUPPORT_SHOP_APPROVAL_REQUIRED','The shop must approve the exact policy change by its share link.');next={...ticket,policyChangeApproved:true,policyApproval:{shareId,replyDigest:digest(ticket.draft)},revision:ticket.revision+1};break;}
    case 'approve-reply':{
     fields(p.payload,[]);currentReply(tx,ticket);requirePolicy(tx,ticket);
     next={...ticket,draft:{...ticket.draft!,approved:true},revision:ticket.revision+1};break;
    }
    case 'handoff':{
     fields(p.payload,[]);currentReply(tx,ticket);requirePolicy(tx,ticket);check(ticket.draft?.approved,'SUPPORT_APPROVAL_REQUIRED','Approve the exact reply before handing it off or recording a send.');
     const last=ticket.messages.filter(m=>m.messageKind==='customer').at(-1);
     return {id:ticket.id,result:sendHandoff({to:ticket.customerEmail,subject:ticket.subject,text:ticket.draft.translated,...(ticket.replyAddress?{replyTo:ticket.replyAddress}:{}),messageId:last?.messageId??null,references:last?.references??[]}),line:'An unsent draft. You send it from the shop mailbox.'};
    }
    case 'sent':fields(p.payload,[]);currentReply(tx,ticket);requirePolicy(tx,ticket);check(ticket.draft?.approved,'SUPPORT_APPROVAL_REQUIRED','Approve the exact reply before handing it off or recording a send.');check(!ticket.sentAt,'ALREADY_DECIDED','This reply is already recorded as sent.');next={...ticket,sentAt:tx.now,revision:ticket.revision+1};break;
    case 'request':{const b=fields(p.payload,['kind','amountText','currency']);const request=requestMoney({kind:b.kind as 'refund'|'replacement',amountText:b.amountText as string,currency:b.currency as string});const {kind:requestKind,...requestBody}=request;result=tx.put({...tx.base('venture-support-request'),ticketId:ticket.id,requestKind,...requestBody});next={...ticket,revision:ticket.revision+1};break;}
    case 'reply-address':{const b=fields(p.payload,['mailbox']);const mailbox=singleLine(b.mailbox,'Shop mailbox',{max:254});const key=deps.secrets.get('receipt:signing');check(key&&key.length>=16,'SUPPORT_REPLY_ADDRESS_UNAVAILABLE','The app signing key is not available. Use message references in your mail app.');const replyTo=signedReplyAddress(ticket.id,mailbox,key);next={...ticket,replyAddress:replyTo,revision:ticket.revision+1};result={replyTo};break;}
    case 'rating-link':{fields(p.payload,[]);const invitation=inviteRating(tx,deps,ticket);next=invitation.ticket;result=invitation.view;break;}
    case 'rate':{const b=fields(p.payload,['score']);const ratings=addRating(tx.list('venture-support-rating'),ticket.id,smallInteger(b.score,'Rating',1,5),tx.now);const rating=ratings.at(-1)!;tx.put({...tx.base('venture-support-rating'),...rating});result=ratingSummary(ratings);next={...ticket,revision:ticket.revision+1};break;}
    case 'triage':{const b=fields(p.payload,['impact','evidence']);check(Array.isArray(b.evidence)&&b.evidence.every(v=>typeof v==='string'),INVALID,'Evidence is a list of source names.');result=triageSupport({impact:singleLine(b.impact,'Impact',{max:120}),evidence:b.evidence as string[]});break;}
    default:check(false,INVALID,'Choose a supported ticket action.');
   }
  }
  if(next.messages.length>ticket.messages.length&&next.messages.at(-1)?.messageKind==='system')tx.put({...tx.base('venture-support-message'),...next.messages.at(-1)!,ticketId:ticket.id});
  tx.replace(next);tx.emit('desk.changed',{playbook,kind:'ticket',id:next.id});tx.emit('queue.changed',{});return {id:next.id,result:result??next,line:p.action==='sent'?'Recorded as sent by you.':'Ticket updated. Nothing was sent.'};
 });
}
/** Stop queued and active support work using the harness stop latch, without retrying anything in flight. */
function stopRuns(tx:VentureTx,ticket:SupportTicketBody){for(const r of threadRuns(tx,ticket)){if(['waiting-for-you','needs-answer','brief-waiting'].includes(r.status))stopIn(tx,r.id,!r.harness,tx.ctx.memberId);}}
export const SUPPORT_DESK_DESK:DeskHandlers=Object.freeze({ticket:{
 async list(deps,ctx,p){const {state,venture}=readAs(deps,ctx,'read');const filter=p.filter===undefined?{}:exactPayload(p.filter,['queue']);check(filter.queue===undefined||['overdue','due-soon','open','waiting-customer','all'].includes(String(filter.queue)),INVALID,'Choose a ticket queue.');const now=deps.clock().toISOString();const tickets=state.conversations.filter((r):r is SupportTicketRecord=>r.kind==='venture-support-ticket'&&r.ventureId===venture.id);const selected=tickets.map(t=>row(wakeTicket(t,now),now)).filter(t=>!filter.queue||filter.queue==='all'||filter.queue==='overdue'&&t.queue===0||filter.queue==='due-soon'&&t.queue===1||filter.queue==='open'&&t.queue===2||filter.queue==='waiting-customer'&&t.status==='waiting-customer').sort((a,b)=>a.queue-b.queue||a.id.localeCompare(b.id));return {playbook,kind:'ticket',rows:selected,line:'Customer replies wait for your approval and your own mail app.'};},
 async get(deps,ctx,p){const {state,venture}=readAs(deps,ctx,'read');const stored=state.conversations.find((r):r is SupportTicketRecord=>r.kind==='venture-support-ticket'&&r.ventureId===venture.id&&r.id===p.id);check(stored,'SUPPORT_TICKET_NOT_FOUND','That support ticket was not found.');const ticket=wakeTicket(stored,deps.clock().toISOString());return {playbook,kind:'ticket',item:{...ticket,ratings:ratingSummary(state.conversations.filter((r):r is SupportRatingRecord=>r.kind==='venture-support-rating'&&r.ventureId===venture.id))},digest:digest(ticket)};},
 async act(deps,ctx,p){const result=await act(deps,ctx,p);return {playbook,kind:'ticket',...result};}
},message:child('venture-support-message'),request:child('venture-support-request'),rating:child('venture-support-rating')});




/** Support child records are read-only and scoped to this business and optional ticket. */
function child(kind:'venture-support-message'|'venture-support-request'|'venture-support-rating'):DeskHandler {
 const short=kind.replace('venture-support-','');
 return {
  async list(deps,ctx,p){const {state,venture}=readAs(deps,ctx,'read');const f=p.filter===undefined?{}:exactPayload(p.filter,['ticketId']);if(f.ticketId!==undefined)identifier(f.ticketId,'Ticket');const rows=state.conversations.filter(r=>r.kind===kind&&r.ventureId===venture.id&&(f.ticketId===undefined||r.ticketId===f.ticketId));return {playbook,kind:short,rows,line:'Support records kept for this business.'};},
  async get(deps,ctx,p){const {state,venture}=readAs(deps,ctx,'read');const item=state.conversations.find(r=>r.kind===kind&&r.ventureId===venture.id&&r.id===p.id);check(item,'SUPPORT_RECORD_NOT_FOUND','That support record was not found.');return {playbook,kind:short,item,digest:digest(item)};}
 };
}
