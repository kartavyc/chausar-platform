// Original engine-resolved brief evidence; caller/model text never supplies the approval.
import {check,type State} from '../../../contracts.ts';
import type {DeliveryRunRecord} from '../../contracts.ts';
import {digest,findRecord,listRecords} from '../../records.ts';
import {roomOrder,roomPrice} from '../kit/client-room-state.ts';
import {roomApproved} from './checks.ts';
export function vaRoomEvidence(state:State,ventureId:string,orderId:string){
 const venture=findRecord(state,'venture-record',ventureId);if(!venture)return null;
 try{const order=roomOrder(state,venture,'virtual-assistant',orderId),row=listRecords(state,'venture-room-brief',ventureId).find(r=>r.orderId===order.id&&r.clientId===order.clientId&&r.playbook==='virtual-assistant');
  return row?.brief&&roomApproved(row.brief)&&digest(roomPrice(state,venture,orderId))===digest(row.brief.price)?row.brief:null;
 }catch{return null;}
}
/** A delivery remains tied to the approved version it actually read, even after a new version is approved. */
export function vaRunSource(state:State,ventureId:string,orderId:string,expected?:string){
 const brief=vaRoomEvidence(state,ventureId,orderId);
 check(brief&&(!expected||brief.digest===expected),'APPROVAL_STALE','Approve the current client room brief and start this work again.');
 return brief;
}
export function vaRunCurrent(state:State,ventureId:string,run:DeliveryRunRecord){
 return run.vaBriefBinding?vaRunSource(state,ventureId,run.orderId,run.vaBriefBinding):null;
}
export {vaBriefDeliverable} from './brief-deliverable.ts';
