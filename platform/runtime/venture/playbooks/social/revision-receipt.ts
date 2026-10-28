// Re-derive an extra-round quote from the owner price or its exact approved charge.
import { check, type State } from '../../../contracts.ts';
import { formatMinor } from '../../../currency.ts';
import { findRecord, digest } from '../../records.ts';
import type { VentureRecord, RowFigureReceipt } from '../../contracts.ts';
export const revisionReceiptId=(orderId:string,n:number,round:number,amount:string,currency:string)=>['fig','revision',orderId,'post-'+n,round,amount,currency].join(':');
export function socialRevisionReceipt(state:State,venture:VentureRecord,id:string):RowFigureReceipt {
 const parts=id.split(':');const [,kind,orderId,key,round,amount,currency]=parts;
 check(parts.length===7&&kind==='revision'&&/^post-[1-9][0-9]{0,2}$/.test(key)&&/^[1-9][0-9]*$/.test(round)&&/^\d{1,30}$/.test(amount),'RECEIPT_NOT_FOUND','This revision receipt was not found.');
 const order=findRecord(state,'venture-order',orderId);check(order?.ventureId===venture.id,'RECEIPT_NOT_FOUND','This revision receipt was not found.');
 const charge=order.socialGhostwriting?.charges.find(row=>row.receiptId===id);
 const used=order.socialGhostwriting?.rounds[key]??0;
 check(charge||used>=2&&used+1===Number(round)&&order.intake?.fields?.extraRoundPrice===amount&&venture.country.currency===currency,'RECEIPT_NOT_FOUND','This revision quote is no longer current.');
 const minor=String(BigInt(amount)*1n),display=formatMinor(minor,currency);
 const figures=[{key:'extra-round',label:'One extra revision round',amount:minor,unit:'minor' as const,currency,display}];
 return {id,kind:'row-figure',ventureId:venture.id,at:charge?.at??order.at,operation:'venture.row-figure',subject:{type:'plan-price',recordId:order.id},figures,allowedNumbers:[display],explanation:'Owner-set extra-round price multiplied by one revision round. This is a quote approval, not a payment.',digest:digest({id,figures}),stale:false};
}
