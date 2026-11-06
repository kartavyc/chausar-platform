// Original native order scope. Narration never turns another service's price into an hourly rate.
import {check,type Context} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {listRecords,readVenture} from '../../records.ts';
import {orderChain} from '../kit/chain.ts';
export function narrationOrder(deps:VentureDeps,ctx:Context,orderId:string){const {state,venture}=readVenture(deps,ctx),order=listRecords(state,'venture-order',venture.id).find(r=>r.id===orderId);check(order&&order.status!=='cancelled','ORDER_NOT_FOUND','Choose a current narration order.');const chain=orderChain(state,venture,order);check(chain?.definition.registration.id==='narration-studio','NARRATION_ORDER_REQUIRED','Choose a narration offer for this order.');return {order,offer:chain.offer.id};}
