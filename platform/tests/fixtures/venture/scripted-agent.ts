import {connect} from 'node:net';
import {createInterface} from 'node:readline';
import {ChausarError,type Context} from '../../../runtime/contracts.ts';
import {MCP_PROTOCOL_VERSION} from '../../../runtime/mcp.ts';
import type {AgentDriver} from '../../../runtime/venture/agent-runtime/driver-types.ts';
import type {VentureDeps} from '../../../runtime/venture/contracts.ts';
import {getClientAiConsent,agreeClientAiConsent} from '../../../runtime/venture/clients/ai-consent.ts';
import {findRecord} from '../../../runtime/venture/records.ts';

export type ScriptedToolCall = (name:string,args?:unknown)=>Promise<any>;
/** Synthetic test agent, using the production broker and scoped tools. It never sends anything. */
export function scriptedAgent(nextDraft:(signal?:AbortSignal)=>unknown|Promise<unknown>,beforeDraft?:()=>void|Promise<void>,observe?:(name:string,data:unknown)=>void,work?:(call:ScriptedToolCall)=>Promise<Record<string,string>|void>):AgentDriver {
 return {async open(input){
  const socket=connect(input.mcp.env.CHAUSAR_AGENT_MCP_SOCKET),lines=createInterface({input:socket}),replies=lines[Symbol.asyncIterator]();let id=0;
  const send=async(body:unknown)=>{socket.write(JSON.stringify(body)+'\n');const line=await replies.next();if(line.done)throw new Error('Synthetic MCP connection closed');return JSON.parse(line.value);};
  await send({token:input.mcp.env.CHAUSAR_AGENT_MCP_TOKEN});
  await send({jsonrpc:'2.0',id:++id,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'synthetic-test-agent',version:'1'}}});
  socket.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const call=async(name:string,args:unknown={})=>{input.guard();const toolUseId='synthetic-tool-'+(id+1);input.onEvent({type:'tool-started',toolUseId,name});try{const reply=await send({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}});if(reply.error)throw new ChausarError(reply.error.data.code,reply.error.message);if(reply.result.isError)throw new Error(reply.result.content[0].text);const data=reply.result.structuredContent.data;observe?.(name,data);input.onEvent({type:'tool-completed',toolUseId,name,failed:false});return data;}catch(error){observe?.('tool_error',{name,message:error instanceof Error?error.message:String(error)});input.onEvent({type:'tool-completed',toolUseId,name,failed:true});throw error;}};
  return {async run(){
   await call('read_business');const client=await call('read_client');await call('read_order');
   const price=await call('calculate',{operation:'order_price',arguments:{}}),aliases=await work?.(call),draft=structuredClone(await nextDraft(input.signal)) as any;
   // Old recorded drafts name logical order figures. Bind them to this run's actual calculator references.
   for(const section of draft?.sections??[])for(const part of section.parts??[])if(part.kind==='figure'&&typeof part.ref==='string'&&part.ref.startsWith('order.')){const figure=price.refs.figures.find((figure:any)=>figure.figureKey===part.ref.slice(6));if(figure)part.ref=figure.ref;}
   for(const section of draft?.sections??[])for(const part of section.parts??[])if(part.kind==='figure'&&aliases?.[part.ref])part.ref=aliases[part.ref];
   await beforeDraft?.();input.guard();
   const saved=await call('draft_document',{draft});
   await call('propose_action',{kind:'send-handoff',draftId:saved.draftId,draftDigest:saved.digest,to:client.email,subject:'Draft for review'});
   return {status:'completed' as const,text:'Synthetic checked draft ready for owner review.'};
  },async interrupt(){socket.destroy();},async close(){lines.close();socket.destroy();}};
 }};
}

/** Explicit test consent for this order only, never a global fixture grant. */
export async function consentForOrder(deps:VentureDeps,ctx:Context,orderId:string):Promise<void> {
 const order=findRecord(deps.store.read(),'venture-order',orderId);if(!order)throw new Error('Fixture order missing');
 const permission=await getClientAiConsent(deps,ctx,{clientId:order.clientId});
 await agreeClientAiConsent(deps,ctx,{clientId:order.clientId,disclosureDigest:permission.disclosureDigest});
}
export const SCRIPTED_AGENT_SETTINGS={model:'synthetic-tool-agent',effort:'high' as const,autoReview:true,network:false,webSearch:false,shell:false};
