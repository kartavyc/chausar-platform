import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {Vault,type VaultEncryptedCustodyCapture} from '../runtime/vault.ts';
const budget={maxEntryBytes:1024*1024,maxTotalEntryBytes:8*1024*1024,maxArtifacts:32};
async function fixture(t:TestContext) {
  const root=await realpath(tmpdir()); if(process.platform==='win32')assert.match(root,/^C:[\\/]/i);
  const directory=await mkdtemp(join(root,'chausar-encrypted-custody-'));
  const result=await Vault.create({directory,name:'Synthetic complete encrypted custody',demo:true,storage:'experimental-file',passphrase:'Synthetic custody passphrase only'});
  t.after(async()=>{await result.vault.close();const target=await realpath(directory),child=relative(root,target);assert.ok(child&&child.startsWith('chausar-encrypted-custody-')&&!child.startsWith('..')&&!isAbsolute(child));await rm(target,{recursive:true,force:true});});
  return {...result,directory};
}
const source=(capture:VaultEncryptedCustodyCapture)=>({vaultId:capture.vaultId,workspaceId:capture.state.workspace.id,revision:capture.state.revision});
test('actual Vault capture requires its authority snapshot fence and retains exact bytes of every private control record',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.vault.captureEncryptedCustody(budget),{code:'CUSTODY_SNAPSHOT_REQUIRED'});
  for(const [purpose,id] of [['private-trial','fork'],['workspace-interchange','archive_copy'],['workspace-interchange','discarded_tombstone'],['workspace-interchange','target_reservation']] as const)
    await f.vault.writeArtifact({id,purpose,value:{synthetic:true,kind:id},expectedDigest:null});
  const before=f.vault.read();
  const capture=await f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget));
  assert.equal(capture.artifacts.length,4);assert.equal(capture.authorityKind,'exact-file-bytes');
  assert.deepEqual(Buffer.from(capture.authority),await readFile(join(f.directory,'authority.encrypted.json')));
  for(const item of capture.artifacts)assert.deepEqual(Buffer.from(item.bytes),await readFile(join(f.directory,'private-artifacts',item.ref.purpose,`${item.ref.id}.encrypted.json`)));
  assert.deepEqual(await f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...capture,source:source(capture)},budget)),before);
  await f.vault.update(state=>{state.workspace.name='Synthetic later live revision';});
  assert.deepEqual(await f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...capture,source:source(capture)},budget)),before);
  assert.equal(f.vault.read().workspace.name,'Synthetic later live revision');
});
test('actual encrypted custody refuses changed refs duplicate entries tampered authority and explicit byte limits without mounting a state',async t=>{
  const f=await fixture(t);await f.vault.writeArtifact({id:'synthetic_one',purpose:'private-trial',value:{synthetic:true},expectedDigest:null});
  const capture=await f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget)),before=f.vault.read();
  const authenticate=(value:VaultEncryptedCustodyCapture,limits=budget)=>f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...value,source:source(capture)},limits));
  const changed=structuredClone(capture);changed.artifacts[0].ref.valueDigest='0'.repeat(64);
  await assert.rejects(authenticate(changed),{code:'ARTIFACT_AUTHENTICATION_FAILED'});
  await assert.rejects(authenticate({...capture,artifacts:[...capture.artifacts,...capture.artifacts]}),{code:'ARTIFACT_INVENTORY_INCOMPLETE'});
  const envelope=JSON.parse(Buffer.from(capture.authority).toString());envelope.snapshot.tag='A'.repeat(22);
  await assert.rejects(authenticate({...capture,authority:Buffer.from(JSON.stringify(envelope))}),{code:'ARTIFACT_AUTHENTICATION_FAILED'});
  await assert.rejects(f.vault.snapshot(()=>f.vault.captureEncryptedCustody({...budget,maxEntryBytes:1})),{code:'ARTIFACT_LIMIT'});
  await assert.rejects(authenticate(capture,{...budget,maxTotalEntryBytes:capture.authority.byteLength,maxEntryBytes:capture.authority.byteLength}),{code:'ARTIFACT_LIMIT'});
  assert.deepEqual(f.vault.read(),before);
});
test('an unknown private namespace explicitly prevents complete custody instead of being omitted',async t=>{
  const f=await fixture(t);await mkdir(join(f.directory,'private-artifacts','unknown_future_namespace'),{recursive:true});
  await assert.rejects(f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget)),{code:'ARTIFACT_INVENTORY_INCOMPLETE'});
});
