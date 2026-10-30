// Support decisions that need the owner on Today. Original Chausar code; nexusdesk Apache-2.0 ideas.
import type {State} from '../../../contracts.ts';
import type {VentureRecord} from '../../contracts.ts';
import {listRecords} from '../../records.ts';
import type {W4RowItem} from '../../views/queue-w4.ts';
/** No guessed customer link is applied: an unconfirmed ticket opens the exact owner confirmation screen. */
export function supportRows(state:State,venture:VentureRecord):W4RowItem[]{
 return listRecords(state,'venture-support-ticket',venture.id).filter(t=>t.proposal||t.autoDraftsPaused&&t.status!=='closed'&&t.status!=='resolved').map(t=>({kind:'notice',subject:`support:${t.id}`,version:String(t.revision),createdAt:t.at,title:t.proposal?'A support ticket needs confirmation':'A support customer needs a person',line:t.proposal?'Check the customer and conversation before confirming this ticket.':'Automatic drafts are paused. Read the customer request yourself.',actions:[{id:'later',label:'Later',primary:false},{id:'open',label:'Open support desk',primary:true}],navigate:'Open Work to review this support ticket.',notice:{probe:'drafts',severity:'medium',link:`/work?state=orders&support=${t.id}`}}));
}
