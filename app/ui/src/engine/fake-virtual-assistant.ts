// Original VA local purchase handoff. No browser or payment credentials are accepted.
import type {FakePlaybookDesk} from './fake-playbooks';import type {W4DeskHost} from './fake-w4';
import {check} from '../../../../platform/runtime/portable';
import {purchaseHandoff,paymentFieldAllowed} from '../../../../platform/runtime/venture/playbooks/virtual-assistant/payment';
import {roomOrder,roomExact,roomGuard} from './fake-client-room';
import type {BlueprintViewLite} from './types';
export function fakeVirtualAssistantDesk(host:W4DeskHost):FakePlaybookDesk{return {playbook:'virtual-assistant',kinds:{
 payment:{act:p=>roomGuard(()=>{roomOrder(host,'virtual-assistant',p.id);return paymentFieldAllowed(p.payload);})},
 purchase:{act:p=>roomGuard(()=>{roomExact(p,['playbook','kind','id','action','payload']);roomOrder(host,'virtual-assistant',p.id);if(p.action==='buy'||p.action==='fill')return paymentFieldAllowed(p.payload);check(p.action==='preview','INVALID_VENTURE_REQUEST','Prepare the exact item and total for a manual purchase.');const b=roomExact(p.payload,['item','quantity','unitMinor','currency']),plan=host.ask('venture.blueprint.get',{}) as BlueprintViewLite;check(b.currency===plan.blueprint.backOffice.currency,'INVALID_VENTURE_REQUEST','Use this business currency for the purchase handoff.');const result=purchaseHandoff(b as Parameters<typeof purchaseHandoff>[0]);return {playbook:'virtual-assistant',kind:'purchase',id:p.id,result,line:result.line};})}
}};}
