// Original current-order scope. Career data cannot be attached to a different service or a cancelled order.
import {check,type Context} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {listRecords} from '../../records.ts';
import {readAs} from '../../delivery/shared.ts';
import {orderChain} from '../kit/chain.ts';
import {requireConfirmedRules} from '../kit/rules.ts';
import {CAREER_PRIVACY_RULE} from './definition-data.ts';
export function careerOrder(deps:VentureDeps,ctx:Context,id:string){
 const {state,venture}=readAs(deps,ctx,'approve'),order=listRecords(state,'venture-order',venture.id).find(row=>row.id===id);
 check(order&&order.status!=='cancelled','ORDER_NOT_FOUND','Choose a current career order.');
 const chain=orderChain(state,venture,order);check(chain?.definition.registration.id==='job-search-desk','CAREER_ORDER_REQUIRED','Choose a career service order.');
 requireConfirmedRules([CAREER_PRIVACY_RULE],['tailor'],venture.launchStage==='rehearsal'||venture.launchStage==='shadow'?'rehearsal':'client');
 return {order,venture,offer:chain.offer.id};
}
