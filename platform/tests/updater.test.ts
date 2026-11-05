import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink, realpath, stat } from 'node:fs/promises';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { ReleaseUpdater, canonicalReleaseManifest, canonicalReleaseFeed, compareVersions, installIdIn, rolloutBucket, type ReleaseManifest } from '../runtime/updater.ts';
import { acquireProcessLock } from '../runtime/process-lock.ts';
import { noNet } from './helpers/no-net.ts';

test.beforeEach(t => noNet(t));

const keys=generateKeyPairSync('ed25519'),artifact=Buffer.from('A test artifact; this file must never be executed.');
const code=(expected:string)=>(error:any)=>error.code===expected;
function manifest(version='1.1.0'):ReleaseManifest{return{schemaVersion:1,version,publishedAt:'2026-09-01T00:00:00.000Z',platform:process.platform as any,architecture:process.arch as any,url:'https://downloads.example.com/chausar.pkg',sha256:createHash('sha256').update(artifact).digest('hex'),size:artifact.length,minEngineVersion:'1.0.0',dataSchemaVersion:1,rollback:{supported:true,requiresBackup:true}};}
function signature(value:ReleaseManifest){return sign(null,Buffer.from(canonicalReleaseManifest(value)),keys.privateKey).toString('base64url');}
async function directory(t:any){const path=await mkdtemp(join(await realpath(tmpdir()),'chausar-updater-test-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
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
  await Promise.all([first,others]);assert.equal(calls,1);assert.ok(errors.every(error=>error.code==='UPDATE_BUSY'));
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

// C5 task 30: the signed feed. One file lists the releases, signed whole with the same pinned key; the app picks this
// platform's newest release and offers it only to installs whose bucket is below the rollout percent.
type FeedRelease={manifest:ReleaseManifest;signature:string};
function feedOf(releases:ReleaseManifest[],extra:Partial<{channel:'beta'|'stable';rolloutPercent:number;expiresAt:string}>={}){return{schemaVersion:1 as const,channel:extra.channel??'beta',rolloutPercent:extra.rolloutPercent??100,expiresAt:extra.expiresAt??'2099-01-01T00:00:00.000Z',releases:releases.map(manifest=>({manifest,signature:signature(manifest)})) as FeedRelease[]};}
function feedSignature(feed:any,key=keys.privateKey){return sign(null,Buffer.from(canonicalReleaseFeed(feed)),key).toString('base64url');}
const otherPlatform=(process.platform==='win32'?'linux':'win32') as ReleaseManifest['platform'];

test('a signed feed offers this platform\'s newest release',async t=>{
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:await directory(t)});
  const feed=feedOf([manifest('1.1.0'),manifest('1.2.0'),{...manifest('1.3.0'),platform:otherPlatform}]);
  const choice=updater.verifyFeed(canonicalReleaseFeed(feed),feedSignature(feed),{channel:'beta',installId:'a'.repeat(32)});
  assert.equal(choice.reason,'offered');assert.equal(choice.offer?.manifest.version,'1.2.0');
  assert.equal(updater.verify(choice.offer!.manifest,choice.offer!.signature).version,'1.2.0');
});

test('a changed byte, another key, a channel mismatch or a bad release signature refuses the whole feed',async t=>{
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:await directory(t)}),options={channel:'beta' as const,installId:'b'.repeat(32)};
  const feed=feedOf([manifest('1.1.0')]),signed=feedSignature(feed),text=canonicalReleaseFeed(feed);
  assert.throws(()=>updater.verifyFeed(text.replace('"rolloutPercent":100','"rolloutPercent":99'),signed,options),code('INVALID_FEED_SIGNATURE'));
  assert.throws(()=>updater.verifyFeed(JSON.stringify(feed,null,2),signed,options),code('NONCANONICAL_FEED'));
  const other=generateKeyPairSync('ed25519');assert.throws(()=>updater.verifyFeed(text,feedSignature(feed,other.privateKey),options),code('INVALID_FEED_SIGNATURE'));
  assert.throws(()=>updater.verifyFeed(text,signed,{...options,channel:'stable'}),code('FEED_CHANNEL_MISMATCH'));
  const forged={...feed,releases:[{manifest:{...manifest('1.1.0'),size:artifact.length+1},signature:signature(manifest('1.1.0'))}]};
  assert.throws(()=>updater.verifyFeed(forged,feedSignature(forged),options),code('INVALID_RELEASE_SIGNATURE'));
  for(const bad of [{...feed,extra:1},{...feed,schemaVersion:2},{...feed,rolloutPercent:101},{...feed,rolloutPercent:1.5},{...feed,channel:'nightly'},{...feed,releases:[]}])
    assert.throws(()=>updater.verifyFeed(bad as any,feedSignature(bad),options),code('INVALID_FEED'));
});

test('a downgrade or another platform\'s release is never offered',async t=>{
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.2.0',stageDirectory:await directory(t)}),options={channel:'beta' as const,installId:'c'.repeat(32)};
  for(const feed of [feedOf([manifest('1.1.0')]),feedOf([manifest('1.2.0')])]){const choice=updater.verifyFeed(feed,feedSignature(feed),options);assert.equal(choice.offer,null);assert.equal(choice.reason,'up-to-date');}
  const elsewhere=feedOf([{...manifest('1.3.0'),platform:otherPlatform}]),choice=updater.verifyFeed(elsewhere,feedSignature(elsewhere),options);
  assert.equal(choice.offer,null);assert.equal(choice.reason,'no-release');
  const needsNewer=feedOf([{...manifest('1.3.0'),minEngineVersion:'1.2.5'}]),blocked=updater.verifyFeed(needsNewer,feedSignature(needsNewer),options);
  assert.equal(blocked.offer,null);assert.equal(blocked.reason,'no-release');
});

test('rollout 0 offers nothing, 100 offers it, and 50 gives one install the same answer every time',async t=>{
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:await directory(t)});
  const at=(percent:number,installId:string)=>{const feed=feedOf([manifest('1.1.0')],{rolloutPercent:percent});return updater.verifyFeed(feed,feedSignature(feed),{channel:'beta',installId});};
  assert.equal(at(0,'d'.repeat(32)).reason,'not-in-rollout');assert.equal(at(100,'d'.repeat(32)).reason,'offered');
  const ids=Array.from({length:400},(_,index)=>createHash('sha256').update(String(index)).digest('hex').slice(0,32));
  const first=ids.map(id=>at(50,id).reason),again=ids.map(id=>at(50,id).reason);assert.deepEqual(again,first);
  const offered=first.filter(reason=>reason==='offered').length;assert.ok(offered>140&&offered<260,`${offered} of 400 in a 50 percent rollout`);
  for(const id of ids.slice(0,50))assert.equal(rolloutBucket(id,'1.1.0'),rolloutBucket(id,'1.1.0'));
  assert.ok(ids.every(id=>{const bucket=rolloutBucket(id,'1.1.0');return Number.isInteger(bucket)&&bucket>=0&&bucket<100;}));
});

test('the install id is random, made once and kept in the updates folder',async t=>{
  const folder=join(await directory(t),'updates'),first=await installIdIn(folder);
  assert.match(first,/^[a-f0-9]{32}$/);assert.equal(await installIdIn(folder),first);assert.equal((await readFile(join(folder,'install-id'),'utf8')).trim(),first);
  const other=join(await directory(t),'updates');assert.notEqual(await installIdIn(other),first);
  await writeFile(join(other,'install-id'),'not an id');const replaced=await installIdIn(other);assert.match(replaced,/^[a-f0-9]{32}$/);assert.equal(await installIdIn(other),replaced);
});

// C5 task 31, the stage half: the download streams to a part file with a running SHA-256, so the body is never held in
// memory; the cap is the signed size with a 512 MiB ceiling; a cut download resumes with a Range request; a hash
// mismatch deletes the part file. Every download here is a stand-in that answers in this process.
type Download=(request:{url:string;headers:Record<string,string>;idleTimeoutMs:number;redirect:'error'})=>Promise<{status:number;url?:string;headers?:Record<string,string>;body:AsyncIterable<Uint8Array>}>;
function sized(size:number,version:string,sha256:string):ReleaseManifest{return{...manifest(version),size,sha256};}
function patterned(size:number){const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*31+7)&255;return bytes;}
async function*chunks(bytes:Buffer,step=65536){for(let at=0;at<bytes.length;at+=step)yield bytes.subarray(at,at+step);}

test('a 300 MB release streams to disk under the new ceiling without holding the body in memory',{timeout:120000},async t=>{
  const size=300_000_000,step=1024*1024,zero=Buffer.alloc(step),hash=createHash('sha256');
  for(let left=size;left>0;left-=step)hash.update(left>=step?zero:zero.subarray(0,left));
  v8.setFlagsFromString('--expose_gc');const gc=runInNewContext('gc') as ()=>void;gc();
  const base=process.memoryUsage().arrayBuffers;let peak=0,calls=0;
  const download:Download=async request=>{calls++;assert.equal(request.redirect,'error');assert.equal(request.headers.Range,undefined);return{status:200,url:request.url,body:(async function*(){for(let left=size,index=0;left>0;left-=step,index++){if(index%32===0){gc();peak=Math.max(peak,process.memoryUsage().arrayBuffers-base);}yield Buffer.alloc(Math.min(step,left));}})()};};
  const stageDirectory=await directory(t),release=sized(size,'1.1.0',hash.digest('hex'));
  const staged=await new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download}).stage(release,signature(release));
  assert.equal(calls,1);assert.equal((await stat(staged.artifactPath)).size,size);
  assert.ok(peak<64*1024*1024,`the stager held ${Math.round(peak/1048576)} MiB of the body`);
  assert.ok(!(await readdir(stageDirectory)).some(name=>name.endsWith('.part')));
  const tooBig={...release,size:512*1024*1024+1};assert.throws(()=>new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory}).verify(tooBig,signature(tooBig)),code('INVALID_MANIFEST'));
});

test('a download cut at half resumes from where it stopped with a Range request',async t=>{
  const bytes=patterned(1_000_003),half=500_000,release=sized(bytes.length,'1.1.0',createHash('sha256').update(bytes).digest('hex')),stageDirectory=await directory(t);
  const requests:Record<string,string>[]=[];
  const cut:Download=async request=>{requests.push(request.headers);return{status:200,url:request.url,body:(async function*(){yield bytes.subarray(0,half);throw Object.assign(new Error('socket hang up'),{code:'ECONNRESET'});})()};};
  await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:cut}).stage(release,signature(release)),code('RELEASE_DOWNLOAD_CUT'));
  const names=await readdir(stageDirectory);assert.ok(!names.includes('pending-release.json'));
  const part=names.find(name=>name.endsWith('.part'))!;assert.equal((await stat(join(stageDirectory,part))).size,half);
  const resume:Download=async request=>{requests.push(request.headers);const from=Number(/^bytes=(\d+)-$/.exec(request.headers.Range)![1]);return{status:206,url:request.url,headers:{'content-range':`bytes ${from}-${bytes.length-1}/${bytes.length}`},body:chunks(bytes.subarray(from))};};
  const staged=await new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:resume}).stage(release,signature(release));
  assert.equal(requests[0].Range,undefined);assert.equal(requests[1].Range,`bytes=${half}-`);
  assert.deepEqual(await readFile(staged.artifactPath),bytes);assert.ok(!(await readdir(stageDirectory)).some(name=>name.endsWith('.part')));
});

test('a server that ignores the Range request starts the file again, and a wrong range is refused',async t=>{
  const bytes=patterned(200_000),release=sized(bytes.length,'1.1.0',createHash('sha256').update(bytes).digest('hex')),stageDirectory=await directory(t);
  const cut:Download=async request=>({status:200,url:request.url,body:(async function*(){yield bytes.subarray(0,1000);throw new Error('cut');})()});
  await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:cut}).stage(release,signature(release)),code('RELEASE_DOWNLOAD_CUT'));
  const lying:Download=async request=>({status:206,url:request.url,headers:{'content-range':`bytes 0-${bytes.length-1}/${bytes.length}`},body:chunks(bytes)});
  await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:lying}).stage(release,signature(release)),code('RELEASE_FETCH_REFUSED'));
  const whole:Download=async request=>({status:200,url:request.url,body:chunks(bytes)});
  const staged=await new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:whole}).stage(release,signature(release));
  assert.deepEqual(await readFile(staged.artifactPath),bytes);
});

test('a hash mismatch, a short body or an overlong body deletes the part file and publishes nothing',async t=>{
  const bytes=patterned(300_000),release=sized(bytes.length,'1.1.0',createHash('sha256').update(bytes).digest('hex'));
  const wrong=Buffer.from(bytes);wrong[1234]^=1;
  for(const body of [wrong,bytes.subarray(0,1000),Buffer.concat([bytes,Buffer.from('extra')])]){
    const stageDirectory=await directory(t),download:Download=async request=>({status:200,url:request.url,body:chunks(body)});
    await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download}).stage(release,signature(release)),code('RELEASE_HASH_MISMATCH'));
    assert.deepEqual(await readdir(stageDirectory),[]);
  }
  const stageDirectory=await directory(t),cut:Download=async request=>({status:200,url:request.url,body:(async function*(){yield wrong.subarray(0,2000);throw new Error('cut');})()});
  await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:cut}).stage(release,signature(release)),code('RELEASE_DOWNLOAD_CUT'));
  const rest:Download=async request=>({status:206,url:request.url,headers:{'content-range':`bytes 2000-${bytes.length-1}/${bytes.length}`},body:chunks(bytes.subarray(2000))});
  await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:rest}).stage(release,signature(release)),code('RELEASE_HASH_MISMATCH'));
  assert.deepEqual(await readdir(stageDirectory),[]);
});

// Fix round 1 (review MEDIUM-1): a server that never stops sending is cut at the signed size. The stand-in would send ten
// times the size; the stager asks for at most one chunk past it, the part file never grows past the size, and none is left.
test('an endless body stops at the signed size, never grows the part file past it, and leaves no part file',async t=>{
  const bytes=patterned(200_000),release=sized(bytes.length,'1.1.0',createHash('sha256').update(bytes).digest('hex')),stageDirectory=await directory(t),step=16384;
  let asked=0,largestPart=0;
  const endless:Download=async request=>({status:200,url:request.url,body:(async function*(){
    for(let index=0;index<Math.ceil(bytes.length*10/step);index++){
      const part=(await readdir(stageDirectory)).find(name=>name.endsWith('.part'));
      if(part)largestPart=Math.max(largestPart,(await stat(join(stageDirectory,part))).size);
      asked+=step;yield Buffer.alloc(step,7);
    }
  })()});
  await assert.rejects(new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory,download:endless}).stage(release,signature(release)),code('RELEASE_HASH_MISMATCH'));
  assert.ok(asked<=bytes.length+step,`the stager asked for ${asked} bytes of a ${bytes.length} byte release`);
  assert.ok(largestPart<=bytes.length,`the part file grew to ${largestPart} bytes`);
  assert.deepEqual(await readdir(stageDirectory),[]);
});

// Fix round 1 (review LOW-2): the feed carries a signed expiry. An old feed replayed after it expires is refused, so a
// replay cannot hide a newer release for longer than one feed's life.
test('an expired feed is refused, and the expiry is part of what is signed',async t=>{
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:'1.0.0',stageDirectory:await directory(t)}),options={channel:'beta' as const,installId:'f'.repeat(32)};
  const feed=feedOf([manifest('1.1.0')],{expiresAt:'2026-12-01T00:00:00.000Z'}),signed=feedSignature(feed);
  assert.equal(updater.verifyFeed(feed,signed,{...options,now:new Date('2026-11-30T23:59:59.000Z')}).reason,'offered');
  assert.throws(()=>updater.verifyFeed(feed,signed,{...options,now:new Date('2026-12-01T00:00:00.000Z')}),(error:any)=>error.code==='FEED_EXPIRED'&&/clock/.test(error.message));
  assert.throws(()=>updater.verifyFeed({...feed,expiresAt:'2099-01-01T00:00:00.000Z'},signed,options),code('INVALID_FEED_SIGNATURE'));
  const {expiresAt:_dropped,...noExpiry}=feed;assert.throws(()=>updater.verifyFeed(noExpiry as any,feedSignature(noExpiry),options),code('INVALID_FEED'));
  const loose={...feed,expiresAt:'2099-01-01'};assert.throws(()=>updater.verifyFeed(loose,feedSignature(loose),options),code('INVALID_FEED'));
});
