// Original crash evidence checks. Only uploaded client logs, never invented findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLogcat, reviewedFindings} from '../runtime/venture/playbooks/app-testing/logcat.ts';

test('Java, ANR and native crashes retain source lines and the first matching app frame',()=>{
 const text=[
  'E AndroidRuntime: FATAL EXCEPTION: main',
  'E AndroidRuntime: Process: com.example.demo, PID: 1234',
  'E AndroidRuntime: java.lang.IllegalStateException: missing field',
  'E AndroidRuntime: at android.app.Activity.performCreate(Activity.java:8)',
  'E AndroidRuntime: at com.example.demo.MainActivity.onCreate(MainActivity.java:42)',
  'E ActivityManager: ANR in com.example.demo',
  'E ActivityManager: Reason: Input dispatching timed out',
  'F DEBUG: *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***',
  'F DEBUG: pid: 4567, tid: 4567, name: demo >>> com.example.demo <<<',
  'F DEBUG: signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)',
  'F DEBUG: #00 pc 00000001 /data/app/com.example.demo/lib/arm64/libdemo.so (run+1)',
 ].join('\n');
 const findings=parseLogcat(text,'com.example.demo');
 assert.deepEqual(findings.map(f=>f.kind),['java-crash','anr','native-crash']);
 assert.match(findings[0]!.appFrame!,/MainActivity.java:42/);
 assert.match(findings[2]!.appFrame!,/libdemo.so/);
 assert.equal(findings[1]!.startLine,6);
 assert.ok(findings.every(f=>f.review==='pending'&&f.sourceDigest.length===64));
 assert.throws(()=>reviewedFindings(findings,[]),{code:'FINDING_REVIEW_REQUIRED'});
 assert.equal(reviewedFindings(findings,findings.map(f=>({id:f.id,sourceDigest:f.sourceDigest,decision:'include' as const}))).length,3);
});

test('other apps and an unrelated frame are never reported as this client app',()=>{
 const text='FATAL EXCEPTION: main\nProcess: com.example.other, PID: 5\nat com.example.demo.Helper.call(Helper.java:2)\nANR in com.example.demo2\n';
 assert.deepEqual(parseLogcat(text,'com.example.demo'),[]);
});

test('review is bound to exact evidence, every finding and one decision per finding',()=>{
 const findings=parseLogcat('ANR in com.example.demo\nReason: waiting','com.example.demo'),f=findings[0]!;
 assert.throws(()=>reviewedFindings(findings,[{id:f.id,sourceDigest:'changed',decision:'include'}]),{code:'FINDING_REVIEW_REQUIRED'});
 assert.throws(()=>reviewedFindings(findings,[{id:f.id,sourceDigest:f.sourceDigest,decision:'include'},{id:f.id,sourceDigest:f.sourceDigest,decision:'exclude'}]),{code:'FINDING_REVIEW_REQUIRED'});
 assert.deepEqual(reviewedFindings(findings,[{id:f.id,sourceDigest:f.sourceDigest,decision:'exclude'}]),[]);
 assert.throws(()=>parseLogcat('x'.repeat(2_000_001),'com.example.demo'),{code:'INVALID_VENTURE_REQUEST'});
});
