// Trusted host relay tests. Renderer-shaped messages never enter this private channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFormsRelay}=require('../../app/desktop/owner-browser-relay.cjs');
const call={kind:'host-forms',callId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),runId:'entry_1',op:'submit',payload:{handle:'private_handle',digest:'b'.repeat(64)}};
function fixture(){const harness=new EventEmitter(),sent:any[]=[];const child={connected:true,send:(message:any)=>{sent.push(message);}};const relay=createFormsRelay(harness,child,{timeoutMs:100});return {harness,sent,child,relay};}
test('R2 host relay requires a strict trusted command and answers once without echoing secret payloads',async()=>{
 const f=fixture();try{let calls=0;f.harness.on('forms',(request:any,answer:Function)=>{calls++;assert.equal(request.op,'submit');answer({ok:true,result:{status:'not-sent'}});answer({ok:true,result:{status:'made-up'}});});f.relay.receive({...call,id:'renderer-request'});f.relay.receive({...call,payload:{handle:'x'},extra:true});assert.equal(calls,0);f.relay.receive(call);assert.equal(calls,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].result.status,'not-sent');assert.doesNotMatch(JSON.stringify(f.sent),/private_handle/);}finally{f.relay.close();}
});
test('R2 host verification is exact-call correlated, single use and refuses wrong nonces',async()=>{
 const f=fixture();let verify:Function,answer:Function;try{f.harness.on('forms',(_request:any,respond:Function,check:Function)=>{verify=check;answer=respond;});f.relay.receive(call);const pending=verify!();const question=f.sent.at(-1);assert.equal(question.kind,'host-forms-verify');f.relay.receive({kind:'host-forms-verified',callId:call.callId,verificationId:'wrong',authorized:true});f.relay.receive({kind:'host-forms-verified',callId:call.callId,verificationId:question.verificationId,authorized:true});await pending;await assert.rejects(verify!(),{code:'FORM_ACTION_HELD'});answer!({ok:true,result:{status:'response-received'}});assert.equal(f.sent.at(-1).kind,'host-forms-result');}finally{f.relay.close();}
});
test('R2 closing the trusted host channel rejects pending physical verification',async()=>{
 const f=fixture();let verify:Function;f.harness.on('forms',(_request:any,_answer:Function,check:Function)=>verify=check);f.relay.receive(call);const pending=verify!();const rejected=assert.rejects(pending,{code:'FORM_BROWSER_CLOSED'});f.relay.close();await rejected;
});
