// Erasure for support copies. Original Chausar implementation of the founder's DPDP rule; no external code.
import type { VentureTx } from '../../records.ts';
import { removeRecords } from '../../network/people.ts';
/** Removes entire tickets naming forgotten people and every support child; drafts and message copies go with them. */
export function eraseSupportNaming(tx:VentureTx,emails:ReadonlySet<string>,mentions:(value:unknown)=>boolean,phones:ReadonlySet<string>=new Set()):void {
 const names=(value:unknown)=>typeof value==='string'&&(mentions(value)||[...emails].some(email=>value.toLowerCase().includes(email.toLowerCase())));
 const ids=new Set(tx.list('venture-support-ticket').filter(t=>emails.has(t.customerEmail.toLowerCase())||!!t.customerPhone&&[...phones].some(p=>p.replace(/\D/g,'')===t.customerPhone!.replace(/\D/g,''))||names(JSON.stringify(t.customerMatch))||names(t.subject)||names(t.note)||names(JSON.stringify(t.messages))||names(JSON.stringify(t.draft))).map(t=>t.id));
 removeRecords(tx,r=>r.kind==='venture-support-ticket'?ids.has(String(r.id)):['venture-support-message','venture-support-request','venture-support-rating'].includes(String(r.kind))&&ids.has(String(r.ticketId)));
}
