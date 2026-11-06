'use strict';
// Main-process sequencing for the private forms relay. Close interrupts rather than waiting behind a submit.
const {createOwnerBrowser}=require('./owner-browser.cjs');
const failure=()=>Object.assign(new Error('Review the current client browser action.'),{code:'FORM_ACTION_HELD'});
function createFormsHost(deps){
 let active=null,currentCall=null,generation=0,browserEpoch=0,queue=Promise.resolve();
 const live=(runId,epoch)=>active?.runId===runId&&active.epoch===epoch&&generation===epoch;
 const browser=(deps.createBrowser??createOwnerBrowser)({...deps,current:runId=>live(runId,browserEpoch),beforeSubmit:async proof=>{
  const call=currentCall;
  if(!call||call.request.op!=='submit'||!live(proof.runId,call.epoch)||call.request.runId!==proof.runId||call.request.payload.handle!==proof.handle||call.request.payload.digest!==proof.digest||typeof call.verify!=='function')throw failure();
  await call.verify();if(currentCall!==call||!live(proof.runId,call.epoch))throw failure();
 }});
 async function close(){generation++;active=null;currentCall=null;await browser.close();}
 return {
  handle(request,answer,verify){
   if(!request||typeof request.runId!=='string'||!['open','navigate','capture','fill','prepare','submit','readSaved','close','eraseSignIns'].includes(request.op)){answer({ok:false,code:'FORM_ACTION_HELD'});return;}
   if(request.op==='eraseSignIns'){
    const ids=request.payload?.ids;if(!request.payload||Object.keys(request.payload).join(',')!=='ids'||!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))){answer({ok:false,code:'FORM_ACTION_HELD'});return;}
    const stopped=close();queue=queue.catch(()=>{}).then(async()=>{try{await stopped;answer({ok:true,result:await browser.eraseSignIns(ids)});}catch{answer({ok:false,code:'FORM_BROWSER_CLOSED'});}});return;
   }
   if(request.op==='close'){
    if(active?.runId!==request.runId){answer({ok:true,result:{closed:true}});return;}
    void close().then(()=>answer({ok:true,result:{closed:true}}),()=>answer({ok:false,code:'FORM_BROWSER_CLOSED'}));return;
   }
   let epoch=active?.epoch;
   if(request.op==='open'){
    if(request.payload?.runId!==request.runId){answer({ok:false,code:'FORM_ACTION_HELD'});return;}
    epoch=++generation;active={runId:request.runId,epoch};
   }
   queue=queue.catch(()=>{}).then(async()=>{
    if(!live(request.runId,epoch)){answer({ok:false,code:'FORM_BROWSER_CLOSED'});return;}
    const call={request,verify,epoch};currentCall=call;
    try{
     let result;
     if(request.op==='open'){browserEpoch=epoch;result=await browser.open(request.payload);}
     else if(request.op==='capture'||request.op==='readSaved')result=await browser[request.op]();
     else result=await browser[request.op](request.payload);
     if(!live(request.runId,epoch))throw failure();answer({ok:true,result});
    }catch(error){answer({ok:false,code:typeof error?.code==='string'?error.code:'FORM_BROWSER_CLOSED'});}
    finally{if(currentCall===call)currentCall=null;}
   });
  },
  close,
 };
}
module.exports=Object.freeze({createFormsHost});
