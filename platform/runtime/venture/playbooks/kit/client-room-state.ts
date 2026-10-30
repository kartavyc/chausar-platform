// Original live scope checks and client-safe rendering, shared by desk and hosted token entry points.
import {check,type State} from '../../../contracts.ts';
import {formatMinor} from '../../../currency.ts';
import type {RoomBriefRecord,ShareLinkStoredRecord,VentureRecord} from '../../contracts.ts';
import {digest,listRecords,type VentureTx} from '../../records.ts';
import {orderChain} from './chain.ts';
import {kitDefinition} from './installed.ts';
import {clientRoomView,type RoomPrice} from './client-room-core.ts';
import {screenUntrusted} from '../../policy/untrusted.ts';
export function roomOrder(state:State,venture:VentureRecord,playbook:string,orderId:string){
 const order=listRecords(state,'venture-order',venture.id).find(r=>r.id===orderId);
 check(order&&order.status!=='cancelled'&&listRecords(state,'venture-client',venture.id).some(c=>c.id===order.clientId),'ORDER_NOT_FOUND','Choose a current client order.');
 check(kitDefinition(playbook)?.clientRoom===true&&orderChain(state,venture,order)?.definition.registration.id===playbook,'NOT_BUILT_YET','This playbook has no client room.');
 return order;
}
export function roomPrice(state:State,venture:VentureRecord,orderId:string):RoomPrice{
 const order=listRecords(state,'venture-order',venture.id).find(r=>r.id===orderId),price=order?listRecords(state,'venture-price-receipt',venture.id).find(r=>r.id===order.priceReceiptId):null;
 check(order&&price&&!price.stale&&price.subject.type==='order'&&price.subject.orderId===order.id,'PRICE_REQUIRED','Price this order from your current price list first.');
 return {offerId:order.offerId,minor:price.totalMinor,currency:price.currency,receiptId:price.id,priceDigest:price.digest,display:formatMinor(BigInt(price.totalMinor),price.currency)};
}
export function roomLinkCurrent(state:State,venture:VentureRecord,link:ShareLinkStoredRecord):RoomBriefRecord|null{
 if(!link.roomId)return null;
 const row=listRecords(state,'venture-room-brief',venture.id).find(r=>r.id===link.roomId&&r.id===link.deliveryId&&r.clientId===link.clientId);
 if(!row)return null;
 try{return roomOrder(state,venture,row.playbook,row.orderId).clientId===row.clientId?row:null;}catch{return null;}
}
export function roomClientText(row:RoomBriefRecord){
 const approved=row.brief?.approved;
 return approved?['Scope: '+approved.fields.scope,'Deliverable: '+approved.fields.deliverable,'Deadline: '+approved.fields.deadline,'Price: '+approved.price.display+' [receipt '+approved.price.receiptId+']','Version: '+approved.version].join('\n'):'Send your request. The owner will review its scope, deliverable, deadline and price.';
}
export function roomOwnerView(row:RoomBriefRecord,served:boolean){return {...row,client:row.brief?clientRoomView(row.brief,served):{brief:null,line:served?'Your client sees the approved version here':'Your client sees this when you send it',pending:true}};}
export function appendRoomRequest(tx:VentureTx,row:RoomBriefRecord,text:unknown,via:'owner-recorded'|'client-page'){
 check(typeof text==='string'&&text.trim().length>0&&text.length<=1000&&row.requests.length<50,'INVALID_VENTURE_REQUEST','Write a request of at most 1000 characters. This room holds at most 50 requests.');
 const cleaned=text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
 check(cleaned.length>0,'INVALID_VENTURE_REQUEST','Write the actual work needed.');
 const screened=screenUntrusted({source:'client-answer',text:cleaned},{mode:'enforce'});
 check(screened.status!=='quarantined'&&screened.text!==null,'INVALID_VENTURE_REQUEST','This request contains instructions that need review. Record the actual work needed.');
 const request={id:digest({room:row.id,index:row.requests.length,text:screened.text,at:tx.now}),text:screened.text,via,at:tx.now};
 const next=tx.replace({...row,requests:[...row.requests,request]});tx.emit('desk.changed',{playbook:row.playbook});return next;
}
