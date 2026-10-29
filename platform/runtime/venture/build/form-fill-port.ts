// Original trusted worker/main channel. Private proxy capabilities and one-use physical verification never enter renderer IPC.
import {randomUUID} from 'node:crypto';
import {check,ChausarError} from '../../portable.ts';
import {createFormsTunnel,type FormsTunnel} from './form-fill-network.ts';
import type {FormsBrowserPort} from '../playbooks/data-entry-desk/browser-types.ts';
export type {FormsOpen,FormsBrowserPort} from '../playbooks/data-entry-desk/browser-types.ts';
type Channel={connected?:boolean;send?:(message:unknown,callback?:(error:Error|null)=>void)=>boolean;on(event:'message'|'disconnect',listener:(message:unknown)=>void):unknown;off?(event:'message'|'disconnect',listener:(message:unknown)=>void):unknown};
type Session={runId:string;guard:()=>void;signal:AbortSignal;abort:()=>void;tunnel:FormsTunnel};
type Waiting={runId:string;op:string;settle:(error:Error|null,result?:unknown)=>void;beforeSend?:()=>void;verified:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const error=()=>new ChausarError('FORM_BROWSER_CLOSED','The client browser is unavailable. Check any uncertain submission manually.');
export function processFormsPort(channel:Channel,options:{timeoutMs?:number;createTunnel?:typeof createFormsTunnel}={}):FormsBrowserPort{
 let session:Session|null=null,generation=0;const waiting=new Map<string,Waiting>();const timeoutMs=options.timeoutMs??35000;
 const send=(message:unknown,fail?:()=>void)=>{try{if(!channel.connected||!channel.send){fail?.();return;}channel.send(message,issue=>{if(issue)fail?.();});}catch{fail?.();}};
 const current=(runId:string)=>{check(session?.runId===runId&&!session.signal.aborted&&channel.connected===true,'FORM_BROWSER_CLOSED','Open the current approved client browser.');session.guard();return session;};
 async function close(runId?:string,preserveGeneration=false){
  const old=session;if(runId!==undefined&&old?.runId!==runId)return;if(!preserveGeneration)generation++;if(!old)return;session=null;old.signal.removeEventListener('abort',old.abort);
  for(const [id,row] of waiting)if(row.runId===old.runId){waiting.delete(id);row.settle(error());}
  send({kind:'host-forms',callId:randomUUID(),runId:old.runId,op:'close',payload:{}});await old.tunnel.close();
 }
 function call(runId:string,op:string,payload:unknown,beforeSend?:()=>void):Promise<unknown>{
  let active:Session;try{active=current(runId);}catch(issue){return Promise.reject(issue);}
  return new Promise((resolve,reject)=>{
   const callId=randomUUID(),timer=setTimeout(()=>{if(waiting.delete(callId)){reject(error());void close(runId);}},timeoutMs);
   const row:Waiting={runId,op,verified:false,beforeSend,settle:(issue,result)=>{clearTimeout(timer);if(issue)reject(issue);else resolve(result);}};
   waiting.set(callId,row);
   try{active.guard();send({kind:'host-forms',callId,runId,op,payload},()=>{if(waiting.delete(callId))row.settle(error());void close(runId);});}catch(issue){waiting.delete(callId);row.settle(issue instanceof Error?issue:error());}
  });
 }
 const onMessage=(message:unknown)=>{
  if(!object(message))return;
  if(message.kind==='host-forms-closed'&&Object.keys(message).length===1){void close();return;}
  if(message.kind==='host-forms-verify'){
   if(Object.keys(message).sort().join(',')!=='callId,kind,verificationId'||typeof message.callId!=='string'||typeof message.verificationId!=='string'||message.verificationId.length>100)return;
   const row=waiting.get(message.callId);if(!row||row.op!=='submit')return;let authorized=false;
   if(!row.verified){row.verified=true;try{current(row.runId);check(row.beforeSend,'FORM_ACTION_HELD','This submit has no current owner decision.');row.beforeSend();authorized=true;}catch{/* exact refusal only, no source or secret text on the host channel */}}
   send({kind:'host-forms-verified',callId:message.callId,verificationId:message.verificationId,authorized});return;
  }
  if(message.kind!=='host-forms-result'||typeof message.callId!=='string'||typeof message.ok!=='boolean'||Object.keys(message).some(key=>!['kind','callId','ok','result','code'].includes(key)))return;
  const row=waiting.get(message.callId);if(!row)return;waiting.delete(message.callId);
  if(message.ok!==true){row.settle(new ChausarError(typeof message.code==='string'&&/^FORM_[A-Z_]{1,60}$/.test(message.code)?message.code:'FORM_BROWSER_CLOSED','The browser action stopped. Review its current state.'));return;}
  try{if(row.op!=='eraseSignIns')current(row.runId);row.settle(null,message.result);}catch(issue){row.settle(issue instanceof Error?issue:error());}
 };
 const disconnected=()=>{void close();};channel.on('message',onMessage);channel.on('disconnect',disconnected);
 return {
  async open(input,guard,signal){
   const attempt=++generation;await close(undefined,true);guard();check(attempt===generation&&!signal.aborted&&channel.connected===true&&typeof input.runId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(input.runId),'FORM_BROWSER_CLOSED','Open the current approved client browser.');
   const tunnel=await (options.createTunnel??createFormsTunnel)({origin:input.origin,current:()=>{try{guard();return !signal.aborted;}catch{return false;}},signal});
   let owned:Session|null=null;
   try{guard();check(attempt===generation&&!signal.aborted,'FORM_BROWSER_CLOSED','This client browser approval ended.');const abort=()=>{void close(input.runId);};owned={runId:input.runId,guard,signal,abort,tunnel};session=owned;signal.addEventListener('abort',abort,{once:true});
    return await call(input.runId,'open',{runId:input.runId,origin:input.origin,url:input.url,...(input.savedSignInId?{savedSignInId:input.savedSignInId}:{}),proxy:{port:tunnel.port,proxyUrl:tunnel.proxyUrl,username:tunnel.username,password:tunnel.password,realm:tunnel.realm}});
   }catch(issue){if(owned&&session===owned)await close(input.runId);else await tunnel.close();throw issue;}
  },
  async eraseSignIns(ids){
   check(Array.isArray(ids)&&ids.length<=1000&&ids.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id))&&new Set(ids).size===ids.length,'FORM_ACTION_HELD','Use only the forgotten client partition identities.');await close();
   const result=await new Promise<unknown>((resolve,reject)=>{const callId=randomUUID(),timer=setTimeout(()=>{if(waiting.delete(callId))reject(error());},timeoutMs);const row:Waiting={runId:'privacy',op:'eraseSignIns',verified:false,settle:(issue,value)=>{clearTimeout(timer);if(issue)reject(issue);else resolve(value);}};waiting.set(callId,row);send({kind:'host-forms',callId,runId:'privacy',op:'eraseSignIns',payload:{ids}},()=>{if(waiting.delete(callId))row.settle(error());});});
   check(object(result)&&Object.keys(result).join(',')==='erased'&&Array.isArray(result.erased)&&JSON.stringify(result.erased)===JSON.stringify(ids),'FORM_PRIVACY_PENDING','The desktop has not confirmed saved sign-in deletion.');
  },
  navigate:(runId,input)=>call(runId,'navigate',input),
  capture:runId=>call(runId,'capture',{}),fill:(runId,input)=>call(runId,'fill',input),prepare:(runId,input)=>call(runId,'prepare',input),submit:(runId,input,beforeSend)=>call(runId,'submit',input,beforeSend),readSaved:runId=>call(runId,'readSaved',{}),close,
 };
}
