// HINDI_REVIEW: machine-drafted, needs a native reviewer.
// Opaque one-answer rating links. ResolveHQ (source-available) supplied ideas only; original Chausar code.
import {createHash,randomBytes} from 'node:crypto';
import {check,type Context} from '../../../contracts.ts';
import type {SupportTicketRecord,VentureDeps} from '../../contracts.ts';
import {currentVenture,listRecords,ventureAction,type VentureTx} from '../../records.ts';
import {addRating} from './ratings.ts';
export type SupportRatingPage={language:'en'|'hi';answered:boolean};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Owner-approved link creation stores only a hash. The owner still sends the link; desktop has no public endpoint. */
export function inviteRating(tx:VentureTx,deps:VentureDeps,ticket:SupportTicketRecord){
 check(ticket.sentAt,'SUPPORT_RATING_NOT_READY','A rating link is available only after you recorded a reply as sent.');
 check(!tx.list('venture-support-rating').some(r=>r.ticketId===ticket.id),'SUPPORT_RATING_EXISTS','This ticket already has its rating.');
 const token=randomBytes(24).toString('base64url');const expiresAt=new Date(Date.parse(tx.now)+30*86400000).toISOString();
 const next={...ticket,rating:{tokenHash:sha(token),expiresAt},revision:ticket.revision+1};
 const served=deps.host==='hosted-web'&&!!deps.publicUrl;
 return {ticket:next,view:{id:ticket.id,url:served?`${deps.publicUrl!.replace(/\/+$/,'')}/support-rating/${token}`:null,expiresAt,line:served?'A plain rating link. You send it; no tracking pixel.':'Rating links need the hosted app. Ask the customer and record their answer here.'}};
}
/** Trusted hosted entry, never an RPC method. GET is read-only; POST atomically records one rating per ticket. */
export async function supportRatingEntry(deps:VentureDeps,ctx:Context,token:string,input:{operation?:unknown;score?:unknown}):Promise<SupportRatingPage|null>{
 if(deps.host!=='hosted-web'||!deps.publicUrl||!/^[A-Za-z0-9_-]{32}$/.test(token))return null;
 const state=deps.store.read();const venture=currentVenture(state);if(!venture)return null;
 const ticket=listRecords(state,'venture-support-ticket',venture.id).find(t=>t.rating?.tokenHash===sha(token)&&Date.parse(t.rating.expiresAt)>deps.clock().getTime());
 if(!ticket||!ticket.sentAt)return null;
 const language=ticket.language==='hi'?'hi':'en';
 if(input.operation==='page')return {language,answered:listRecords(state,'venture-support-rating',venture.id).some(r=>r.ticketId===ticket.id)};
 check(input.operation==='rate','INVALID_VENTURE_REQUEST','Choose a rating from the form.');
 check(Number.isInteger(input.score)&&Number(input.score)>=1&&Number(input.score)<=5,'SUPPORT_RATING_INVALID','Choose a rating from one to five.');
 return ventureAction(deps,ctx,'prepare','support.customerRating',tx=>{
  const current=tx.find('venture-support-ticket',ticket.id);
  check(current?.rating?.tokenHash===sha(token)&&Date.parse(current.rating.expiresAt)>Date.parse(tx.now),'SUPPORT_RATING_NOT_READY','This rating link has ended.');
  const ratings=addRating(tx.list('venture-support-rating'),current.id,Number(input.score),tx.now);
  tx.put({...tx.base('venture-support-rating'),...ratings.at(-1)!});tx.emit('desk.changed',{playbook:'support-desk',kind:'ticket',id:current.id});return {language,answered:true};
 });
}
/** Plain same-page form, no external resource, no script, no pixel and no customer text. */
export function supportRatingHtml(page:SupportRatingPage):string{
 const hi=page.language==='hi';const heading=hi?'आपकी सहायता कैसी रही?':'How was your support?';const thanks=hi?'धन्यवाद। आपका जवाब दर्ज है।':'Thank you. Your answer is recorded.';
 return `<!doctype html><html lang="${page.language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><body><main><h1>${heading}</h1>${page.answered?`<p>${thanks}</p>`:`<form method="post"><label>${hi?'रेटिंग':'Rating'} <select name="score" required><option value="">${hi?'चुनें':'Choose'}</option>${[1,2,3,4,5].map(score=>`<option value="${score}">${score}</option>`).join('')}</select></label><button type="submit">${hi?'रेटिंग भेजें':'Send rating'}</button></form>`}</main></body></html>`;
}
