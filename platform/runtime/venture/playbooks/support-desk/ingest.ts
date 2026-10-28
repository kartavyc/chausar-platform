// Import-time support threading. RFC 5322 and ResolveHQ ideas only; original Chausar code.
import type {InboundRecord,SupportTicketRecord} from '../../contracts.ts';
import type {VentureTx} from '../../records.ts';
import {stopIn} from '../../delivery/run-controls.ts';
import {threadMessage} from './threading.ts';
import {wakeTicket} from './due.ts';
import {needsPerson,humanHandoff} from './handoff.ts';
/** An approved mail import may append screened evidence to an existing ticket, but never send or create a reply. */
export function ingestSupportMail(tx:VentureTx,mail:InboundRecord,signingKey:string):string|null {
 if(mail.text===null||mail.text===undefined)return null;
 const tickets=tx.list('venture-support-ticket').filter(t=>t.status!=='closed');
 const route=threadMessage({sender:mail.from,messageId:mail.messageId,references:mail.references??[],to:mail.to.join(', '),subject:mail.subject},tickets.map(t=>({id:t.id,number:t.number??'',customerEmail:t.customerEmail,messageIds:t.messages.flatMap(m=>m.messageId?[m.messageId]:[])})),signingKey);
 const ticket=tickets.find(t=>t.id===route.ticketId);if(!ticket||ticket.messages.some(m=>m.messageId===mail.messageId))return ticket?.id??null;
 const message={ticketId:ticket.id,messageId:mail.messageId,sender:mail.from,text:mail.text,at:mail.date,messageKind:'customer' as const,references:mail.references??[],untrusted:true};
 let next:SupportTicketRecord={...wakeTicket(ticket,tx.now,true),messages:[...ticket.messages,message].slice(-100),draft:null,policyApproval:null,policyChangeApproved:false,revision:ticket.revision+1};
 if(needsPerson(mail.text)||ticket.blocked||mail.from.toLowerCase()!==ticket.customerEmail.toLowerCase()){
  next=humanHandoff(next,[],tx.now).ticket;
  for(const run of tx.list('venture-delivery-run').filter(r=>r.orderId===ticket.serviceOrderId&&['waiting-for-you','needs-answer','brief-waiting'].includes(r.status)))stopIn(tx,run.id,!run.harness,tx.ctx.memberId);
 }
 tx.put({...tx.base('venture-support-message'),...message});const system=next.messages.at(-1);if(system?.messageKind==='system'&&system!==ticket.messages.at(-1))tx.put({...tx.base('venture-support-message'),...system,ticketId:ticket.id});
 tx.replace(next);tx.emit('desk.changed',{playbook:'support-desk',kind:'ticket',id:ticket.id});tx.emit('queue.changed',{});return ticket.id;
}
