// Original version-bound client briefs. Shared by the native desk and browser simulation.
import {check,digest} from '../../../portable.ts';
import {validDate} from '../../../date-core.ts';
export type RoomPrice={offerId:string;minor:string;currency:string;receiptId:string;priceDigest:string;display:string};
export type RoomFields={scope:string;deliverable:string;deadline:string};
export type RoomInput={orderId:string;clientId:string;request:string;via:'owner-recorded'|'client-page';fields:RoomFields;price:RoomPrice};
export type ApprovedRoomBrief=RoomInput&{version:number;digest:string;by:string;at:string};
export type RoomBrief=RoomInput&{version:number;digest:string;approved:ApprovedRoomBrief|null};
const bounded=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function roomBrief(input:RoomInput,previous:RoomBrief|null):RoomBrief{
 check(input&&bounded(input.orderId,120)&&bounded(input.clientId,120)&&bounded(input.request,4000),'INVALID_VENTURE_REQUEST','Choose a client order and a request of at most 4000 characters.');
 check(input.via==='owner-recorded'||input.via==='client-page','INVALID_VENTURE_REQUEST','Record where this request came from.');
 check(input.fields&&bounded(input.fields.scope,4000)&&bounded(input.fields.deliverable,4000)&&typeof input.fields.deadline==='string'&&validDate(input.fields.deadline),'INVALID_VENTURE_REQUEST','Complete the scope, deliverable and a real deadline.');
 const p=input.price;
 check(p&&bounded(p.offerId,120)&&typeof p.minor==='string'&&/^\d{1,18}$/.test(p.minor)&&/^[A-Z]{3}$/.test(p.currency)&&bounded(p.receiptId,120)&&/^[a-f0-9]{64}$/.test(p.priceDigest)&&bounded(p.display,100),'INVALID_VENTURE_REQUEST','Use the owner price and its code receipt.');
 if(previous)check(previous.orderId===input.orderId&&previous.clientId===input.clientId,'APPROVAL_STALE','The order or client changed. Start a new room brief.');
 const version=(previous?.version??0)+1;
 const kept={orderId:input.orderId,clientId:input.clientId,request:input.request,via:input.via,fields:{scope:input.fields.scope,deliverable:input.fields.deliverable,deadline:input.fields.deadline},price:{...p},version};
 return {...kept,digest:digest(kept),approved:previous?.approved?structuredClone(previous.approved):null};
}
export function approveRoomBrief(brief:RoomBrief,expected:string,by:string,at:string):RoomBrief{
 const {approved:_,digest:actual,...content}=brief;
 check(expected===actual&&digest(content)===actual,'APPROVAL_STALE','Read and approve the current brief.');
 check(bounded(by,120)&&Number.isFinite(Date.parse(at)),'INVALID_VENTURE_REQUEST','Record the owner and approval time.');
 return {...brief,approved:{...structuredClone(content),digest:actual,by,at}};
}
export function clientRoomView(brief:RoomBrief,served:boolean){
 const approved=brief.approved;
 return {brief:approved?{...approved.fields,price:structuredClone(approved.price),version:approved.version,digest:approved.digest}:null,line:served?'Your client sees the approved version here':'Your client sees this when you send it',pending:!approved||approved.digest!==brief.digest};
}
