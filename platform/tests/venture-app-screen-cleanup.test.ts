// Review regression: opaque cleanup authority survives a failed delete, restart and Forget.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {appAndroid} from '../runtime/venture/playbooks/app-testing/runtime.ts';
import {listRecords,ventureAction} from '../runtime/venture/records.ts';
import {clearForgottenAppTests} from '../runtime/venture/playbooks/app-testing/privacy.ts';
async function fixture(){const e=await kitBusiness(),calls:string[][]=[];let fail=true;e.deps.android={locate:()=>'/adb',run:async(_binary,args)=>{calls.push([...args]);const c=args.slice(2).join(' ');return{ok:!(fail&&c.startsWith('shell rm ')),line:'',stdout:c==='get-state'?'device':c==='shell getprop ro.kernel.qemu'?'1':c==='shell dumpsys account'?'Accounts: 0':c.startsWith('shell cat ')?'<hierarchy><node text="Private client screen" /></hierarchy>':'Success'};}};return{e,calls,api:()=>appAndroid(e.deps,owner),pending:()=> (listRecords(e.store.read(),'venture-record')[0] as any).appTestScreenErasure??[],allow(){fail=false;}};}
test('failed screen deletion is persisted and a new adapter cannot dump again until exact cleanup succeeds',async()=>{
 const f=await fixture();await assert.rejects(()=>f.api().inspect('emulator-5554'),{code:'ANDROID_COMMAND_FAILED'});
 const pending=f.pending();assert.equal(pending.length,1);assert.deepEqual(Object.keys(pending[0]).sort(),['path','serial']);assert.ok(!JSON.stringify(pending).includes('Private client'));
 const dumps=()=>f.calls.filter(a=>a.includes('dump')).length;assert.equal(dumps(),1);
 await assert.rejects(()=>f.api().inspect('emulator-5554'));assert.equal(dumps(),1);
 f.allow();await f.api().inspect('emulator-5554');assert.equal(dumps(),2);assert.deepEqual(f.pending(),[]);
 assert.ok(f.calls.filter(a=>a.includes('rm')&&a.at(-1)===pending[0].path).length>=3);
});
test('Forget retains an honest pending screen deletion and retries it without retaining the client source',async()=>{
 const f=await fixture();await assert.rejects(()=>f.api().inspect('emulator-5554'));
 const {CONTACTS,net}=await import('./venture-network-env.ts');await net(f.e,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:CONTACTS});const person=listRecords(f.e.store.read(),'venture-person').find(p=>p.name==='Asha Rao')!;
 await ventureAction(f.e.deps,owner,'approve','fixture.screen-client',tx=>tx.replace({...tx.find('venture-person',person.id)!,clientId:f.e.client.id}));
 const result=await net(f.e,'venture.network.forget',{id:person.id});assert.match(String((result as {line:string}).line),/deletion is still pending/);assert.equal(f.pending().length,1);
 f.allow();assert.equal(await clearForgottenAppTests(f.e.deps,owner),true);assert.deepEqual(f.pending(),[]);
});
