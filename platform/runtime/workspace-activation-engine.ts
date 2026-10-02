import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readdir,readFile,open} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute,sep} from 'node:path';
import {check,authorize,hash,ChausarError,type Context,type State} from './contracts.ts';
import {Vault,safeDirectory,type PrivateArtifactRef,type VaultEncryptedCustodyCapture} from './vault.ts';
import {acquireProcessLock} from './process-lock.ts';
import {WorkspaceBackupV2LocalCustody} from './workspace-backup-local.ts';
import {WorkspaceInterchangeLocalCustody} from './workspace-interchange-local.ts';
import {WorkspaceBackupActivationHost,type WorkspaceBackupActivationPolicy,type WorkspaceBackupActivationLease,type WorkspaceBackupActivationSelection,type WorkspaceBackupActivationMaterialRefs} from './workspace-backup-activation.ts';
import {WorkspaceActivationHost,type WorkspaceActivationPolicy,type WorkspaceActivationAuthority,type WorkspaceActivationCommit,type AuthenticatedActivationCandidate} from './workspace-activation.ts';
import {createWorkspaceActivationLocalPorts} from './workspace-activation-local.ts';
import {canonicalInterchangeJson,interchangeDigest,workspaceStateProfile,readHistoricalWorkspaceState,retainedArtifactBytes,captureWorkspaceInterchange,validateWorkspaceInterchange} from './workspace-interchange.ts';
import {workspaceBackupV2Bytes,validateWorkspaceBackupV2,type WorkspaceBackupV2Capture} from './workspace-backup-v2.ts';
import type {EmptyTargetInspection,WorkspaceInventory,ArtifactCapture} from './workspace-interchange-contracts.ts';
import type {FileWorkspaceLaunch} from './workspace-postgres-contracts.ts';
import type {WorkspaceInterchangeSourceLease,WorkspaceInterchangeCustodyRecord} from './workspace-interchange-host.ts';

const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const equal=(a:unknown,b:unknown)=>canonicalInterchangeJson(a)===canonicalInterchangeJson(b);
const ref=(v:PrivateArtifactRef):PrivateArtifactRef=>({id:v.id,purpose:v.purpose,valueDigest:v.valueDigest,diskBytes:v.diskBytes});
const recordId=(id:string,part:string)=>'wac_'+sha(id)+'_'+part;
const exportId=(id:string,part:string)=>'wic_'+sha(id)+'_'+part;
const reservationId=(id:string)=>'wit_'+sha(id)+'_reservation';
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const slotPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const encryptedBudgets={maxArtifacts:4096,maxEntryBytes:16*1024*1024,maxTotalEntryBytes:64*1024*1024};
const physical=(s:{dev:bigint;ino:bigint;birthtimeNs:bigint})=>({dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)});
const applicationNamespaceRoots=['application/backups','application/exports','application/updates'];
/** Completed boundaries only; source, journal, staging and target custody have their own exact gates. */
const applicationNamespaceWitness=(inventory:Awaited<ReturnType<WorkspaceBackupV2LocalCustody['inspectHeldNamespaces']>>)=>{
  const selected=(path:string)=>applicationNamespaceRoots.some(root=>path===root||path.startsWith(root+'/'));
  return{directories:inventory.directories.filter(item=>item.path==='application'||selected(item.path)),
    files:inventory.files.filter(item=>selected(item.path)),
    namespaces:inventory.namespaces.filter(item=>applicationNamespaceRoots.includes(item.namespace))};
};
type CandidateBinding={format:'chausar.activation-candidate-binding.v1';phase:'preparing'|'committed';sourceVaultId:string;recordId:string;creationId:string;contextDigest:string;archive:PrivateArtifactRef|null;pin:PrivateArtifactRef|null};
type CandidateClaim={id:string;creationId:string;sourceVaultId:string;contextDigest:string};
type Reservation={format:'chausar.interchange-target-reservation.v1';sourceVaultId:string;sourceWorkspaceId:string;targetId:string;workspaceId:string;generation:string;contextDigest:string;physical:ReturnType<typeof physical>};
export type EngineWorkspaceActivationOptions={
  /** Separate actual local encrypted journal; caller owns its credential/lifetime. */
  journalVault:Vault; policy:WorkspaceActivationPolicy;
  /** Explicit operator capability; never inferred from an old credential or copied key. */
  targetPassphrase:(authority:WorkspaceActivationAuthority)=>Promise<string>;
};
type Options=EngineWorkspaceActivationOptions&{sourceVault:Vault;applicationDirectory:string;backup:WorkspaceBackupV2LocalCustody;interchange:WorkspaceInterchangeLocalCustody;backupPolicy:WorkspaceBackupActivationPolicy;assertCompleteOwner:(context:Context,historical:State)=>Promise<void>};

/** Actual local composition, enabled only by an explicit synthetic constructor
 * policy. No network/provider/native-service/old-key capability is installed. */
export class EngineWorkspaceActivation {
  readonly bridge:WorkspaceBackupActivationHost;
  readonly activation:WorkspaceActivationHost;
  readonly #o:Options;
  readonly #scope=new AsyncLocalStorage<{context:Context;assertCurrent:()=>Promise<void>}>();
  constructor(options:Options){
    check(options.sourceVault instanceof Vault&&options.journalVault instanceof Vault&&options.sourceVault!==options.journalVault
      && options.sourceVault.storageKind==='experimental-file'&&options.journalVault.storageKind==='experimental-file'
      &&typeof options.targetPassphrase==='function','ACTIVATION_ROOT_REQUIRED','Install separate actual source/journal custody and an explicit fresh credential capability.');
    this.#o={...options,applicationDirectory:resolve(options.applicationDirectory),policy:structuredClone(options.policy),backupPolicy:structuredClone(options.backupPolicy)};
    const source=relative(this.#o.applicationDirectory,options.sourceVault.directory),journal=relative(this.#o.applicationDirectory,options.journalVault.directory);
    check(source&&journal&&!source.includes(sep)&&!journal.includes(sep)&&!isAbsolute(source)&&!isAbsolute(journal)&&source!==journal
      &&source!=='..'&&journal!=='..','ACTIVATION_ROOT_REQUIRED','Source and reviewed journal must be distinct managed application children.');
    this.bridge=new WorkspaceBackupActivationHost({withTransaction:(ctx,chosen,work)=>this.#bridgeTransaction(ctx,chosen,work),custody:{read:(ctx,id)=>this.readCandidate(ctx,id)}},this.#o.backupPolicy);
    const local=createWorkspaceActivationLocalPorts({sourceVault:options.sourceVault,journalVault:options.journalVault,applicationDirectory:this.#o.applicationDirectory,
      source:{withSource:(ctx,expected,work,candidateId)=>this.#withSource(ctx,expected,work,candidateId)},
      candidates:{read:(ctx,id)=>this.readCandidate(ctx,id),withCandidate:(ctx,id,work)=>this.#candidateLock(id,()=>work(()=>this.#candidate(ctx,id)))},
      bootstrap:{allocateAuthority:async(ctx,target)=>{await this.#owner(ctx,this.#o.sourceVault.read());const ownerId='owner_'+randomUUID();return{workspaceId:target.workspaceId,
        owner:{id:ownerId,name:'Fresh workspace owner',role:'owner',active:true,epoch:1,branches:['*']},
        context:{memberId:ownerId,role:'owner',epoch:1,channel:'desktop'},sessionAuthorityId:'session_'+randomUUID(),createdAt:new Date().toISOString()};},
        prepare:input=>this.#prepareBootstrap(input.stagingDirectory,input.publication),inspect:input=>this.#inspectLive(input.targetDirectory,input.publication)},
      budgets:{maxFiles:4096,maxBytes:64*1024*1024,maxDepth:16}});
    this.activation=new WorkspaceActivationHost(local.ports,this.#o.policy);
  }
  targetPath(id:string){check(typeof id==='string'&&slotPattern.test(id)&&!['main','backups','exports','updates',relative(this.#o.applicationDirectory,this.#o.sourceVault.directory),relative(this.#o.applicationDirectory,this.#o.journalVault.directory)].includes(id),'ACTIVATION_UNSAFE_PATH','Choose an unused managed target ID.');return join(this.#o.applicationDirectory,id);}
  async #owner(ctx:Context,historical:State){
    check(ctx.channel==='desktop'&&!ctx.sourceTainted,'APP_APPROVAL_REQUIRED','Use the current untainted source desktop owner.');
    const state=this.#o.sourceVault.read(),member=authorize(this.#o.sourceVault,ctx,'admin');
    check(member.role==='owner'&&member.branches.includes('*')&&this.#o.policy.approvedSyntheticWorkspaceIds.includes(state.workspace.id),
      'ACTIVATION_SYNTHETIC_SCOPE','Only explicitly constructor-approved synthetic source workspaces may activate.');
    check(historical.workspace.id===state.workspace.id,'ACTIVATION_SOURCE_CHANGED','Historical material belongs to another source.');
    check(await this.#o.assertCompleteOwner(structuredClone(ctx),structuredClone(historical))===undefined,'ACTIVATION_ROOT_GUARD','Current complete-owner/readiness admission must complete.');
  }
  async #candidateLock<T>(id:string,work:()=>Promise<T>){
    check(idPattern.test(id),'ACTIVATION_SHAPE','Use one candidate ID.');
    const directory=await safeDirectory(join(this.#o.applicationDirectory,'.workspace-interchange-control','records'),true);
    const lock=await acquireProcessLock(join(directory,sha(this.#o.sourceVault.vaultId+':'+id)+'.lock'),{busyCode:'ACTIVATION_BUSY',changedCode:'ACTIVATION_LOCK_CHANGED'});
    try{return await work();}finally{await lock.release();}
  }
  async #targetLock<T>(id:string,work:()=>Promise<T>){
    const directory=await safeDirectory(join(this.#o.applicationDirectory,'.workspace-interchange-control','targets'),true);
    const lock=await acquireProcessLock(join(directory,sha(this.targetPath(id))+'.lock'),{busyCode:'ACTIVATION_BUSY',changedCode:'ACTIVATION_LOCK_CHANGED'});
    try{return await work();}finally{await lock.release();}
  }
  async #find(id:string){try{return await this.#o.journalVault.readArtifact({id,purpose:'workspace-interchange'});}catch(error:any){if(error.code==='ARTIFACT_NOT_FOUND')return null;throw error;}}
  async #ledger(){
    const saved=await this.#find('wac_identity_ledger_v1'),value=saved?.value as any;
    const ledger:{format:'chausar.activation-candidate-ledger.v1';claims:CandidateClaim[]}=saved?value:{format:'chausar.activation-candidate-ledger.v1',claims:[]};
    check(ledger&&typeof ledger==='object'&&!Array.isArray(ledger)&&ledger.format==='chausar.activation-candidate-ledger.v1'&&equal(Object.keys(ledger).sort(),['claims','format'])&&Array.isArray(ledger.claims)&&ledger.claims.length<=4096
      &&ledger.claims.every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&equal(Object.keys(v).sort(),['contextDigest','creationId','id','sourceVaultId'])&&typeof v.id==='string'&&typeof v.creationId==='string'&&idPattern.test(v.id)&&idPattern.test(v.creationId)
        &&idPattern.test(v.sourceVaultId)&&/^[a-f0-9]{64}$/.test(v.contextDigest))
      &&new Set(ledger.claims.map(v=>v.id)).size===ledger.claims.length&&new Set(ledger.claims.map(v=>v.creationId)).size===ledger.claims.length,
      'ACTIVATION_CANDIDATE_CHANGED','Durable paired candidate identity consumption is malformed or ambiguous.');
    return{saved,ledger};
  }
  async #candidate(ctx:Context,id:string):Promise<AuthenticatedActivationCandidate>{
    await this.#owner(ctx,this.#o.sourceVault.read());
    const retained=await this.#find(recordId(id,'binding')),binding=retained?.value as CandidateBinding;
    check(binding?.format==='chausar.activation-candidate-binding.v1'&&binding.phase==='committed'&&binding.sourceVaultId===this.#o.sourceVault.vaultId
      &&binding.recordId===id&&binding.contextDigest===interchangeDigest(ctx)&&binding.archive&&binding.pin,'ACTIVATION_CANDIDATE_UNAVAILABLE','No exact committed candidate issuance is available.');
    const {ledger}=await this.#ledger();
    check(ledger.claims.some(v=>v.id===id&&v.creationId===binding.creationId&&v.sourceVaultId===binding.sourceVaultId&&v.contextDigest===binding.contextDigest),
      'ACTIVATION_CANDIDATE_CHANGED','The exact record and creation must remain independently consumed.');
    const archive=await this.#find(recordId(id,'archive')),pin=await this.#find(recordId(id,'pin'));
    check(archive&&pin&&equal(ref(archive),binding.archive)&&equal(ref(pin),binding.pin),'ACTIVATION_CANDIDATE_CHANGED','Independent encrypted candidate or pin changed.');
    const a=archive.value as any,p=pin.value as any;
    check(a.format==='chausar.activation-candidate-archive.v1'&&p.format==='chausar.activation-candidate-pin.v1'&&a.recordId===id&&p.recordId===id
      &&a.creationId===binding.creationId&&p.pin?.creationId===binding.creationId&&p.pin.contextDigest===binding.contextDigest,'ACTIVATION_CANDIDATE_CHANGED','Issuance/creation binding differs.');
    const value={content:a.content as string,pin:p.pin,measurement:{encrypted:true as const,archiveCiphertextBytes:archive.diskBytes,inventoryPinCiphertextBytes:pin.diskBytes,qualification:'encrypted-local-host' as const}};
    check(typeof value.content==='string'&&Buffer.byteLength(value.content)<=this.#o.policy.budgets.maxCandidateBytes,
      'ACTIVATION_LIMIT','The complete encrypted candidate exceeds its installed byte budget.');
    const parsed=JSON.parse(value.content);
    const historical=validateWorkspaceInterchange(canonicalInterchangeJson(parsed.archive),value.pin.inventory);
    check(canonicalInterchangeJson(parsed)===value.content&&interchangeDigest(parsed)===value.pin.candidateDigest
      &&historical.digest===value.pin.packageDigest&&parsed.packageDigest===historical.digest&&equal(historical.inventory,value.pin.inventory),'ACTIVATION_CANDIDATE_CHANGED','Complete issued candidate content differs from its independent pin.');
    return value;
  }
  readCandidate(ctx:Context,id:string){
    const scope=this.#scope.getStore();
    if(scope){check(equal(scope.context,ctx),'ACTIVATION_ROOT_GUARD','Held source context must agree.');return this.#candidateLock(id,()=>this.#candidate(ctx,id));}
    return this.#withSource(ctx,null,()=>this.#candidateLock(id,()=>this.#candidate(ctx,id)));
  }
  async #sourceFiles(){
    const files:{path:string;physical:ReturnType<typeof physical>;bytes:number;sha256:string}[]=[],directories:{path:string;physical:ReturnType<typeof physical>}[]=[];let total=0,count=0;
    const wider=['reports','plugin-assets','research-evidence','conversation-files','sync-evidence'];
    const walk=async(directory:string,prefix:string,depth:number)=>{
      check(depth<=16&&++count<=4096,'ACTIVATION_LIMIT','Source enumeration exceeded its depth/count bound.');await safeDirectory(directory);
      directories.push({path:prefix,physical:physical(await lstat(directory,{bigint:true}))});
      for(const name of (await readdir(directory)).sort()){
        check(++count<=4096&&/^[A-Za-z0-9_.-]+$/.test(name),'ACTIVATION_LIMIT','Complete source enumeration exceeded its count or name bound.');
        if(prefix==='')check(['authority.encrypted.json','writer.lock','private-artifacts',...wider].includes(name),'ACTIVATION_NAMESPACE_UNCLASSIFIED','Every actual source namespace needs its explicit typed profile.');
        if(prefix==='private-artifacts/')check(['private-trial','workspace-interchange'].includes(name),'ACTIVATION_NAMESPACE_UNCLASSIFIED','Actual private purposes must be typed and authenticated.');
        if(/^private-artifacts\/[^/]+\/$/.test(prefix))check(/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name),'ACTIVATION_NAMESPACE_UNCLASSIFIED','Private source entries require typed authenticated filenames.');
        const path=join(directory,name),s=await lstat(path,{bigint:true});check(!s.isSymbolicLink(),'ACTIVATION_SOURCE_CUSTODY','Source links are refused.');
        if(prefix===''&&name==='writer.lock')continue;
        if(s.isDirectory())await walk(path,prefix+name+'/',depth+1);
        else{check(s.isFile()&&s.nlink===1n&&s.size<=BigInt(64*1024*1024-total),'ACTIVATION_SOURCE_CUSTODY','Source requires bounded regular singly owned files.');
          const handle=await open(path,'r');try{const before=await handle.stat({bigint:true});check(equal(physical(before),physical(s)),'ACTIVATION_SOURCE_CUSTODY','Source file changed before opening.');
            const bytes=await handle.readFile(),after=await handle.stat({bigint:true}),current=await lstat(path,{bigint:true});
            check(bytes.length===Number(s.size)&&after.size===s.size&&current.size===s.size&&equal(physical(after),physical(s))&&equal(physical(current),physical(s))
              &&after.mtimeNs===s.mtimeNs&&current.mtimeNs===s.mtimeNs&&after.ctimeNs===s.ctimeNs&&current.ctimeNs===s.ctimeNs,'ACTIVATION_SOURCE_CUSTODY','Source bytes/generation changed during enumeration.');
            total+=bytes.length;files.push({path:prefix+name,physical:physical(s),bytes:bytes.length,sha256:sha(bytes)});
          }finally{await handle.close();}}
      }
    };await walk(this.#o.sourceVault.directory,'',0);return{files,directories};
  }
  async #applicationNamespaces(){
    const allowed=new Set([relative(this.#o.applicationDirectory,this.#o.sourceVault.directory),relative(this.#o.applicationDirectory,this.#o.journalVault.directory),
      'backups','exports','updates','.workspace-interchange-control','.workspace-backup-control','.workspace-activation-control']);
    const refs=await this.#o.sourceVault.listArtifacts({purpose:'workspace-interchange'});
    for(const r of refs)if(/^wit_[a-f0-9]{64}_reservation$/.test(r.id)||/^wbt2_[a-f0-9]{64}_reservation$/.test(r.id)){
      const v=(await this.#o.sourceVault.readArtifact(r)).value as any;
      check(typeof v.targetId==='string'&&slotPattern.test(v.targetId)&&v.physical
        &&(r.id===reservationId(v.targetId)&&v.format==='chausar.interchange-target-reservation.v1'&&v.sourceVaultId===this.#o.sourceVault.vaultId&&v.sourceWorkspaceId===this.#o.sourceVault.read().workspace.id
          ||r.id==='wbt2_'+sha(v.targetId)+'_reservation'&&v.format==='chausar.backup-local-target.v2'&&v.vaultId===this.#o.sourceVault.vaultId&&v.workspaceId===this.#o.sourceVault.read().workspace.id),
        'ACTIVATION_SOURCE_CUSTODY','A target reservation lacks its exact authenticated source and physical identity.');
      const stat=await lstat(join(this.#o.applicationDirectory,v.targetId),{bigint:true});
      check(stat.isDirectory()&&!stat.isSymbolicLink()&&equal(physical(stat),v.physical),'ACTIVATION_TARGET_CHANGED','A reserved target changed its physical identity.');allowed.add(v.targetId);
    }
    for(const name of await readdir(this.#o.applicationDirectory))check(allowed.has(name),'ACTIVATION_NAMESPACE_UNCLASSIFIED','An unrelated application sibling requires a separately authorized complete custody profile.');
    // Journal/staging/targets are independently held and measured by actual local
    // storage. They remain outside the original v2 archive, never portable aliases.
  }
  async #archivedCapture(expected:WorkspaceInventory,candidateId:string){
    const ctx=this.#scope.getStore()!.context;
    const selected=await this.#candidate(ctx,candidateId);
    check(equal(selected.pin.inventory,expected),'ACTIVATION_CANDIDATE_CHANGED','Requested archived inventory differs from exact selected candidate.');
    const inspected=await this.bridge.inspect(ctx,{candidateId:selected.pin.recordId});
    check(inspected.evidence.content===selected.content&&equal(inspected.evidence.pin,selected.pin),'ACTIVATION_CANDIDATE_CHANGED','Current independent original custody no longer rebuilds this candidate.');
    const parsed=JSON.parse(selected.content),archive=validateWorkspaceInterchange(canonicalInterchangeJson(parsed.archive),expected);
    const provenanceEntry=archive.artifacts.find(v=>v.manifest.id==='backup_activation_provenance_v1');check(provenanceEntry,'ACTIVATION_CANDIDATE_CHANGED','Archive provenance is absent.');
    const provenance=JSON.parse(Buffer.from(retainedArtifactBytes(provenanceEntry)).toString('utf8'));
    const encrypted=validateWorkspaceBackupV2(provenance.backup.content,provenance.backup.pin.sourcePin,this.#o.backupPolicy.backupBudgets);
    const capture=workspaceBackupV2Bytes(encrypted,this.#o.backupPolicy.backupBudgets),historical=await this.#o.sourceVault.authenticateEncryptedCustody(capture,encryptedBudgets);
    await this.#owner(ctx,historical);await this.#authenticateMaterial(capture,provenance.material);
    const state=readHistoricalWorkspaceState(archive);check(equal(state,historical),'ACTIVATION_CANDIDATE_CHANGED','Archived semantic State differs from authenticated original authority.');
    const artifacts:ArtifactCapture={complete:true,enumerationId:expected.enumerationId,generation:structuredClone(expected.generation),categories:workspaceStateProfile().artifactCategories,
      artifacts:archive.artifacts.map(item=>({id:item.manifest.id,category:item.manifest.category,mediaType:item.manifest.mediaType,bytes:retainedArtifactBytes(item),generation:structuredClone(item.manifest.generation)}))};
    check(equal(captureWorkspaceInterchange(state,artifacts).inventory,expected),'ACTIVATION_CANDIDATE_CHANGED','Authenticated archive does not reproduce the issued inventory.');
    return{state,artifacts};
  }
  async #withSource<T>(ctx:Context,expected:WorkspaceInventory|null,work:(lease:WorkspaceInterchangeSourceLease)=>Promise<T>,candidateId?:string):Promise<T>{
    check(!this.#scope.getStore(),'ACTIVATION_ROOT_GUARD','Do not reacquire source admission inside a held callback.');
    return this.#o.backup.withHeldSource(ctx,async()=>{
      const state=this.#o.sourceVault.read();await this.#owner(ctx,state);await this.#applicationNamespaces();
      const applicationWitness=applicationNamespaceWitness(await this.#o.backup.inspectHeldNamespaces());
      const captured=await this.#o.sourceVault.captureEncryptedCustody(encryptedBudgets),files=await this.#sourceFiles();
      const assertCurrent=async()=>{await this.#owner(ctx,state);await this.#applicationNamespaces();
        check(equal(this.#o.sourceVault.read(),state)&&equal(await this.#sourceFiles(),files),'ACTIVATION_SOURCE_CHANGED','Actual current authority or complete physical source custody changed.');
        const current=await this.#o.sourceVault.captureEncryptedCustody(encryptedBudgets);
        check(equal(this.#encryptedFence(current),this.#encryptedFence(captured)),'ACTIVATION_SOURCE_CHANGED','Held authenticated original ciphertext changed.');};
      return this.#scope.run({context:structuredClone(ctx),assertCurrent},async()=>{
        const generation={workspaceId:state.workspace.id,revision:state.revision,captureId:'current_'+sha(JSON.stringify(files))};
        const artifacts:ArtifactCapture={complete:true,enumerationId:'current_'+sha(JSON.stringify(files)),generation,categories:workspaceStateProfile().artifactCategories,
          artifacts:captured.artifacts.map(item=>({id:'encrypted_'+sha(item.ref.purpose+':'+item.ref.id),category:'other-retained',mediaType:'application/octet-stream',bytes:item.bytes,generation}))};
        check(!expected||(typeof candidateId==='string'&&idPattern.test(candidateId)),'ACTIVATION_CANDIDATE_UNAVAILABLE','Archived source admission requires the exact selected candidate identity.');
        const authenticatedHistoricalCapture=expected?await this.#archivedCapture(expected,candidateId!):undefined;
        const result=await work({ready:true,state,artifacts,assertCurrent,assertCompleteOwner:(context,historical)=>this.#owner(context,historical),
          ...(authenticatedHistoricalCapture?{authenticatedHistoricalCapture}:{})});await assertCurrent();
        const finalApplicationWitness=applicationNamespaceWitness(await this.#o.backup.inspectHeldNamespaces());
        check(equal(finalApplicationWitness,applicationWitness),'ACTIVATION_APPLICATION_CHANGED','Owned application backup, export or update custody changed between completed transaction boundaries.');
        return result;
      });
    });
  }
  #encryptedFence(v:VaultEncryptedCustodyCapture){return{state:hash(v.state),authority:sha(v.authority),artifacts:v.artifacts.map(a=>({ref:a.ref,sha256:sha(a.bytes)}))};}
  async #target(ctx:Context,id:string):Promise<EmptyTargetInspection>{
    const saved=await this.#o.sourceVault.readArtifact({id:reservationId(id),purpose:'workspace-interchange'}),v=saved.value as Reservation;
    const path=this.targetPath(id),s=await lstat(path,{bigint:true});
    check(v.format==='chausar.interchange-target-reservation.v1'&&v.targetId===id&&v.sourceVaultId===this.#o.sourceVault.vaultId
      &&v.sourceWorkspaceId===this.#o.sourceVault.read().workspace.id&&v.contextDigest===interchangeDigest(ctx)&&s.isDirectory()&&!s.isSymbolicLink()&&equal(v.physical,physical(s)),
      'ACTIVATION_TARGET_CHANGED','Actual target differs from its independently issued physical reservation.');
    const entries=await readdir(path),profile=workspaceStateProfile();return{targetId:id,workspaceId:v.workspaceId,generation:v.generation,
      accessDigest:interchangeDigest({context:ctx,members:this.#o.sourceVault.read().members,policy:this.#o.sourceVault.read().policy}),ready:true,profile,
      stores:profile.stores.map(store=>({name:store.name,records:0})),categoryCounts:profile.artifactCategories.map(category=>({category,count:0})),authorityRecords:entries.length?1:0,unexpectedEntries:entries.sort()};
  }
  async createTarget(ctx:Context,id:string){
    let attempted=false;
    try{return await this.#o.backup.withHeldSource(ctx,()=>this.#targetLock(id,async()=>{await this.#owner(ctx,this.#o.sourceVault.read());
      const path=this.targetPath(id);try{await lstat(path);check(false,'ACTIVATION_TARGET_EXISTS','Existing directories are not adopted.');}catch(error:any){if(error.code!=='ENOENT')throw error;}
      const prior=await this.#o.sourceVault.listArtifacts({purpose:'workspace-interchange'});check(!prior.some(v=>v.id===reservationId(id)),'ACTIVATION_SINGLE_USE','Target IDs are single-use.');
      await mkdir(path,{mode:0o700});attempted=true;const v:Reservation={format:'chausar.interchange-target-reservation.v1',sourceVaultId:this.#o.sourceVault.vaultId,
        sourceWorkspaceId:this.#o.sourceVault.read().workspace.id,targetId:id,workspaceId:'workspace_'+randomUUID(),generation:'empty_'+randomUUID(),contextDigest:interchangeDigest(ctx),physical:physical(await lstat(path,{bigint:true}))};
      await this.#o.sourceVault.writeArtifact({id:reservationId(id),purpose:'workspace-interchange',value:v,expectedDigest:null});return this.#target(ctx,id);
    }));}catch(error){if(attempted)throw new ChausarError('ACTIVATION_TARGET_COMMIT_UNKNOWN',`Target ${id} attempted exact reservation without complete acknowledgement. Inspect that identity; do not retry, adopt or overwrite it.`);throw error;}
  }
  inspectTarget(ctx:Context,id:string){return this.#o.backup.withHeldSource(ctx,()=>this.#targetLock(id,async()=>{
    await this.#owner(ctx,this.#o.sourceVault.read());
    try{return await this.#target(ctx,id);}catch(error:any){if(error.code==='ARTIFACT_NOT_FOUND')return{status:'unknown' as const,targetId:id,reasonCode:'ACTIVATION_TARGET_RESERVATION_UNAVAILABLE'};throw error;}
  }));}
  async #authenticateMaterial(capture:WorkspaceBackupV2Capture,material:WorkspaceInterchangeCustodyRecord):Promise<WorkspaceBackupActivationMaterialRefs>{
    const parts=['archive','pin','commit'] as const,id=material.pin.recordId;
    const items=parts.map(part=>{const item=capture.artifacts.find(v=>v.ref.id===exportId(id,part)&&v.ref.purpose==='workspace-interchange');check(item,'BACKUP_ACTIVATION_MATERIAL','The original capture lacks an exact independently issued semantic-export envelope.');return item;});
    const values=await this.#o.sourceVault.authenticateArchivedArtifacts({sourceVaultId:capture.source.vaultId,artifacts:items},encryptedBudgets);
    const [a,p,c]=values,v=a.value as any,pv=p.value as any,b=c.value as any;
    check(v.format==='chausar.interchange-local-archive.v1'&&pv.format==='chausar.interchange-local-pin.v1'&&b.format==='chausar.interchange-local-binding.v1'
      &&v.recordId===id&&pv.recordId===id&&b.recordId===id&&b.state==='committed'&&b.contextDigest===material.pin.contextDigest
      &&equal(b.archive,ref(a))&&equal(b.pin,ref(p))&&v.content===material.content&&equal(pv.pin,material.pin)
      &&b.contentDigest===interchangeDigest(material.content)&&b.pinDigest===interchangeDigest(material.pin),'BACKUP_ACTIVATION_MATERIAL','Archived export values and committed exact ciphertext refs differ.');
    return{archive:ref(a),pin:ref(p),binding:ref(c)};
  }
  async #issueCandidate(ctx:Context,record:WorkspaceInterchangeCustodyRecord,guard:()=>Promise<void>){
    const id=record.pin.recordId;check(record.pin.kind==='candidate'&&idPattern.test(id),'ACTIVATION_CANDIDATE_CHANGED','Issue one candidate.');
    const {saved,ledger}=await this.#ledger();
    check(ledger.claims.length<4096&&!ledger.claims.some(v=>v.id===id||v.creationId===record.pin.creationId),'ACTIVATION_SINGLE_USE','Candidate record and creation IDs remain consumed after every attempt.');
    await guard();await this.#o.journalVault.writeArtifact({id:'wac_identity_ledger_v1',purpose:'workspace-interchange',value:{...ledger,claims:[...ledger.claims,
      {id,creationId:record.pin.creationId,sourceVaultId:this.#o.sourceVault.vaultId,contextDigest:interchangeDigest(ctx)}]},expectedDigest:saved?.valueDigest??null});
    let binding:CandidateBinding={format:'chausar.activation-candidate-binding.v1',phase:'preparing',sourceVaultId:this.#o.sourceVault.vaultId,recordId:id,creationId:record.pin.creationId,contextDigest:interchangeDigest(ctx),archive:null,pin:null};
    const initial=await this.#o.journalVault.writeArtifact({id:recordId(id,'binding'),purpose:'workspace-interchange',value:binding,expectedDigest:null});
    const archive=await this.#o.journalVault.writeArtifact({id:recordId(id,'archive'),purpose:'workspace-interchange',value:{format:'chausar.activation-candidate-archive.v1',recordId:id,creationId:record.pin.creationId,content:record.content},expectedDigest:null});
    const pin=await this.#o.journalVault.writeArtifact({id:recordId(id,'pin'),purpose:'workspace-interchange',value:{format:'chausar.activation-candidate-pin.v1',recordId:id,pin:record.pin},expectedDigest:null});
    await guard();binding={...binding,phase:'committed',archive,pin};await this.#o.journalVault.writeArtifact({id:recordId(id,'binding'),purpose:'workspace-interchange',value:binding,expectedDigest:initial.valueDigest});
    return(await this.#candidate(ctx,id)).measurement;
  }
  #bridgeTransaction<T>(ctx:Context,chosen:WorkspaceBackupActivationSelection&{mode:'prepare'|'inspect'},work:(lease:WorkspaceBackupActivationLease)=>Promise<T>):Promise<T>{
    const run=()=>this.#o.backup.withArchiveReader(ctx,chosen.backupId,readBackup=>
      this.#o.interchange.withRecordReader(ctx,chosen.materialId,readMaterial=>this.#o.backup.withInertReader(ctx,chosen.inertTargetId,readInert=>
        this.#targetLock(chosen.targetId,()=>this.#candidateLock(chosen.candidateId,async()=>{
          const target=await this.#target(ctx,chosen.targetId),state=this.#o.sourceVault.read();
          const originalBackup=await readBackup(),originalMaterial=await readMaterial(),originalInert=await readInert();
          const assertCurrent=async()=>{await this.#scope.getStore()!.assertCurrent();check(equal(await this.#target(ctx,chosen.targetId),target)
            &&equal(await readBackup(),originalBackup)&&equal(await readMaterial(),originalMaterial)&&equal(await readInert(),originalInert),'BACKUP_ACTIVATION_CUSTODY_CHANGED','Held independently issued evidence or target changed.');};
          const result=await work({currentState:state,target,readBackup,readMaterial,readInert,
            authenticateArchive:async capture=>{const historical=await this.#o.sourceVault.authenticateEncryptedCustody(capture,encryptedBudgets);await this.#owner(ctx,historical);return historical;},
            authenticateMaterial:(capture,material)=>this.#authenticateMaterial(capture,material),assertCompleteOwner:(context,historical)=>this.#owner(context,historical),assertCurrent,
            createCandidate:(record,guard)=>this.#issueCandidate(ctx,record,guard),readCandidate:()=>this.#candidate(ctx,chosen.candidateId)});await assertCurrent();return result;
        })))));
    const held=this.#scope.getStore();
    if(held){check(equal(held.context,ctx),'ACTIVATION_ROOT_GUARD','Held source context must agree.');return run();}
    return this.#withSource(ctx,null,run);
  }
  /** Trusted launch descriptor only. Public RPC returns summaries, never paths,
   * credentials, ciphertext or a reusable historical session. The host starts a
   * separate Engine/server with newly generated transport authentication. */
  async inspectOpenTarget(ctx:Context,activationId:string):Promise<FileWorkspaceLaunch>{
    const summary=await this.activation.resolve(ctx,{activationId});
    check(summary.status==='committed','ACTIVATION_COMMIT_UNKNOWN','Only exact committed readback may select an activated target.');
    const retained=await this.#find('wal_root_live_'+sha(activationId)),pin=retained?.value as any;
    check(pin?.format==='chausar.root-live-bootstrap.v1'&&pin.stateDigest===summary.stateDigest&&pin.authority?.workspaceId===summary.workspaceId
      &&pin.authority.owner.id===summary.ownerContext.memberId&&typeof pin.vaultId==='string','ACTIVATION_LIVE_CUSTODY','Trusted launch must retain the independently authenticated fresh Vault identity.');
    return{directory:join(this.targetPath(summary.targetId),'live'),workspaceId:summary.workspaceId,ownerId:summary.ownerContext.memberId,vaultId:pin.vaultId as string};
  }
  /** Constructor-only complete current-live profile used by measured namespace
   * accounting. The payload is obtained from authenticated immutable journal
   * refs, never selected by an RPC or inferred from a mutable file digest. */
  async inspectCurrentLive(input:{context:Context;targetId:string;publication:WorkspaceActivationCommit}){
    check(input.targetId===input.publication.record.targetId,'ACTIVATION_LIVE_CUSTODY','Current live admission must bind the exact issued target.');
    await this.#owner(input.context,this.#o.sourceVault.read());
    await this.#inspectLive(this.targetPath(input.targetId),input.publication);
  }
  async #prepareBootstrap(stagingDirectory:string,publication:WorkspaceActivationCommit){
    const authority=publication.authority;check(authority.context.memberId===authority.owner.id,'ACTIVATION_AUTHORITY','Fresh owner/context must agree.');
    const passphrase=await this.#o.targetPassphrase(structuredClone(authority)),directory=join(stagingDirectory,'live','main');
    const made=await Vault.createBootstrap({directory,storage:'experimental-file',passphrase,state:publication.state,expectedStateDigest:publication.record.stateDigest,
      expectedWorkspaceId:authority.workspaceId,expectedOwnerId:authority.owner.id,budgets:{maxStateBytes:16*1024*1024,maxJsonDepth:128,maxJsonNodes:200000,maxRecords:50000}});
    try{await this.#o.journalVault.writeArtifact({id:'wal_root_live_'+sha(publication.record.activationId),purpose:'workspace-interchange',expectedDigest:null,
      value:{format:'chausar.root-live-bootstrap.v1',vaultId:made.vault.vaultId,recordDigest:interchangeDigest(publication.record),stateDigest:publication.record.stateDigest,authority:structuredClone(authority)}});}finally{await made.vault.close();}
    return{liveFiles:['live/main/authority.encrypted.json'],qualification:'encrypted-local-host' as const};
  }
  async #inspectLive(targetDirectory:string,publication:WorkspaceActivationCommit){
    const pin=await this.#find('wal_root_live_'+sha(publication.record.activationId)),binding=pin?.value as any;
    check(binding?.format==='chausar.root-live-bootstrap.v1'&&binding.recordDigest===interchangeDigest(publication.record)
      &&binding.stateDigest===publication.record.stateDigest&&equal(binding.authority,publication.authority),'ACTIVATION_LIVE_CUSTODY','Independent fresh-Vault bootstrap binding differs.');
    const passphrase=await this.#o.targetPassphrase(structuredClone(publication.authority));
    const vault=await Vault.open({directory:join(targetDirectory,'live','main'),storage:'experimental-file',passphrase});
    try{const state=vault.read(),owner=state.members.find(v=>v.id===publication.authority.owner.id);
      check(vault.vaultId===binding.vaultId&&state.workspace.id===publication.authority.workspaceId&&state.revision>=0&&owner?.active&&owner.role==='owner'
        &&owner.epoch===publication.authority.owner.epoch&&state.policy.send==='nothing'&&!state.policy.autonomy&&!state.policy.sharing,
        'ACTIVATION_LIVE_CUSTODY','Actual current live authority/owner differs from fresh committed custody.');
      if(state.revision===0)check(hash(state)===publication.record.stateDigest,'ACTIVATION_LIVE_CUSTODY','Initial live State differs from exact bootstrap.');
      const sealed=['schemaVersion','workspace','members','policy','ontology','facts','imports','conflicts','merges','tombstones','sourceRules'] as const;
      check(sealed.every(key=>JSON.stringify(state[key])===JSON.stringify(publication.state[key])),
        'ACTIVATION_LIVE_CUSTODY','This sealed synthetic business profile permits fresh runtime receipts, not changes to its initial owner, policy or business projection.');
      check(['decisions','actions','jobs','learning','plugins','modelReceipts','routes','sessions','schedules'].every(key=>
        JSON.stringify(state[key as keyof State])===JSON.stringify(publication.state[key as keyof State])),
        'ACTIVATION_LIVE_CUSTODY','This current-live profile admits local answer/receipt history without added provider, job, action or session authority.');
      check(state.facts.every(f=>this.#o.policy.allowedSyntheticSourceIds.includes(f.sourceId)),'ACTIVATION_LIVE_CUSTODY','Live source scope exceeds approved synthetic evidence.');
    }finally{await vault.close();}
  }
}
