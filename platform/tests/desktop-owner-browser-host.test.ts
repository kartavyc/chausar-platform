// Original host lifecycle and exact-command tests, with no real browser effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFormsHost}=require('../../app/desktop/owner-browser-host.cjs');
function fixture(){let guard:any,closed=0,submitted=0;const host=createFormsHost({createBrowser:(deps:any)=>{guard=deps;return {open:async()=>({opened:true}),close:async()=>{closed++;},capture:async()=>({pageHash:'page'}),submit:async(body:any)=>{await deps.beforeSubmit({runId:'entry_1',...body});submitted++;return {status:'response-received'};}};},window:()=>({})});const act=(op:string,payload:any={},runId='entry_1',verify:()=>Promise<void>=async()=>{})=>new Promise<any>(resolve=>host.handle({runId,op,payload},resolve,verify));return {host,act,guard:()=>guard,closed:()=>closed,submitted:()=>submitted};}
test('R2 desktop host binds physical verifier to the exact active submission and blocks stale runs',async()=>{
 const f=fixture();try{await f.act('open',{runId:'entry_1'});let verified=0;const reply=await f.act('submit',{handle:'one',digest:'exact'},'entry_1',async()=>{verified++;});assert.equal(reply.ok,true);assert.equal(verified,1);assert.equal(f.submitted(),1);assert.equal((await f.act('capture',{},'other')).ok,false);await assert.rejects(f.guard().beforeSubmit({runId:'entry_1',handle:'one',digest:'exact'}),{code:'FORM_ACTION_HELD'});}finally{await f.host.close();}
});
test('R2 close interrupts an in-flight physical verification and prevents the pending write',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);try{await f.act('open',{runId:'entry_1'});const pending=f.act('submit',{handle:'one',digest:'exact'},'entry_1',async()=>{entered();await waiting;});await started;await f.host.close();release();const reply=await pending;assert.equal(reply.ok,false);assert.equal(f.submitted(),0);}finally{release();await f.host.close();}
});
