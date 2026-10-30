// Original VA desk boundaries. Purchasing is an exact local handoff, never execution.
import {check} from '../../../contracts.ts';
import type {DeskHandlers} from '../desk-types.ts';
import type {RoomBriefRecord,ShareLinkView,Json} from '../../contracts.ts';
import {exactPayload,readVenture,requireAppChannel} from '../../records.ts';
import {roomOrder,type roomOwnerView} from '../kit/client-room-state.ts';
import {purchaseHandoff,paymentFieldAllowed} from './payment.ts';
type Purchase=ReturnType<typeof purchaseHandoff>;
export type VirtualAssistantDeskTypes={
 room:{filter:Json;row:RoomBriefRecord;item:ReturnType<typeof roomOwnerView>;actions:Record<string,{payload:Json;result:RoomBriefRecord|ShareLinkView}>};
 purchase:{filter:Json;row:Purchase;item:Purchase;actions:{preview:{payload:Json;result:Purchase}}};
 payment:{filter:Json;row:never;item:never;actions:{fill:{payload:Json;result:never}}};
};
/** Neither endpoint saves payment credentials or invokes a browser, shop or payment service. */
export const VIRTUAL_ASSISTANT_DESK:DeskHandlers={
 payment:{async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');const {state,venture}=readVenture(deps,ctx);roomOrder(state,venture,'virtual-assistant',p.id);return paymentFieldAllowed(p.payload);}},
 purchase:{async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');exactPayload(p,['playbook','kind','id','action','payload'],['playbook','kind','id','action','payload']);const {state,venture}=readVenture(deps,ctx);roomOrder(state,venture,'virtual-assistant',p.id);if(p.action==='buy'||p.action==='fill')return paymentFieldAllowed(p.payload);check(p.action==='preview','INVALID_VENTURE_REQUEST','Prepare the exact item and total for a manual purchase.');const body=exactPayload(p.payload,['item','quantity','unitMinor','currency'],['item','quantity','unitMinor','currency']);check(body.currency===venture.country.currency,'INVALID_VENTURE_REQUEST','Use this business currency for the purchase handoff.');const result=purchaseHandoff(body as Parameters<typeof purchaseHandoff>[0]);return{playbook:'virtual-assistant',kind:'purchase',id:p.id,result,line:result.line};}},
};
