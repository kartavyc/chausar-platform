import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {EngineHarness}=require('../../app/desktop/engine-harness.cjs');
test('R2 real desktop harness carries the private forms command and correlated verification, never renderer IPC',async()=>{
 const sent:any[]=[];const child=Object.assign(new EventEmitter(),{connected:true,send:(value:any,callback?:Function)=>{sent.push(value);callback?.();},kill:()=>{}});
 const harness=new EngineHarness({workerPath:'/owned/worker.ts',environment:{},forkProcess:()=>child});let verify:Function|undefined,answer:Function|undefined,received=0;
 harness.on('forms',(_request:any,respond:Function,check:Function)=>{received++;verify=check;answer=respond;});const starting=harness.start();child.emit('message',{ready:true});await starting;
 try{const callId='a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12);child.emit('message',{kind:'host-forms',callId,runId:'entry_1',op:'submit',payload:{handle:'one',digest:'exact'}});assert.equal(received,1);const checking=verify!();const message=sent.at(-1);child.emit('message',{kind:'host-forms-verified',callId,verificationId:message.verificationId,authorized:true});await checking;answer!({ok:true,result:{status:'not-sent'}});assert.equal(sent.at(-1).kind,'host-forms-result');harness.closeForms();assert.deepEqual(sent.at(-1),{kind:'host-forms-closed'});await assert.rejects(harness.request('host.forms.verify',{}),{code:'INVALID_REQUEST'});}finally{child.emit('exit',0,null);}
});
