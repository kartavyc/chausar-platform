'use strict';
// Original private worker/main relay. This is not a renderer IPC method and never publishes credentials as events.
const {randomUUID}=require('node:crypto');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const failure=code=>Object.assign(new Error('The current owner browser verification is unavailable.'),{code});
function createFormsRelay(harness,child,{timeoutMs=5000}={}){
 const calls=new Map();let closed=false;
 const send=message=>{if(!closed&&child.connected)try{child.send(message,()=>{});}catch{/* worker disconnect ends the pending action */}};
 function finish(row,reply){
  if(row.answered)return;row.answered=true;calls.delete(row.callId);if(row.pending){clearTimeout(row.pending.timer);row.pending.reject(failure('FORM_BROWSER_CLOSED'));row.pending=null;}
  let result={kind:'host-forms-result',callId:row.callId,ok:false,code:'FORM_BROWSER_CLOSED'};
  try{if(reply?.ok===true&&JSON.stringify(reply.result).length<=9000000)result={kind:'host-forms-result',callId:row.callId,ok:true,result:reply.result};else if(typeof reply?.code==='string'&&/^FORM_[A-Z_]{1,60}$/.test(reply.code))result.code=reply.code;}catch{}
  send(result);
 }
 return {
  receive(message){
   if(closed||!object(message)||Object.hasOwn(message,'id'))return;
   if(message.kind==='host-forms-verified'){
    if(Object.keys(message).sort().join(',')!=='authorized,callId,kind,verificationId'||typeof message.authorized!=='boolean')return;
    const row=calls.get(message.callId),pending=row?.pending;if(!pending||pending.id!==message.verificationId)return;
    clearTimeout(pending.timer);row.pending=null;if(message.authorized)pending.resolve();else pending.reject(failure('FORM_ACTION_HELD'));return;
   }
   if(message.kind!=='host-forms'||Object.keys(message).sort().join(',')!=='callId,kind,op,payload,runId'||typeof message.callId!=='string'||!/^[a-f0-9-]{36}$/.test(message.callId)||typeof message.runId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(message.runId)||!['open','navigate','capture','fill','prepare','submit','readSaved','close','eraseSignIns'].includes(message.op)||typeof message.op!=='string'||!object(message.payload))return;
   if(calls.has(message.callId))return;
   let encoded;try{encoded=JSON.stringify(message.payload);}catch{return;}if(encoded.length>1000000)return;
   const row={callId:message.callId,answered:false,verified:false,pending:null};calls.set(row.callId,row);
   const answer=reply=>finish(row,reply);
   const verify=()=>new Promise((resolve,reject)=>{
    if(closed||row.answered||row.verified||message.op!=='submit'||!child.connected){reject(failure('FORM_ACTION_HELD'));return;}row.verified=true;
    const id=randomUUID(),timer=setTimeout(()=>{if(row.pending?.id===id){row.pending=null;reject(failure('FORM_BROWSER_CLOSED'));}},timeoutMs);
    row.pending={id,timer,resolve,reject};send({kind:'host-forms-verify',callId:row.callId,verificationId:id});
   });
   if(harness.listenerCount('forms')===0){answer(null);return;}
   try{harness.emit('forms',Object.freeze({runId:message.runId,op:message.op,payload:JSON.parse(encoded)}),answer,verify);}catch{answer(null);}
  },
  close(){if(closed)return;closed=true;for(const row of calls.values())finish(row,null);calls.clear();},
 };
}
module.exports=Object.freeze({createFormsRelay});
