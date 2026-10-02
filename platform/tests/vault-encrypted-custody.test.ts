import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {mkdtemp,readFile,realpath,mkdir,rm,writeFile,lstat,open,type FileHandle} from 'node:fs/promises';
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

test('actual encrypted custody admits complete filesystem count and byte budgets before authenticating any artifact',async t=>{
  for(const kind of ['entry-bytes','aggregate-bytes','artifact-count'] as const)await t.test(kind,async sub=>{
    const f=await fixture(sub);
    await f.vault.writeArtifact({id:'a_early_corrupt',purpose:'private-trial',value:{synthetic:true},expectedDigest:null});
    await f.vault.writeArtifact({id:'z_late_large',purpose:'workspace-interchange',value:{synthetic:'X'.repeat(20_000)},expectedDigest:null});
    const first=join(f.directory,'private-artifacts','private-trial','a_early_corrupt.encrypted.json');
    const last=join(f.directory,'private-artifacts','workspace-interchange','z_late_large.encrypted.json');
    const envelope=JSON.parse(await readFile(first,'utf8'));envelope.ciphertext.tag='A'.repeat(22);
    const corrupt=Buffer.from(JSON.stringify(envelope));await writeFile(first,corrupt);
    const authorityBytes=(await lstat(join(f.directory,'authority.encrypted.json'))).size;
    const lastBytes=(await lstat(last)).size;
    const limits={...budget};
    if(kind==='entry-bytes')limits.maxEntryBytes=Math.max(authorityBytes,corrupt.length)+1;
    else if(kind==='aggregate-bytes'){
      limits.maxEntryBytes=Math.max(authorityBytes,corrupt.length,lastBytes);
      limits.maxTotalEntryBytes=authorityBytes+corrupt.length+lastBytes-1;
    }
    else limits.maxArtifacts=1;
    assert.ok(lastBytes>Math.max(authorityBytes,corrupt.length),'The later real ciphertext exceeds the reduced entry limit.');
    const before=f.vault.read();
    await assert.rejects(f.vault.snapshot(()=>f.vault.captureEncryptedCustody(limits)),{code:'ARTIFACT_LIMIT'});
    assert.deepEqual(f.vault.read(),before);assert.deepEqual(await readFile(first),corrupt);
  });
});

test('actual encrypted custody retains ordered original ciphertext across both namespaces and fresh same-revision artifact changes',async t=>{
  const f=await fixture(t),expected=new Map<string,Buffer>();
  for(let index=11;index>=0;index--){
    const purpose=index%2?'private-trial':'workspace-interchange',id=`entry_${String(index).padStart(2,'0')}`;
    await f.vault.writeArtifact({id,purpose,value:{synthetic:true,index,payload:'S'.repeat(index*300)},expectedDigest:null});
    const file=join(f.directory,'private-artifacts',purpose,`${id}.encrypted.json`),envelope=JSON.parse(await readFile(file,'utf8'));
    const bytes=Buffer.from(`${JSON.stringify({ciphertext:envelope.ciphertext,valueDigest:envelope.valueDigest,
      purpose:envelope.purpose,id:envelope.id,vaultId:envelope.vaultId,format:envelope.format},null,index%3?2:4)}\r\n`);
    await writeFile(file,bytes);expected.set(`${purpose}/${id}`,bytes);
  }
  const before=f.vault.read(),first=await f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget));
  const verify=(capture:VaultEncryptedCustodyCapture)=>{
    assert.deepEqual(capture.artifacts.map(item=>`${item.ref.purpose}/${item.ref.id}`),[...expected.keys()].sort());
    for(const item of capture.artifacts){const bytes=expected.get(`${item.ref.purpose}/${item.ref.id}`)!;
      assert.deepEqual(Buffer.from(item.bytes),bytes);assert.equal(item.ref.diskBytes,bytes.length);}
    assert.deepEqual(capture.state,before);assert.deepEqual(Buffer.from(capture.authority),Buffer.from(first.authority));
  };
  verify(first);
  const changed=first.artifacts.find(item=>item.ref.id==='entry_03')!;
  await f.vault.writeArtifact({id:changed.ref.id,purpose:changed.ref.purpose,value:{synthetic:'Fresh replacement at unchanged revision'},expectedDigest:changed.ref.valueDigest});
  expected.set(`${changed.ref.purpose}/${changed.ref.id}`,await readFile(join(f.directory,'private-artifacts',changed.ref.purpose,`${changed.ref.id}.encrypted.json`)));
  await f.vault.writeArtifact({id:'fresh_terminal_control',purpose:'workspace-interchange',value:{synthetic:true,state:'discarded'},expectedDigest:null});
  expected.set('workspace-interchange/fresh_terminal_control',await readFile(join(f.directory,'private-artifacts','workspace-interchange','fresh_terminal_control.encrypted.json')));
  const second=await f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget));verify(second);
  assert.notDeepEqual(second.artifacts.find(item=>item.ref.id===changed.ref.id)!.bytes,changed.bytes);
  assert.deepEqual(await f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...first,source:source(first)},budget)),before);
  assert.deepEqual(await f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...second,source:source(second)},budget)),before);
});

test('actual encrypted custody bounds descriptor reads when a private file grows after its admitted size measurement',async t=>{
  const f=await fixture(t);
  await f.vault.writeArtifact({id:'growing_control',purpose:'workspace-interchange',value:{synthetic:true},expectedDigest:null});
  const file=join(f.directory,'private-artifacts','workspace-interchange','growing_control.encrypted.json');
  const original=await readFile(file),sample=await open(file,'r'),targetStat=await sample.stat();
  const prototype=Object.getPrototypeOf(sample) as FileHandle;await sample.close();
  const realStat=prototype.stat,realReadFile=prototype.readFile;
  const identifies=(stat:{ino:number|bigint;dev:number|bigint})=>String(stat.ino)===String(targetStat.ino)&&String(stat.dev)===String(targetStat.dev);
  let grew=false,oversizedWholeFileReads=0;
  const statHook=t.mock.method(prototype,'stat',async function(this:FileHandle,...args:Parameters<FileHandle['stat']>){
    const stat=await Reflect.apply(realStat,this,args);
    if(!grew&&identifies(stat)){
      grew=true;await writeFile(file,Buffer.concat([original,Buffer.alloc(64*1024,0x20)]));
    }
    return stat;
  });
  const readHook=t.mock.method(prototype,'readFile',async function(this:FileHandle,...args:Parameters<FileHandle['readFile']>){
    const stat=await realStat.call(this);
    if(identifies(stat)&&stat.size>original.length)oversizedWholeFileReads++;
    return Reflect.apply(realReadFile,this,args);
  });
  try{
    const authorityBytes=(await lstat(join(f.directory,'authority.encrypted.json'))).size;
    const limits={maxEntryBytes:Math.max(authorityBytes,original.length),maxTotalEntryBytes:authorityBytes+original.length,maxArtifacts:1};
    await assert.rejects(f.vault.snapshot(()=>f.vault.captureEncryptedCustody(limits)),{code:'ARTIFACT_LIMIT'});
    assert.equal(grew,true,'Mutate the real opened inode after its descriptor size measurement, without a timing race.');
    assert.equal(oversizedWholeFileReads,0,'A grown artifact must not trigger an unbounded whole-file allocation.');
    assert.equal((await lstat(file)).size,original.length+64*1024,'Failed capture preserves the real growth evidence.');
  }finally{statHook.mock.restore();readHook.mock.restore();}
});

test('actual encrypted custody reads large authentic artifacts with bounded one-MiB requests and preserves exact ordered bytes',async t=>{
  const f=await fixture(t),limits={...budget,maxEntryBytes:4*1024*1024};
  for(const [purpose,id,value] of [
    ['workspace-interchange','z_terminal',{synthetic:true,state:'discarded'}],
    ['workspace-interchange','large_capture',{synthetic:'S'.repeat(1_200_000)}],
    ['private-trial','preceding_control',{synthetic:true}],
  ] as const)await f.vault.writeArtifact({purpose,id,value,expectedDigest:null});
  const file=join(f.directory,'private-artifacts','workspace-interchange','large_capture.encrypted.json');
  const original=await readFile(file),sample=await open(file,'r'),targetStat=await sample.stat();
  assert.ok(original.length>1024*1024,'Exercise actual authenticated ciphertext larger than one MiB.');
  const prototype=Object.getPrototypeOf(sample) as FileHandle;await sample.close();
  const realRead=prototype.read,realStat=prototype.stat;
  let calls=0,maximumRequest=0,totalRead=0;
  const hook=t.mock.method(prototype,'read',async function(this:FileHandle,...args:unknown[]){
    const stat=await realStat.call(this),target=stat.ino===targetStat.ino&&stat.dev===targetStat.dev;
    if(target){
      const request=typeof args[2]==='number'?args[2]
        :typeof (args[0] as {length?:unknown})?.length==='number'?(args[0] as {length:number}).length:0;
      assert.ok(Number.isSafeInteger(request)&&request>0,'Every descriptor read requires an explicit positive byte request.');
      calls++;maximumRequest=Math.max(maximumRequest,request);
    }
    const result=await Reflect.apply(realRead,this,args);if(target)totalRead+=result.bytesRead;return result;
  });
  let capture:VaultEncryptedCustodyCapture;
  try{capture=await f.vault.snapshot(()=>f.vault.captureEncryptedCustody(limits));}
  finally{hook.mock.restore();}
  assert.deepEqual(capture.artifacts.map(item=>`${item.ref.purpose}/${item.ref.id}`),[
    'private-trial/preceding_control','workspace-interchange/large_capture','workspace-interchange/z_terminal']);
  for(const item of capture.artifacts)assert.deepEqual(Buffer.from(item.bytes),await readFile(join(f.directory,'private-artifacts',item.ref.purpose,`${item.ref.id}.encrypted.json`)));
  assert.deepEqual(Buffer.from(capture.artifacts.find(item=>item.ref.id==='large_capture')!.bytes),original);
  assert.deepEqual(await f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...capture,source:source(capture)},limits)),f.vault.read());
  t.diagnostic(JSON.stringify({evidence:'real-filesystem-authenticated-custody',artifactBytes:original.length,descriptorReadCalls:calls,maximumRequestBytes:maximumRequest,totalReadBytes:totalRead}));
  assert.equal(totalRead,original.length);assert.ok(maximumRequest<=1024*1024,'Each descriptor read must retain the fixed one-MiB allocation cap.');
  assert.ok(calls<=Math.ceil(original.length/(1024*1024))+2,'A large artifact must fit one-MiB reads plus bounded partial/EOF overhead.');
});

test('actual encrypted custody uses three independent path measurements per admitted artifact without duplicate pre-open stat',async t=>{
  const f=await fixture(t);
  await f.vault.writeArtifact({id:'measured_control',purpose:'workspace-interchange',value:{synthetic:true},expectedDigest:null});
  const file=join(f.directory,'private-artifacts','workspace-interchange','measured_control.encrypted.json'),original=await readFile(file);
  const filesystem=createRequire(import.meta.url)('node:fs/promises') as typeof import('node:fs/promises'),realLstat=filesystem.lstat;
  let pathMeasurements=0;
  const hook=t.mock.method(filesystem,'lstat',async function(...args:Parameters<typeof lstat>){
    if(String(args[0])===file)pathMeasurements++;
    return Reflect.apply(realLstat,filesystem,args);
  });syncBuiltinESMExports();
  let capture:VaultEncryptedCustodyCapture;
  try{capture=await f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget));}
  finally{hook.mock.restore();syncBuiltinESMExports();}
  assert.deepEqual(Buffer.from(capture.artifacts[0].bytes),original);
  assert.deepEqual(await f.vault.snapshot(()=>f.vault.authenticateEncryptedCustody({...capture,source:source(capture)},budget)),f.vault.read());
  t.diagnostic(JSON.stringify({evidence:'real-filesystem-authenticated-custody',artifactPathMeasurements:pathMeasurements,exactBytesAndAuthentication:true}));
  assert.equal(pathMeasurements,3,'Retain preflight, before-open and current-path identity measurements without an adjacent redundant stat.');
});

test('actual encrypted custody preserves missing and nonregular artifact refusals after successful size preflight',async t=>{
  for(const change of ['removed','replaced-with-directory'] as const)await t.test(change,async sub=>{
    const f=await fixture(sub);
    await f.vault.writeArtifact({id:'changed_control',purpose:'workspace-interchange',value:{synthetic:true},expectedDigest:null});
    const file=join(f.directory,'private-artifacts','workspace-interchange','changed_control.encrypted.json');
    const filesystem=createRequire(import.meta.url)('node:fs/promises') as typeof import('node:fs/promises'),realLstat=filesystem.lstat;
    let changed=false;
    const hook=sub.mock.method(filesystem,'lstat',async function(...args:Parameters<typeof lstat>){
      const stat=await Reflect.apply(realLstat,filesystem,args);
      if(!changed&&String(args[0])===file){
        changed=true;await rm(file);if(change==='replaced-with-directory')await mkdir(file);
      }
      return stat;
    });syncBuiltinESMExports();
    try{
      await assert.rejects(f.vault.snapshot(()=>f.vault.captureEncryptedCustody(budget)),{code:change==='removed'?'ARTIFACT_NOT_FOUND':'UNSAFE_PATH'});
      assert.equal(changed,true,'Mutate the real path after its admitted preflight stat without a timing race.');
    }finally{hook.mock.restore();syncBuiltinESMExports();}
    if(change==='removed')await assert.rejects(lstat(file),{code:'ENOENT'});
    else assert.equal((await lstat(file)).isDirectory(),true,'Refusal preserves the competing nonregular occupant.');
  });
});
