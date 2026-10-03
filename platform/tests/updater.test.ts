import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { ReleaseUpdater, canonicalReleaseManifest, compareVersions, type ReleaseManifest } from '../runtime/updater.ts';
import { acquireProcessLock } from '../runtime/process-lock.ts';

const keys=generateKeyPairSync('ed25519'),artifact=Buffer.from('A test artifact; this file must never be executed.');
const code=(expected:string)=>(error:any)=>error.code===expected;
function manifest(version='1.1.0'):ReleaseManifest{return{schemaVersion:1,version,publishedAt:'2026-09-01T00:00:00.000Z',platform:process.platform as any,architecture:process.arch as any,url:'https://downloads.example.com/chausar.pkg',sha256:createHash('sha256').update(artifact).digest('hex'),size:artifact.length,minEngineVersion:'1.0.0',dataSchemaVersion:1,rollback:{supported:true,requiresBackup:true}};}
function signature(value:ReleaseManifest){return sign(null,Buffer.from(canonicalReleaseManifest(value)),keys.privateKey).toString('base64url');}
async function directory(t:any){
  const root=await realpath(tmpdir());if(process.platform==='win32')assert.match(root,/^C:[\\/]/i);
  const path=await mkdtemp(join(root,'chausar-updater-test-'));
  t.after(async()=>{const target=await realpath(path),child=relative(root,target);assert.ok(child.startsWith('chausar-updater-test-')&&!child.startsWith('..')&&!isAbsolute(child));await rm(target,{recursive:true,force:true});});
  return path;
}
function deadPid() {
  const child=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{windowsHide:true,shell:false,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const pid=Number(child.stdout);assert.throws(()=>process.kill(pid,0),(error:any)=>error.code==='ESRCH');return pid;
}

test('Ed25519 verifies the exact canonical payload and rejects mutation or another publisher',async t=>{
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:await directory(t)}),release=manifest(),signed=signature(release);
  assert.equal(updater.verify(canonicalReleaseManifest(release),signed).version,'1.1.0');
  assert.throws(()=>updater.verify({...release,size:release.size+1},signed),code('INVALID_RELEASE_SIGNATURE'));
  const other=generateKeyPairSync('ed25519');assert.throws(()=>updater.verify(release,sign(null,Buffer.from(canonicalReleaseManifest(release)),other.privateKey).toString('base64url')),code('INVALID_RELEASE_SIGNATURE'));
  assert.throws(()=>updater.verify(release,''),code('INVALID_RELEASE_SIGNATURE'));
  assert.throws(()=>updater.verify(JSON.stringify(release),signed),code('NONCANONICAL_MANIFEST'));
});

test('unknown fields, malformed timestamps, private URLs and non-Ed25519 keys are refused',async t=>{
  const stageDirectory=await directory(t),updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory}),release=manifest();
  assert.throws(()=>updater.verify({...release,execute:'rm everything'} as any,signature(release)),code('INVALID_MANIFEST'));
  const http={...release,url:'http://downloads.example.com/file'};assert.throws(()=>updater.verify(http,signature(http)),code('INVALID_RELEASE_URL'));
  const privateURL={...release,url:'https://127.0.0.1/file'};assert.throws(()=>updater.verify(privateURL,signature(privateURL)),code('INVALID_RELEASE_URL'));
  const rsa=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>new ReleaseUpdater({publicKey:rsa.publicKey,version:'1.0.0',stageDirectory}),code('INVALID_UPDATE_KEY'));
});

test('downgrades, incompatible engine and platform artifacts are rejected before network',async t=>{
  let calls=0;const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:await directory(t),http:async()=>{calls++;return{status:200,body:artifact};}});
  for(const release of [manifest('0.9.0'),manifest('1.0.0')])await assert.rejects(updater.stage(release,signature(release)),code('RELEASE_DOWNGRADE_REFUSED'));
  const incompatible={...manifest(),minEngineVersion:'2.0.0'};await assert.rejects(updater.stage(incompatible,signature(incompatible)),code('INCOMPATIBLE_ENGINE'));
  const platform={...manifest(),platform:process.platform==='win32'?'linux':'win32'} as ReleaseManifest;await assert.rejects(updater.stage(platform,signature(platform)),code('INCOMPATIBLE_PLATFORM'));
  assert.equal(calls,0);
});

test('staging verifies bytes, writes an atomic plan and requires a native installer and backup',async t=>{
  const stageDirectory=await directory(t),updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,http:async r=>{assert.equal(r.redirect,'error');assert.equal(r.maxBytes,artifact.length);return{status:200,url:r.url,body:artifact};}}),release=manifest();
  const staged=await updater.stage(release,signature(release));assert.deepEqual(await readFile(staged.artifactPath),artifact);assert.equal(staged.installed,false);assert.equal(staged.unsignedFallbackAllowed,false);assert.equal(staged.rollback.automatic,false);assert.equal(staged.rollback.requiresVaultBackup,true);
  assert.equal((updater as any).install,undefined);assert.equal((updater as any).execute,undefined);assert.ok(!(await readdir(stageDirectory)).some(name=>name.endsWith('.tmp')||name==='stage.lock'));
  const pending=JSON.parse(await readFile(join(stageDirectory,'pending-release.json'),'utf8'));assert.equal(pending.manifest.sha256,release.sha256);
});

test('corrupt, oversized, truncated and redirected downloads never publish a pending release',async t=>{
  for(const response of [{status:200,body:Buffer.from('wrong')},{status:200,body:Buffer.concat([artifact,Buffer.from('extra')])},{status:302,body:artifact},{status:200,url:'https://attacker.example.com/file',body:artifact}]){
    const stageDirectory=join(await directory(t),'stage'),updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,http:async()=>response}),release=manifest();
    await assert.rejects(updater.stage(release,signature(release)));
    assert.deepEqual(await readdir(stageDirectory),[]);
  }
});

test('a newer signed staged release prevents an older replay and altered artifacts are refused',async t=>{
  const stageDirectory=await directory(t),updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,http:async()=>({status:200,body:artifact})});
  const newer=manifest('1.2.0'),staged=await updater.stage(newer,signature(newer)),older=manifest('1.1.0');
  await assert.rejects(updater.stage(older,signature(older)),code('RELEASE_DOWNGRADE_REFUSED'));
  await writeFile(staged.artifactPath,'modified by attacker');await assert.rejects(updater.stage(newer,signature(newer)),code('UNSAFE_STAGE'));
});

test('semantic version ordering respects prereleases and does not compare versions as strings',()=>{
  assert.equal(compareVersions('1.10.0','1.2.0'),1);assert.equal(compareVersions('1.0.0','1.0.0-preview.9'),1);assert.equal(compareVersions('1.0.0-preview.10','1.0.0-preview.9'),1);assert.equal(compareVersions('1.0.0-1','1.0.0-a'),-1);
  assert.throws(()=>compareVersions('1.01.0','1.0.0'),code('INVALID_VERSION'));
});

test('a valid pending record from the previous engine does not block a newer release after upgrade',async t=>{
  const stageDirectory=await directory(t),older=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,http:async()=>({status:200,body:artifact})}),oldRelease=manifest('1.1.0');
  await older.stage(oldRelease,signature(oldRelease));
  const upgraded=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.1.0',stageDirectory,http:async()=>({status:200,body:artifact})}),newRelease=manifest('1.2.0');
  assert.equal((await upgraded.stage(newRelease,signature(newRelease))).manifest.version,'1.2.0');
});

test('staging refuses a symlink directory and concurrent staging lock',async t=>{
  const root=await directory(t),real=join(root,'real'),linked=join(root,'linked');await mkdir(real);
  try{await symlink(real,linked,process.platform==='win32'?'junction':'dir');}catch(error:any){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('Symlink creation unavailable in this environment.');return;}throw error;}
  const release=manifest(),updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:linked,http:async()=>({status:200,body:artifact})});await assert.rejects(updater.stage(release,signature(release)),code('UNSAFE_PATH'));
  await writeFile(join(real,'stage.lock'),'existing writer');const busy=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:real,http:async()=>({status:200,body:artifact})});await assert.rejects(busy.stage(release,signature(release)),code('UPDATE_BUSY'));
});

test('an abruptly killed staging process leaves recoverable complete owner metadata',{timeout:10000},async t=>{
  const stageDirectory=await directory(t),release=manifest(),moduleURL=new URL('../runtime/updater.ts',import.meta.url).href;
  const program=`import {ReleaseUpdater} from ${JSON.stringify(moduleURL)};setInterval(()=>{},1000);const updater=new ReleaseUpdater({publicKey:${JSON.stringify(keys.publicKey.export({format:'pem',type:'spki'}).toString())},version:'1.0.0',stageDirectory:${JSON.stringify(stageDirectory)},http:async()=>{process.stdout.write('READY\\n');return new Promise(()=>{});}});await updater.stage(${JSON.stringify(release)},${JSON.stringify(signature(release))});`;
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  await new Promise<void>((accept,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('READY\n'))accept();});child.once('error',reject);child.once('exit',()=>reject(new Error('Staging child exited before readiness.')));});
  const owner=JSON.parse(await readFile(join(stageDirectory,'stage.lock'),'utf8'));assert.equal(owner.pid,child.pid);assert.ok(owner.token&&owner.startedAt);
  const exited=once(child,'exit');assert.equal(child.kill('SIGKILL'),true);await exited;assert.throws(()=>process.kill(owner.pid,0),(error:any)=>error.code==='ESRCH');
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,http:async()=>({status:200,body:artifact})});assert.equal((await updater.stage(release,signature(release))).staged,true);
  assert.ok(!(await readdir(stageDirectory)).some(name=>name.endsWith('.lock')));
});

test('competing stale-lock recovery has exactly one writer and never removes its replacement',{timeout:10000},async t=>{
  const stageDirectory=await directory(t),release=manifest(),pid=deadPid();await writeFile(join(stageDirectory,'stage.lock'),JSON.stringify({pid,token:randomUUID(),startedAt:new Date().toISOString()}));
  let releaseHttp!:()=>void,entered!:()=>void,refused!:()=>void,calls=0;const errors:any[]=[];
  const gate=new Promise<void>(accept=>{releaseHttp=accept;}),first=new Promise<void>(accept=>{entered=accept;}),others=new Promise<void>(accept=>{refused=accept;});t.after(()=>releaseHttp());
  const attempts=Array.from({length:10},()=>new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,http:async()=>{calls++;entered();await gate;return{status:200,body:artifact};}}).stage(release,signature(release)).then(value=>({value}),error=>{errors.push(error);if(errors.length===9)refused();return{error};}));
  await Promise.all([first,others]);assert.equal(calls,1);assert.ok(errors.every(error=>error.code==='UPDATE_BUSY'),JSON.stringify(errors.map(error=>({code:error.code,message:error.message,stack:error.stack}))));
  const owner=JSON.parse(await readFile(join(stageDirectory,'stage.lock'),'utf8'));assert.equal(owner.pid,process.pid);releaseHttp();
  const results=await Promise.all(attempts);assert.equal(results.filter(result=>'value'in result).length,1);assert.ok(!(await readdir(stageDirectory)).some(name=>name.endsWith('.lock')));
});

test('live, permission-denied, oversized and malformed owner records are never reclaimed',async t=>{
  const root=await directory(t),path=join(root,'stage.lock'),busy={busyCode:'UPDATE_BUSY'},live={pid:process.pid,token:randomUUID(),startedAt:new Date().toISOString()};
  for(const raw of [JSON.stringify(live),'x'.repeat(4097),JSON.stringify({pid:0,token:randomUUID()}),'{broken',JSON.stringify({...live,extra:'instruction'})]){
    await writeFile(path,raw);await assert.rejects(acquireProcessLock(path,busy),code('UPDATE_BUSY'));assert.equal(await readFile(path,'utf8'),raw);
  }
  const pid=deadPid(),raw=JSON.stringify({pid,token:randomUUID()}),kill=process.kill;await writeFile(path,raw);
  process.kill=((target:any,signal:any)=>{if(target===pid)throw Object.assign(new Error('not permitted'),{code:'EPERM'});return kill.call(process,target,signal);}) as typeof process.kill;
  try{await assert.rejects(acquireProcessLock(path,busy),code('UPDATE_BUSY'));assert.equal(await readFile(path,'utf8'),raw);}finally{process.kill=kill;}
});

test('a crashed recovery claim advances safely and concurrent release is idempotent',async t=>{
  const root=await directory(t),path=join(root,'stage.lock'),pid=deadPid(),raw=JSON.stringify({pid,token:randomUUID()}),claim=join(root,`stage.lock.recovery-${createHash('sha256').update(raw).digest('hex')}.lock`);
  await writeFile(path,raw);await writeFile(claim,JSON.stringify({pid,token:randomUUID(),startedAt:new Date().toISOString()}));
  const lock=await acquireProcessLock(path,{busyCode:'UPDATE_BUSY'});assert.equal(JSON.parse(await readFile(path,'utf8')).token,lock.token);await Promise.all([lock.release(),lock.release()]);assert.deepEqual(await readdir(root),[]);
});
