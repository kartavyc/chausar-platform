// Chausar delivery harness: the virtual-assistant playbook's own tools (Virtual assistant service; Ink v2 wave 5,
// packages 5R1). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each
// stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for
// Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import {check} from '../../../contracts.ts';
import {findRecord} from '../../records.ts';
import {vaRoomEvidence} from '../../playbooks/virtual-assistant/run-source.ts';
import type { Spec } from './tools.ts';

type VirtualAssistantToolName = Extract<ToolName, 'va.brief'>;

export const VIRTUAL_ASSISTANT_TOOLS: Readonly<Record<VirtualAssistantToolName, Spec>> = Object.freeze({
  'va.brief': {name:'va.brief',effect:'compute',tier:'code',endsTurn:false,summary:'Read this order current owner-approved bounded brief and price receipt. No send, purchase or configuration change.',input:{},async run(env,input){
    check(Object.keys(input).length===0,'INVALID_VENTURE_REQUEST','The current run selects its own order.');
    const state=env.deps.store.read(),run=env.runRef.kind==='delivery'?findRecord(state,'venture-delivery-run',env.runRef.runId):null;
    check(run&&run.ventureId===env.ventureId,'ORDER_NOT_FOUND','Use the current client work run.');
    const brief=vaRoomEvidence(state,env.ventureId,run.orderId);check(brief,'APPROVAL_STALE','Prepare and approve the current room brief before work.');
    return{result:{brief,source:'owner-approved-room',sent:false,purchased:false}};
  }},
});
