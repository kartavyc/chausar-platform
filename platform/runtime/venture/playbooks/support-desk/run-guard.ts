// Support handoffs must hold before any model preview or approval. Original Chausar code.
import {check,type State} from '../../../contracts.ts';
import type {OrderRecord,VentureRecord} from '../../contracts.ts';
import {listRecords} from '../../records.ts';
/** Blocked addressees and an owner takeover never start another draft on the same service order. */
export function refuseSupportDraft(state:State,venture:VentureRecord,order:OrderRecord):void {
 const blocked=order.intake?.fields?.blockedCustomers;
 const named=Array.isArray(blocked)&&blocked.some(v=>typeof v==='string'&&v.trim()&&order.request.toLowerCase().includes(v.trim().toLowerCase()));
 const paused=listRecords(state,'venture-support-ticket',venture.id).some(t=>t.serviceOrderId===order.id&&t.autoDraftsPaused&&!['resolved','closed'].includes(t.status));
 check(!named&&!paused,'SUPPORT_PERSON_REQUIRED','A person is handling this customer. Automatic drafts are paused. Open the support desk.');
}
