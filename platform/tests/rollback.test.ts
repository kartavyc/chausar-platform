import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseUpdater, canonicalReleaseManifest, type ReleaseManifest, type PrepareRollbackOptions, type RollbackRestoreRequest, type RollbackRestoreResult } from '../runtime/updater.ts';
import { Vault } from '../runtime/vault.ts';

// Ephemeral synthetic signing keys and vault credentials only; no production release is created.
const keys=generateKeyPairSync('ed25519'),artifact=Buffer.from('An inert previous-package fixture. Never execute this file.'),passphrase='synthetic rollback fixture passphrase';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const code=(expected:string)=>(error:any)=>error.code===expected;
function release(version:string):ReleaseManifest {
  return {schemaVersion:1,version,publishedAt:'2026-09-01T00:00:00.000Z',platform:process.platform as ReleaseManifest['platform'],architecture:process.arch as ReleaseManifest['architecture'],url:'https://downloads.example.com/chausar.pkg',sha256:hash(artifact),size:artifact.length,minEngineVersion:'1.0.0',dataSchemaVersion:1,rollback:{supported:true,requiresBackup:true}};
}
const signature=(value:ReleaseManifest)=>sign(null,Buffer.from(canonicalReleaseManifest(value)),keys.privateKey).toString('base64url');
function result(request:RollbackRestoreRequest):RollbackRestoreResult {
  return {restored:true,fromManifestSha256:request.fromManifestSha256,toManifestSha256:request.toManifestSha256,artifactSha256:request.artifactSha256,backupSha256:request.backupSha256,...request.expectedVault,dataSchemaVersion:request.toManifest.dataSchemaVersion};
}
async function fixture(t:any) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'chausar-rollback-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {vault}=await Vault.create({directory:join(root,'source'),storage:'experimental-file',name:'Synthetic rollback workspace',passphrase,demo:true});
  await vault.update(state=>{state.decisions.push({id:'synthetic-decision',text:'Preserve the historical decision and receipt.'});state.receipts.push({id:'synthetic-receipt',value:'123.45'});});
  const state=vault.read(),backupPath=await vault.backup(join(root,'backup.json')),backupBytes=await readFile(backupPath),envelope=JSON.parse(backupBytes.toString('utf8')).envelope;await vault.close();
  const artifactPath=join(root,'previous.artifact');await writeFile(artifactPath,artifact);
  const current=release('2.0.0'),previous=release('1.1.0');previous.rollback.supported=false;
  let networkCalls=0;
  const updater=new ReleaseUpdater({publicKey:keys.publicKey,version:current.version,stageDirectory:join(root,'unused-stage'),http:async()=>{networkCalls++;throw new Error('Rollback qualification must not fetch anything.');}});
  const options:PrepareRollbackOptions={currentManifest:current,currentSignature:signature(current),previousManifest:previous,previousSignature:signature(previous),previousArtifactPath:artifactPath,backup:{path:backupPath,sha256:hash(backupBytes)},expectedVault:{vaultId:envelope.id,workspaceId:state.workspace.id,revision:state.revision},validateRestore:async request=>result(request)};
  return {root,updater,current,previous,options,state,backupBytes,networkCalls:()=>networkCalls};
}

test('rollback validates signed previous bytes and a real disposable encrypted restore without installing',async t=>{
  const f=await fixture(t);let called=0;
  f.options.validateRestore=async request=>{
    called++;assert.deepEqual(Buffer.from(request.artifactBytes),artifact);assert.equal(hash(request.backupBytes),request.backupSha256);
    assert.equal(request.toManifest.rollback.supported,false);assert.notEqual(request.expectedVault.vaultId,request.expectedVault.workspaceId);
    const copy=join(f.root,'validation-backup.json');await writeFile(copy,request.backupBytes);
    const restored=await Vault.restore({directory:join(f.root,'disposable-restore'),storage:'experimental-file',backupFile:copy,passphrase});
    try {
      const state=restored.read();assert.deepEqual(state,f.state);
      return {...result(request),workspaceId:state.workspace.id,revision:state.revision,dataSchemaVersion:state.schemaVersion};
    } finally {await restored.close();}
  };
  const before=await readFile(f.options.backup.path),plan=await f.updater.prepareRollback(f.options);
  assert.equal(called,1);assert.equal(f.networkCalls(),0);assert.equal(plan.fromVersion,'2.0.0');assert.equal(plan.toVersion,'1.1.0');
  assert.equal(plan.prepared,true);assert.equal(plan.installed,false);assert.equal(plan.automatic,false);assert.equal(plan.unsignedFallbackAllowed,false);
  assert.equal(plan.requiresNativeInstaller,true);assert.equal(plan.requiresInputRevalidation,true);assert.equal(plan.requiresExclusiveVaultLock,true);assert.equal(plan.requiresEffectReconciliation,true);assert.equal(plan.requiresUserApproval,true);
  assert.deepEqual(await readFile(f.options.backup.path),before);assert.ok(!(await readdir(f.root)).includes('unused-stage'));
  assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.backup)&&Object.isFrozen(plan.restore));
});

test('rollback refuses wrong current version, non-older targets and unsupported running releases',async t=>{
  const f=await fixture(t);let calls=0;f.options.validateRestore=async request=>{calls++;return result(request);};
  const wrong=release('2.0.1');await assert.rejects(f.updater.prepareRollback({...f.options,currentManifest:wrong,currentSignature:signature(wrong)}),code('ROLLBACK_VERSION_MISMATCH'));
  for(const version of ['2.0.0','2.1.0']){const target=release(version);await assert.rejects(f.updater.prepareRollback({...f.options,previousManifest:target,previousSignature:signature(target)}),code('INVALID_ROLLBACK_TARGET'));}
  const unsupported={...f.current,rollback:{supported:false,requiresBackup:true as const}};await assert.rejects(f.updater.prepareRollback({...f.options,currentManifest:unsupported,currentSignature:signature(unsupported)}),code('ROLLBACK_UNSUPPORTED'));
  assert.equal(calls,0);assert.equal(f.networkCalls(),0);
});

test('rollback authenticates both manifests, and rejects platform mismatch before restore',async t=>{
  const f=await fixture(t);let calls=0;f.options.validateRestore=async request=>{calls++;return result(request);};
  await assert.rejects(f.updater.prepareRollback({...f.options,currentSignature:'A'.repeat(86)}),code('INVALID_RELEASE_SIGNATURE'));
  await assert.rejects(f.updater.prepareRollback({...f.options,previousManifest:{...f.previous,size:f.previous.size+1}}),code('INVALID_RELEASE_SIGNATURE'));
  const other={...f.previous,platform:process.platform==='win32'?'linux':'win32'} as ReleaseManifest;
  await assert.rejects(f.updater.prepareRollback({...f.options,previousManifest:other,previousSignature:signature(other)}),code('INCOMPATIBLE_PLATFORM'));assert.equal(calls,0);
});

test('rollback refuses altered or oversized previous packages before trusted restore validation',async t=>{
  const f=await fixture(t);let calls=0;f.options.validateRestore=async request=>{calls++;return result(request);};
  const altered=Buffer.from(artifact);altered[0]^=1;await writeFile(f.options.previousArtifactPath,altered);
  await assert.rejects(f.updater.prepareRollback(f.options),code('ROLLBACK_ARTIFACT_MISMATCH'));
  await writeFile(f.options.previousArtifactPath,Buffer.concat([artifact,Buffer.from('extra')]));await assert.rejects(f.updater.prepareRollback(f.options),code('ROLLBACK_ARTIFACT_MISMATCH'));assert.equal(calls,0);
});

test('rollback requires a pinned encrypted backup for the expected vault and revision',async t=>{
  const f=await fixture(t);let calls=0;f.options.validateRestore=async request=>{calls++;return result(request);};
  await assert.rejects(f.updater.prepareRollback({...f.options,expectedVault:{...f.options.expectedVault,vaultId:'another_vault'}}),code('ROLLBACK_BACKUP_MISMATCH'));
  await assert.rejects(f.updater.prepareRollback({...f.options,expectedVault:{...f.options.expectedVault,revision:f.options.expectedVault.revision+1}}),code('ROLLBACK_BACKUP_MISMATCH'));
  await writeFile(f.options.backup.path,Buffer.concat([f.backupBytes,Buffer.from(' ')]));await assert.rejects(f.updater.prepareRollback(f.options),code('ROLLBACK_BACKUP_MISMATCH'));
  const plain=Buffer.from(JSON.stringify(f.state));await writeFile(f.options.backup.path,plain);
  await assert.rejects(f.updater.prepareRollback({...f.options,backup:{path:f.options.backup.path,sha256:hash(plain)}}),code('INVALID_ROLLBACK_BACKUP'));assert.equal(calls,0);
});

test('schema equality never substitutes for trusted restore validation',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.updater.prepareRollback({...f.options,validateRestore:undefined as any}),code('ROLLBACK_RESTORE_REQUIRED'));
  f.options.validateRestore=async()=>{throw new Error('Credential details must not appear in updater errors.');};
  await assert.rejects(f.updater.prepareRollback(f.options),(error:any)=>error.code==='ROLLBACK_RESTORE_UNVERIFIED'&&!error.message.includes('Credential details'));
});

test('a structurally valid encrypted backup still requires successful authenticated decryption',async t=>{
  const f=await fixture(t),backup=JSON.parse(f.backupBytes.toString('utf8'));
  const tag=Buffer.from(backup.envelope.snapshot.tag,'base64url');tag[0]^=1;backup.envelope.snapshot.tag=tag.toString('base64url');
  const corrupt=Buffer.from(JSON.stringify(backup));await writeFile(f.options.backup.path,corrupt);f.options.backup.sha256=hash(corrupt);
  f.options.validateRestore=async request=>{
    const path=join(f.root,'validation-backup.json');await writeFile(path,request.backupBytes);
    const restored=await Vault.restore({directory:join(f.root,'disposable-restore'),storage:'experimental-file',backupFile:path,passphrase});
    try{return result(request);}finally{await restored.close();}
  };
  await assert.rejects(f.updater.prepareRollback(f.options),code('ROLLBACK_RESTORE_UNVERIFIED'));
  assert.ok(!(await readdir(f.root)).includes('disposable-restore'));
});

test('restore results must bind exact releases, bytes, vault, workspace and revision',async t=>{
  const f=await fixture(t);
  const mutations:Array<Partial<RollbackRestoreResult>|{extra:string}>=[{restored:false as any},{fromManifestSha256:'0'.repeat(64)},{toManifestSha256:'0'.repeat(64)},{artifactSha256:'0'.repeat(64)},{backupSha256:'0'.repeat(64)},{vaultId:'other_vault'},{workspaceId:'other_workspace'},{revision:f.state.revision+1},{extra:'untrusted assertion'}];
  for(const mutation of mutations){f.options.validateRestore=async request=>({...result(request),...mutation});await assert.rejects(f.updater.prepareRollback(f.options),code('ROLLBACK_RESTORE_UNVERIFIED'));}
});

test('rollback schema changes require a restore that produces the target supported data schema',async t=>{
  const f=await fixture(t),current={...f.current,dataSchemaVersion:2};f.options.currentManifest=current;f.options.currentSignature=signature(current);
  f.options.validateRestore=async request=>({...result(request),dataSchemaVersion:2});await assert.rejects(f.updater.prepareRollback(f.options),code('ROLLBACK_SCHEMA_INCOMPATIBLE'));
  f.options.validateRestore=async request=>result(request);const plan=await f.updater.prepareRollback(f.options);assert.equal(plan.restore.dataSchemaVersion,1);assert.equal(plan.installed,false);
});

test('callback buffer and options mutation cannot rewrite checked plan bindings',async t=>{
  const f=await fixture(t),originalSignature=f.options.previousSignature,originalBackup=await readFile(f.options.backup.path);
  f.options.validateRestore=async request=>{
    request.backupBytes.fill(0);request.artifactBytes.fill(0);f.options.backup.sha256='0'.repeat(64);(f.options.expectedVault as any).revision=99;
    f.options.previousSignature='mutated after authentication';return result(request);
  };
  const plan=await f.updater.prepareRollback(f.options);assert.equal(plan.backup.sha256,hash(originalBackup));assert.equal(plan.backup.revision,f.state.revision);assert.equal(plan.artifactSha256,hash(artifact));assert.equal(plan.previousSignature,originalSignature);
  assert.deepEqual(await readFile(f.options.backup.path),originalBackup);
});

test('rollback refuses relative paths and linked files or ancestor directories',async t=>{
  const f=await fixture(t);await assert.rejects(f.updater.prepareRollback({...f.options,previousArtifactPath:'relative.artifact'}),code('UNSAFE_ROLLBACK_PATH'));
  const real=join(f.root,'real'),linked=join(f.root,'linked');await mkdir(real);await writeFile(join(real,'previous.artifact'),artifact);
  try {await symlink(real,linked,process.platform==='win32'?'junction':'dir');}
  catch(error:any){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('Directory link creation unavailable; ancestor-link refusal not exercised.');return;}throw error;}
  await assert.rejects(f.updater.prepareRollback({...f.options,previousArtifactPath:join(linked,'previous.artifact')}),code('UNSAFE_PATH'));
  if(process.platform!=='win32'){
    const fileLink=join(f.root,'file-link.artifact');await symlink(f.options.previousArtifactPath,fileLink);await assert.rejects(f.updater.prepareRollback({...f.options,previousArtifactPath:fileLink}),code('UNSAFE_ROLLBACK_PATH'));
  }
});
