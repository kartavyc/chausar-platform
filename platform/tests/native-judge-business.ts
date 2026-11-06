import {business,owner,plainDraft,type Business} from './venture-judge-helpers.ts';
import {getClientAiConsent,agreeClientAiConsent} from '../runtime/venture/clients/ai-consent.ts';
import {scriptedAgent,SCRIPTED_AGENT_SETTINGS} from './fixtures/venture/scripted-agent.ts';
import {waitForAgentWork} from '../runtime/venture/agent-runtime/runner.ts';
import type {ModelTask} from '../runtime/venture/contracts.ts';

function draftTask(sections:string[]):ModelTask<unknown>{
 return {purpose:'delivery',instructions:'Synthetic draft fixture.',input:{requiredSections:sections},schemaName:'synthetic-draft',schema:{type:'object',properties:{},required:[],additionalProperties:false},validate:raw=>raw,containsClientData:true,maxOutputTokens:256};
}

/** Synthetic installed-agent route with real scoped MCP; no per-turn approval compatibility. */
export async function nativeJudgeBusiness(idea:string,stage:'rehearsal'|'shadow'|'approve-each'='approve-each') {
 const env=await business(idea,stage);await env.deps.services.trust.updatePolicy(owner,{send:'shape'});
 const permission=await getClientAiConsent(env.deps,owner,{clientId:env.client.id});await agreeClientAiConsent(env.deps,owner,{clientId:env.client.id,disclosureDigest:permission.disclosureDigest});
 const control:{opened:number;dispatched:number;errors:unknown[];business?:unknown;beforeOpen?:()=>Promise<void>;beforeDraft?:()=>Promise<void>;hold?:Promise<void>}={opened:0,dispatched:0,errors:[]};
 env.deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:{async open(input){
  control.opened++;await control.beforeOpen?.();input.guard();let context:any;
  const driver=scriptedAgent(async()=>{await control.hold;input.guard();return (env.models.respond.delivery??plainDraft)(draftTask(context.sections));},async()=>{await control.beforeDraft?.();input.guard();},(name,data)=>{if(name==='read_business'){context=data;control.business=data;}if(name==='tool_error')control.errors.push(data);});
  const session=await driver.open(input);return {...session,async run(prompt){input.guard();control.dispatched++;return session.run(prompt);}};
 }}});
 return {...env,control};
}
export async function waitNativeDraft(env:Business,runId:string):Promise<any>{await waitForAgentWork(env.store,runId);return (await env.call('venture.delivery.list')).find((run:any)=>run.id===runId);}
export async function readyNativeDraft(env:Business,request='Please look at my pricing for the new product line and advise.',offerId='offer_1'):Promise<any>{const order=await env.call('venture.order.create',{clientId:env.client.id,offerId,request});const run=await env.call('venture.delivery.run',{orderId:order.id});return waitNativeDraft(env,run.id);}
