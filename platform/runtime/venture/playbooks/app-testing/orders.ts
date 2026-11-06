// The accepted plan, not a newer draft, owns client work.
import {check} from '../../../portable.ts';
import {readVenture,exactPayload,listRecords} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import type {DeskHandlers} from '../desk-types.ts';
export const TESTING_ORDERS:DeskHandlers={orders:{async list(deps,ctx,raw){
 const p=exactPayload(raw,['playbook','kind','filter'],['playbook','kind']);check(p.playbook==='app-testing'&&p.kind==='orders'&&p.filter===undefined,'INVALID_VENTURE_REQUEST','The testing order list takes no filter.');
 const {state,venture}=readVenture(deps,ctx),offers=acceptedBlueprintOrNull(state,venture)?.offers??[];
 const rows=listRecords(state,'venture-order',venture.id).flatMap(o=>{const offer=offers.find(f=>f.id===o.offerId);return ['open','invoiced'].includes(o.status)&&['app-test-round','demo-video'].includes(offer?.playbookOffer??'')?[{id:o.id,clientId:o.clientId,request:o.request,service:offer!.playbookOffer}]:[];});
 return{playbook:'app-testing',kind:'orders',rows,line:'Current testing orders from the accepted plan.'};
}}};
