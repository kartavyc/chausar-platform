import {responseHours} from '../../playbooks/support-desk/due.ts';
// Support tools: nexusdesk (Apache-2.0) and ResolveHQ (source-available, ideas only); original code. No mail is sent.
import { check } from '../../../contracts.ts';
import type { ToolName } from '../../contracts.ts';
import type { Spec } from './tools.ts';
import { text } from './tools.ts';
import { listRecords, findRecord } from '../../records.ts';
import { proposeTicket } from '../../playbooks/support-desk/tickets.ts';
import { threadForAgent } from '../../build/mail-in.ts';
import { currentVenture } from '../../records.ts';
import { matchShopFiles } from '../../playbooks/support-desk/sources.ts';
const orderFor=(env:Parameters<Spec['run']>[0])=>{const state=env.deps.store.read();const run=env.runRef?.kind==='delivery'?findRecord(state,'venture-delivery-run',env.runRef.runId):null;return run&&run.ventureId===env.ventureId?findRecord(state,'venture-order',run.orderId):null;};
import { dueAt, supportHours } from '../../playbooks/support-desk/due.ts';
type SupportDeskToolName=Extract<ToolName,'support.match'|'support.ticket'>;
export const SUPPORT_DESK_TOOLS:Readonly<Record<SupportDeskToolName,Spec>>=Object.freeze({
 'support.match':{name:'support.match',effect:'compute',tier:'code',endsTurn:false,summary:'Finds excerpts in this order own plain-text shop files. A weak or tied customer match waits for owner confirmation; no answer is invented.',input:{query:text('The customer question.',500),email:text('Customer email, when known.',254,false),phone:text('Customer phone, when known.',40,false),orderNumber:text('Order number, when known.',80,false)},async run(env,input){
  const terms=String(input.query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[];
  const sources=env.files.filter(f=>f.format==='csv'||f.format==='transcript').flatMap(file=>Buffer.from(file.contentBase64,'base64').toString('utf8').split(/\r?\n/).slice(0,5000).map((line,index)=>({file:file.name,fileId:file.id,line:index+1,excerpt:line.slice(0,1000),score:terms.filter(w=>line.toLowerCase().includes(w)).length}))).filter(s=>s.score>0).sort((a,b)=>b.score-a.score||a.file.localeCompare(b.file)||a.line-b.line).slice(0,5);
  const matched=matchShopFiles({email:input.email,phone:input.phone,orderNumber:input.orderNumber},env.files);
  return {result:{sources,customer:matched,line:sources.length?'Read the cited shop excerpts before drafting.':'No matching source found. Ask the owner for the missing shop fact.'}};
 }},
 'support.ticket':{name:'support.ticket',effect:'compute',tier:'code',endsTurn:false,summary:'Prepares a ticket for owner confirmation, or reads an existing ticket. A proposal is not a created ticket and no reply is sent.',input:{operation:{type:'enum',required:true,values:['propose','get','thread'],about:'Propose a ticket, read a ticket, or read screened conversation words.'},thread:text('The mail conversation id.',120,false),ticketId:text('An existing ticket id.',120,false),customerEmail:text('The customer email from the message, never guessed.',254,false),subject:text('The mail subject.',200,false),language:text('Customer language code.',10,false)},async run(env,input){
  const state=env.deps.store.read();
  if(input.operation==='get'){const ticket=listRecords(state,'venture-support-ticket',env.ventureId).find(t=>t.id===input.ticketId&&t.serviceOrderId===orderFor(env)?.id&&t.shopClientId===orderFor(env)?.clientId);check(ticket,'SUPPORT_TICKET_NOT_FOUND','That support ticket was not found.');return {result:ticket};}
  if(input.operation==='thread'){const venture=currentVenture(state);check(venture&&venture.id===env.ventureId,'VENTURE_NOT_FOUND','Start a business first.');check(listRecords(state,'venture-support-ticket',env.ventureId).some(t=>t.thread===input.thread&&t.serviceOrderId===orderFor(env)?.id&&t.shopClientId===orderFor(env)?.clientId),'SUPPORT_THREAD_INVALID','Choose a conversation assigned to this shop service order.');const thread=threadForAgent(state,venture,String(input.thread));check(thread,'SUPPORT_THREAD_INVALID','Choose an imported mail conversation.');return {result:{...thread,untrusted:true}};}
  const proposal=proposeTicket({thread:String(input.thread??''),customerEmail:String(input.customerEmail??''),subject:String(input.subject??''),language:String(input.language??'en'),blocked:false},env.now(),listRecords(state,'venture-support-ticket',env.ventureId));
  const fields=env.intake?.fields??{};const hours=supportHours(fields);const responseDue=fields.firstReplyHours?dueAt(env.now(),responseHours(fields.firstReplyHours),hours):null;const resolutionDue=fields.resolutionHours?dueAt(env.now(),responseHours(fields.resolutionHours),hours):null;
  return {result:{proposal,dueAt:responseDue,resolutionDueAt:resolutionDue,created:false,sent:false,line:'Proposed only. The owner confirms the exact ticket in the support desk.'}};
 }}
});
