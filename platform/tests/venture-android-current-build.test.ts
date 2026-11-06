import {fakeScreenCleanup} from './fixtures/venture/android-screen-cleanup.ts';
// Independent review regressions: installed bytes and transient screen evidence must match the approved client test.
import test from 'node:test';import assert from 'node:assert/strict';
import {AndroidTestPort} from '../runtime/venture/build/android.ts';import {digest} from '../runtime/portable.ts';
const serial='emulator-5554',path='/data/app/owned/client/base.apk',sha='a'.repeat(64),identity={packageName:'com.example.demo',apkSha256:sha},xml='<hierarchy><node text="Client test screen" /></hierarchy>';
function fixture(options:{changed?:boolean;split?:boolean;changeDuringLogs?:boolean;screen?:'held'|'cat-failed'|'dump-failed'|'cleanup-failed'}={}){
 const calls:string[][]=[];let hash=options.changed?'b'.repeat(64):sha;
 const api=new AndroidTestPort({locate:()=>'/adb',run:async(_binary,args)=>{
  calls.push([...args]);const cmd=args.slice(2).join(' ');
  if(cmd.startsWith('logcat')&&options.changeDuringLogs)hash='b'.repeat(64);
  const ok=!(options.screen==='cat-failed'&&cmd.startsWith('shell cat ')||options.screen==='dump-failed'&&cmd.startsWith('shell uiautomator dump ')||options.screen==='cleanup-failed'&&cmd.startsWith('shell rm '));
  return{ok,line:'',stdout:cmd==='get-state'?'device':cmd==='shell getprop ro.kernel.qemu'?'1':cmd==='shell dumpsys account'?'Accounts: 0':cmd.startsWith('shell cat ')?options.screen==='held'?'<hierarchy><node password="true" /></hierarchy>':xml:cmd.startsWith('shell pm path')?'package:'+path+(options.split?'\npackage:/data/app/owned/client/split.apk':''):cmd.startsWith('shell sha256sum')?hash+'  '+path:cmd.startsWith('shell am start')?'Status: ok':cmd.startsWith('logcat')?'FATAL EXCEPTION: main':'Success'};
 }},fakeScreenCleanup());return{api,calls};
}
for(const operation of ['launch','tap','logs'] as const)test('a replaced installed APK cannot supply '+operation+' evidence',async()=>{
 const f=fixture({changed:true});
 const action=()=>operation==='launch'?f.api.launch(serial,{...identity,component:'com.example.demo/.Main'},()=>{}):operation==='tap'?f.api.tap(serial,{...identity,x:1,y:2,screenDigest:digest(xml)},()=>{}):f.api.logs(serial,identity);
 await assert.rejects(action,{code:'APPROVAL_STALE'});
 assert.ok(!f.calls.some(a=>a.includes('start')||a.includes('tap')||a.includes('logcat')));
});
test('a package changed during log collection cannot be attributed to the approved build',async()=>{const f=fixture({changeDuringLogs:true});await assert.rejects(()=>f.api.logs(serial,identity),{code:'APPROVAL_STALE'});});
test('split installed packages refuse without launching',async()=>{const f=fixture({split:true});await assert.rejects(()=>f.api.launch(serial,{...identity,component:'com.example.demo/.Main'},()=>{}),{code:'APPROVAL_STALE'});assert.ok(!f.calls.some(a=>a.includes('start')));});
for(const screen of [undefined,'held','cat-failed','dump-failed'] as const)test('screen XML is removed after '+(screen??'successful read'),async()=>{
 const f=fixture({screen});if(screen)await assert.rejects(()=>f.api.inspect(serial));else await f.api.inspect(serial);
 const dumped=f.calls.find(a=>a.includes('dump'))?.at(-1);assert.ok(dumped);
 assert.deepEqual(f.calls.at(-1),['-s',serial,'shell','rm','-f','--',dumped]);
});
test('inspection does not report success if its private screen file could not be removed',async()=>{const f=fixture({screen:'cleanup-failed'});await assert.rejects(()=>f.api.inspect(serial),{code:'ANDROID_COMMAND_FAILED'});});
