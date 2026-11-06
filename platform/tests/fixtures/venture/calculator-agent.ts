import { scriptedAgent, SCRIPTED_AGENT_SETTINGS, type ScriptedToolCall } from './scripted-agent.ts';
import type { VentureDeps, DeliveryRunRecord } from '../../../runtime/venture/contracts.ts';
import { findRecord } from '../../../runtime/venture/records.ts';

export const calculatorEvents = new WeakMap<VentureDeps,{name:string;data:any}[]>();
export type CalculatorStep = { calls: { tool: string; input: string }[] };
/** A fixture calls the real scoped MCP calculators, then uses their real receipt references. */
export function calculatorAgent(deps: VentureDeps, steps: readonly CalculatorStep[], draft: unknown, observe?:(name:string,data:any)=>void,beforeDraft?:()=>Promise<void>) {
 calculatorEvents.set(deps,[]);
 const inspect=(name:string,data:any)=>{calculatorEvents.get(deps)!.push({name,data});observe?.(name,data);};
 deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:scriptedAgent(()=>draft,beforeDraft,inspect,async(call:ScriptedToolCall)=>{
  const aliases:Record<string,string>={}; let receiptNumber=0;
  for(const step of steps)for(const request of step.calls){
   const args=JSON.parse(request.input);
   if(request.tool==='files.read') { const files=await call('list_files'); const file=files.files?.[Number(String(args.file??args.table??'f1').match(/\d+/)?.[0]??1)-1];if(file)await call('read_file',{fileId:file.id,offset:0,limit:12000});continue; }
   if(request.tool==='files.list'){await call('list_files');continue;}
   const result=await call('calculate',{operation:request.tool.replaceAll('.','_').replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),arguments:args});
   for(const receipt of result.receipts){receiptNumber++;for(const figure of result.refs.figures.filter((row:any)=>row.receiptId===receipt.id))aliases[`w${receiptNumber}.${figure.figureKey}`]=figure.ref;}
  }
  return aliases;
 })});
}
export function calculatorRun(deps:VentureDeps,id:string):DeliveryRunRecord {const run=findRecord(deps.store.read(),'venture-delivery-run',id);if(!run)throw new Error('Missing fixture run');return run;}
