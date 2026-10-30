import { check, type Context, type StateStore } from '../../contracts.ts';
import { canonical, digest } from '../../actions.ts';
import { MCPService, validateMCPArguments, type RegisteredMCPTool } from '../../mcp.ts';
import type { Deliverable, ServiceType, DateOrder, OrderIntake, ScreenNote, DeliveryRunRecord } from '../contracts.ts';
import type { jobContext } from './job-context.ts';
import { modelWords, copiedTokens } from '../records.ts';
import { validateDraft, renderDeliverable, deliverySchema, type AnyReceipt, type DraftRefs, type DraftTimes } from '../delivery/deliverable.ts';
import { runChecks } from '../delivery/checks.ts';
import { JobCapability } from './scope.ts';
import { redactPayload } from '../core/secrets.ts';
import type { AgentJobScope } from './driver-types.ts';
import { checkJobDraftNumbers } from './draft-provenance.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { screenJobOutput } from './output-screen.ts';

export type JobFile = {id:string;ventureId:string;orderId:string;name:string;mediaType:string;bytes:number;digest:string};
/** The host projects these fields from current state. No vault records or paths leave this boundary. */
export type JobSnapshot = {
  business:{id:string;name:string;serviceType:ServiceType;dateOrder:DateOrder;revision?:{words:string;previousDraft:string}|null} & Partial<ReturnType<typeof jobContext>>;
  client:{id:string;ventureId:string;name:string;email:string;taxId?:string|null};
  order:{id:string;ventureId:string;clientId:string;request:string;status:string;intake?:OrderIntake|null;chainStage?:number|null};
  files:JobFile[]; sections:string[]; dates:DraftRefs['dates'];
};
export type JobDraft = {deliverable:Deliverable;renderedText:string;receiptIds:string[];digest:string};
export type JobProposal = {kind:'send-handoff';transport:'copy'|'email-handoff';draftId:string;draftDigest:string;to:string;subject:string;body:string;receiptIds:string[]};
export type JobCalculation = {name:string;description:string;inputSchema:Record<string,unknown>};
export type JobCalculationResult = { result: unknown; receipts: AnyReceipt[] };
export type JobToolPorts = {
  recordScreen?:(scope:Readonly<AgentJobScope>,tool:string,note:ScreenNote,context:Readonly<Context>)=>Promise<void>;
  recordContextRead?:(scope:Readonly<AgentJobScope>,snapshot:JobSnapshot,context:Readonly<Context>)=>Promise<void>;
  readSnapshot:(scope:Readonly<AgentJobScope>,context:Readonly<Context>)=>JobSnapshot | Promise<JobSnapshot>;
  readFile:(scope:Readonly<AgentJobScope>,file:JobFile,page:{offset:number;limit:number},context:Readonly<Context>)=>Promise<{text:string;nextOffset:number|null}>;
  calculations:JobCalculation[];
  calculate:(scope:Readonly<AgentJobScope>,input:{operation:string;arguments:Record<string,unknown>},context:Readonly<Context>)=>Promise<JobCalculationResult>;
  /** Return only a currently valid, source-checked receipt. Missing, changed or revoked sources return null. */
  readReceipt:(scope:Readonly<AgentJobScope>,id:string,context:Readonly<Context>)=>AnyReceipt|null|Promise<AnyReceipt|null>;
  /** Apply an existing host preservation rule before checks, rendering and digest binding. */
  prepareDraft?:(scope:Readonly<AgentJobScope>,draft:Deliverable,context:Readonly<Context>)=>Deliverable|Promise<Deliverable>;
  /** Mutating ports must also authorize within their storage transaction. */
  saveDraft:(scope:Readonly<AgentJobScope>,draft:JobDraft,context:Readonly<Context>)=>Promise<{draftId:string;digest:string}&Pick<DeliveryRunRecord,'checks'|'playbookChecks'>>;
  propose:(scope:Readonly<AgentJobScope>,proposal:JobProposal,context:Readonly<Context>)=>Promise<{cardId:string;digest:string}>;
};
const object = (properties:Record<string,unknown>={},required=Object.keys(properties)) => ({type:'object',additionalProperties:false,properties,required});
const str = {type:'string',maxLength:2000};

export function createJobMCP(store:StateStore, capability:JobCapability, ports:JobToolPorts, extraTools:RegisteredMCPTool[]=[]):MCPService {
  const {scope,context}=capability;
  const receipts=new Map<string,AnyReceipt>();
  const calculatorEvidence=new Map<string,string>();
  let chapterTimes:DraftTimes|null=null;
  const drafts=new Map<string,{draft:JobDraft;receipts:AnyReceipt[]}>();
  const calculations=new Map(ports.calculations.map(item=>[item.name,item]));
  check(calculations.size===ports.calculations.length && ports.calculations.every(item=>/^[a-z][a-z0-9_]{0,63}$/.test(item.name) && item.inputSchema.type==='object' && item.inputSchema.additionalProperties===false),'INVALID_MCP_TOOL','Register each job calculation with a unique name and closed schema.');
  async function snapshot():Promise<JobSnapshot> {
    const data=await capability.guard(()=>ports.readSnapshot(scope,context));
    check(data.business.id===scope.ventureId && data.client.id===scope.clientId && data.client.ventureId===scope.ventureId && data.order.id===scope.orderId && data.order.ventureId===scope.ventureId && data.order.clientId===scope.clientId,'JOB_SCOPE_CHANGED','The job no longer matches this client and order.');
    check(data.files.every(file=>file.ventureId===scope.ventureId && file.orderId===scope.orderId),'JOB_FILE_FORBIDDEN','A file does not belong to this order.');
    return structuredClone(data);
  }
  function boundReceipt(receipt:AnyReceipt):void {
    check(receipt.ventureId===scope.ventureId && receipt.memberId===scope.memberId && receipt.epoch===scope.epoch,'RECEIPT_FORBIDDEN','The receipt belongs to another job.');
    if(receipt.kind==='venture-price-receipt') check(!receipt.stale && receipt.subject.type==='order' && receipt.subject.orderId===scope.orderId,'UNVERIFIED_NUMBER','Use a current price receipt for this order.');
    else check(receipt.kind==='venture-work-receipt' && receipt.runRef.kind==='delivery' && receipt.runRef.runId===scope.runId,'RECEIPT_FORBIDDEN','Use a calculation from this delivery run.');
  }
  async function currentReceipt(receipt:AnyReceipt):Promise<AnyReceipt> {
    boundReceipt(receipt);
    const stored=await capability.guard(()=>ports.readReceipt(scope,receipt.id,context));
    check(stored && canonical(stored)===canonical(receipt),'UNVERIFIED_NUMBER','The calculation changed. Calculate it again before drafting.');
    boundReceipt(stored); return structuredClone(stored);
  }
  function refs(data:JobSnapshot, pending:AnyReceipt[]=[]):DraftRefs {
    const available=new Map([...receipts,...pending.map(receipt=>[receipt.id,receipt] as const)]);
    return {dates:data.dates,figures:[...available.values()].flatMap(receipt=>receipt.figures.map(figure=>({ref:`${receipt.id}.${figure.key}`,label:figure.label,receiptId:receipt.id,figureKey:figure.key})))};
  }
  async function screenedOutput(name:string,value:unknown):Promise<unknown>{
    const setting=screenSettingOf(store.read(),scope.ventureId);
    const screened=screenJobOutput(name,value,setting);
    for(const note of screened.notes)await capability.guard(async()=>{await ports.recordScreen?.(scope,name,note,context);});
    check(screened.value!==null,'SCREEN_FAILED','This content is held by your untrusted-content screen. Review the source before starting again.');
    return screened.value;
  }
  const register=(name:string,description:string,inputSchema:Record<string,unknown>,readOnly:boolean,call:RegisteredMCPTool['call']):RegisteredMCPTool=>({name,description,inputSchema,readOnly,call:async(...args)=>{
    const value=await call(...args);
    // Calculations screen before granting any draft authority from their result.
    return readOnly && name!=='calculate' ? screenedOutput(name,value) : value;
  }});
  const tools:RegisteredMCPTool[]=[
    register('read_business','Read this job business and the required draft structure.',object(),true,async()=>{
      const data=await snapshot();const {id,name,serviceType,dateOrder,offer,workInstructions,style,approvedBrief,revision,playbookEvidence,notes,knowledge}=data.business;
      await capability.guard(async () => { await ports.recordContextRead?.(scope,data,context); });
      return redactPayload({id,name,serviceType,dateOrder,offer,workInstructions,style,approvedBrief,revision,playbookEvidence,notes,knowledge,sections:data.sections,draftSchema:deliverySchema(serviceType,data.sections),calculations:ports.calculations});
    }),
    register('read_client','Read only the client assigned to this job.',object(),true,async()=>{
      const {id,name,email,taxId}= (await snapshot()).client;return redactPayload({id,name,email,...(taxId===undefined?{}:{taxId}),handoff:email?'email-handoff':'copy'});
    }),
    register('read_order','Read only the order assigned to this job.',object(),true,async()=>{
      const {id,clientId,request,status,intake,chainStage}= (await snapshot()).order;return redactPayload({id,clientId,request,status,intake:intake??null,chainStage:chainStage??null});
    }),
    register('list_files','List files attached to this order. No paths or other clients are exposed.',object(),true,async()=>({files:(await snapshot()).files.map(({id,name,mediaType,bytes,digest:fileDigest},index)=>redactPayload({id,name,mediaType,bytes,digest:fileDigest,calculatorAlias:`f${index+1}`}))})),
    register('read_file','Read a bounded text page from an attached job file.',object({fileId:str,offset:{type:'integer'},limit:{type:'integer'}}),true,async args=>{
      const data=await snapshot();const file=data.files.find(item=>item.id===args.fileId);
      check(file,'JOB_FILE_FORBIDDEN','This file is not attached to this order.');
      const offset=args.offset as number,limit=args.limit as number;
      check(offset>=0 && limit>0 && limit<=16000,'INVALID_ARGUMENTS','Use a nonnegative offset and a page of at most sixteen thousand characters.');
      const page=await capability.guard(()=>ports.readFile(scope,file,{offset,limit},context));
      check(typeof page.text==='string' && page.text.length<=limit && (page.nextOffset===null || Number.isSafeInteger(page.nextOffset) && page.nextOffset>offset),'INVALID_JOB_FILE','The file reader returned an invalid page.');
      const latest=(await snapshot()).files.find(item=>item.id===file.id);
      check(latest?.digest===file.digest,'JOB_FILE_CHANGED','The attached file changed. Read it again.');
      return redactPayload({fileId:file.id,digest:file.digest,...page});
    }),
    register('search_records','Search this job business, client, order and file names only.',object({query:{type:'string',maxLength:200}}),true,async args=>{
      const data=await snapshot();const query=(args.query as string).trim().toLowerCase();check(query.length>0,'INVALID_ARGUMENTS','Enter words to find in this job.');
      const rows=[{kind:'business',id:data.business.id,text:data.business.name},{kind:'client',id:data.client.id,text:data.client.name},{kind:'order',id:data.order.id,text:data.order.request},...data.files.map(file=>({kind:'file',id:file.id,text:file.name}))];
      return redactPayload({matches:rows.filter(row=>row.text.toLowerCase().includes(query)).slice(0,20).map(row=>({...row,text:row.text.slice(0,1000)}))});
    }),
    register('calculate',`Run a registered job calculator. Available operations: ${ports.calculations.map(item=>`${item.name}: ${item.description}`).join('; ')}.`,object({operation:{type:'string',enum:[...calculations.keys()]},arguments:{type:'object'}}),true,async args=>{
      await snapshot();const calculation=calculations.get(args.operation as string);check(calculation,'UNKNOWN_CALCULATION','This calculation is not available for this job.');
      const input=validateMCPArguments(calculation.inputSchema,args.arguments);
      const evidenceId=digest({operation:calculation.name,input});
      calculatorEvidence.delete(evidenceId);
      if(calculation.name==='youtube_chapters')chapterTimes=null;
      const result=await capability.guard(()=>ports.calculate(scope,{operation:calculation.name,arguments:input},context));
      const checked=await Promise.all(result.receipts.map(currentReceipt));
      for(const receipt of checked)receipts.delete(receipt.id);
      const data=await snapshot();
      const exposed=await screenedOutput('calculate',{result:redactPayload(result.result),receipts:checked,refs:refs(data,checked)}) as {result:unknown;receipts:unknown;refs:unknown};
      for(const receipt of checked)receipts.set(receipt.id,receipt);
      if(exposed.result && typeof exposed.result==='object' && 'ok' in exposed.result && exposed.result.ok===true && 'result' in exposed.result) calculatorEvidence.set(evidenceId,JSON.stringify(exposed.result.result));
      if(calculation.name==='youtube_chapters'){
        chapterTimes=null;
        const outcome=exposed.result as {ok?:boolean;result?:{chapters?:{at?:unknown}[]}}|null;
        if(outcome?.ok===true && Array.isArray(outcome.result?.chapters)){
          const codes=outcome.result.chapters.map(chapter=>chapter.at);
          if(codes.length && codes.every((code):code is string=>typeof code==='string'&&/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(code))) chapterTimes={heading:'Description and chapters',codes};
        }
      }
      return exposed;
    }),
    register('draft_document','Save a draft using words and calculator figure references. Numbers without receipts are refused. Read the returned checks and playbookChecks; repair failed checks and core notChecked checks before proposing. Playbook not-run results disclose checks that did not apply or could not run; they are not passes.',object({draft:{type:'object'}}),false,async args=>{
      const data=await snapshot();const current=await Promise.all([...receipts.values()].map(currentReceipt));
      const calculated=[...calculatorEvidence].map(([id,text])=>({id:'calculator.'+id,text}));
      const source=[data.order.request,...calculated.map(item=>item.text)].join('\n');
      const codeSources=[...checkJobDraftNumbers(args.draft,source,chapterTimes),...calculated],allowed=copiedTokens(source);
      let deliverable=validateDraft(args.draft,{serviceType:data.business.serviceType,sections:data.sections,refs:refs(data),allowed,times:chapterTimes});
      if(ports.prepareDraft)deliverable=await capability.guard(()=>ports.prepareDraft!(scope,structuredClone(deliverable),context));
      const renderedText=renderDeliverable(deliverable,current,data.business);
      const fileReferences=data.files.map(({id,name,digest})=>({id,name,digest}));
      const checks=runChecks({checks:['no-numeric-prose','figures-resolve','required-sections','receipts'],deliverable,renderedText,serviceType:data.business.serviceType,sections:data.sections,allowed,receipts:current,ventureId:scope.ventureId,mocks:[],mockModes:{},agentTurns:1,turnLimit:1,askedQuestions:deliverable.questionsForClient.length>0,estimates:'forbid',times:chapterTimes,grounding:{clientRequest:data.order.request,codeSources,fileReferences}});
      const failed=checks.find(item=>!item.passed || item.notChecked);
      check(!failed,'DRAFT_CHECK_FAILED',failed?.detail ?? 'The draft needs corrections before it can be saved.');
      const receiptIds=[...new Set(deliverable.sections.flatMap(section=>section.parts.flatMap(part=>part.kind==='figure'?[part.receiptId]:[])))];
      const content={deliverable,renderedText,receiptIds};const saved:JobDraft={...content,digest:digest({scope,...content})};
      const result=await capability.guard(()=>ports.saveDraft(scope,structuredClone(saved),context));
      check(result.digest===saved.digest && typeof result.draftId==='string' && result.draftId.length>0,'DRAFT_CHANGED','The saved draft did not match the checked content.');
      drafts.set(result.draftId,{draft:saved,receipts:current.filter(receipt=>receiptIds.includes(receipt.id))});return result;
    }),
    register('propose_action','Propose this exact saved draft for owner-reviewed handoff. This never sends. Use the client email exactly, or an empty to value for copy-only when the client has no email.',object({kind:{type:'string',enum:['send-handoff']},draftId:str,draftDigest:str,to:str,subject:{type:'string',maxLength:120}}),false,async args=>{
      const data=await snapshot();const held=drafts.get(args.draftId as string);const saved=held?.draft;
      check(saved && args.draftDigest===saved.digest,'DRAFT_CHANGED','Use the exact saved draft returned by this job.');
      check(args.to===data.client.email,'JOB_RECIPIENT_FORBIDDEN','Propose a handoff only to this client.');
      const subject=modelWords(args.subject,'subject',120,{numbers:'refuse'});
      await Promise.all(held!.receipts.map(currentReceipt));
      return capability.guard(()=>ports.propose(scope,{kind:'send-handoff',transport:data.client.email?'email-handoff':'copy',draftId:args.draftId as string,draftDigest:saved.digest,to:data.client.email,subject,body:saved.renderedText,receiptIds:[...saved.receiptIds]},context));
    }),
  ];
  return new MCPService(store,{calculations:[],tools:[...tools,...extraTools],authorize:ctx=>{
    check(ctx.memberId===context.memberId && ctx.epoch===context.epoch && ctx.role===context.role,'JOB_SCOPE_CHANGED','This job belongs to another signed-in workspace.');capability.assert();
  }});
}
