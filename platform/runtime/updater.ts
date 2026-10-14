import { createPrivateKey, createPublicKey, createHash, verify as verifySignature, type KeyObject } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, lstat, rename, unlink, link } from 'node:fs/promises';
import { join, isAbsolute, dirname, basename } from 'node:path';
import { isIP } from 'node:net';
import { check, newId } from './contracts.ts';
import { safeDirectory } from './vault.ts';
import { acquireProcessLock } from './process-lock.ts';
import { boundedHttp, type BoundedHttp, type HttpRequest } from './connectors.ts';

const MAX_ARTIFACT = 256 * 1024 * 1024;
const MAX_BACKUP = 64 * 1024 * 1024;
export type ReleaseManifest = {
  schemaVersion:1; version:string; publishedAt:string; platform:'win32'|'linux'|'darwin'; architecture:'x64'|'arm64';
  url:string; sha256:string; size:number; minEngineVersion:string; dataSchemaVersion:number;
  rollback:{ supported:boolean; requiresBackup:true };
};
export type RollbackVaultIdentity = Readonly<{ vaultId:string; workspaceId:string; revision:number }>;
/** Only trusted engine code may supply this callback. A renderer receipt is not restore evidence. */
export type RollbackRestoreRequest = Readonly<{
  fromManifest:ReleaseManifest; toManifest:ReleaseManifest;
  fromManifestSha256:string; toManifestSha256:string; artifactSha256:string; backupSha256:string;
  artifactBytes:Uint8Array; backupBytes:Uint8Array; expectedVault:RollbackVaultIdentity;
}>;
export type RollbackRestoreResult = {
  restored:true; fromManifestSha256:string; toManifestSha256:string; artifactSha256:string; backupSha256:string;
  vaultId:string; workspaceId:string; revision:number; dataSchemaVersion:number;
};
export type RollbackRestoreValidator = (request:RollbackRestoreRequest)=>Promise<RollbackRestoreResult>;
export type PrepareRollbackOptions = {
  currentManifest:ReleaseManifest|string; currentSignature:string;
  previousManifest:ReleaseManifest|string; previousSignature:string; previousArtifactPath:string;
  backup:{ path:string; sha256:string }; expectedVault:RollbackVaultIdentity;
  validateRestore:RollbackRestoreValidator;
};
export type PreparedRollback = Readonly<{
  prepared:true; installed:false; automatic:false; fromVersion:string; toVersion:string;
  previousManifest:ReleaseManifest; previousSignature:string; artifactPath:string; artifactSha256:string; artifactSize:number;
  backup:Readonly<{path:string; sha256:string}&RollbackVaultIdentity>; restore:Readonly<RollbackRestoreResult>;
  installMode:'manual-native-installer-required'; requiresNativeInstaller:true; requiresInputRevalidation:true;
  requiresExclusiveVaultLock:true; requiresEffectReconciliation:true; requiresUserApproval:true; unsignedFallbackAllowed:false;
}>;
const FIELDS = ['schemaVersion','version','publishedAt','platform','architecture','url','sha256','size','minEngineVersion','dataSchemaVersion','rollback'].sort();
function hasExactKeys(value:any, keys:string[]) { return value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()); }
function exactKeys(value:any, keys:string[]) { check(hasExactKeys(value,keys), 'INVALID_MANIFEST', 'The release manifest has unexpected or missing fields.'); }
function versionParts(value:string) {
  check(typeof value === 'string' && value.length <= 100 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*))?$/.test(value), 'INVALID_VERSION', 'Use an explicit semantic version without build metadata.');
  const [base, ...pre] = value.split('-'), numbers = base.split('.').map(Number), prerelease = pre.length ? pre.join('-').split('.') : [];
  check(numbers.every(Number.isSafeInteger) && prerelease.every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')), 'INVALID_VERSION', 'Version components must be unambiguous.');
  return { numbers, prerelease };
}
export function compareVersions(left:string,right:string):number {
  const a = versionParts(left), b = versionParts(right);
  for (let i=0;i<3;i++) if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i]-b.numbers[i]);
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let i=0;i<Math.max(a.prerelease.length,b.prerelease.length);i++) {
    const x=a.prerelease[i], y=b.prerelease[i]; if(x===y) continue; if(x===undefined)return -1;if(y===undefined)return 1;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn)return BigInt(x)<BigInt(y)?-1:1;if(xn!==yn)return xn?-1:1;return x<y?-1:1;
  }
  return 0;
}
function canonical(value:any):string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
/** Canonical sorted JSON; this exact byte sequence is the Ed25519 signing payload. */
export function canonicalReleaseManifest(manifest:ReleaseManifest):string { return canonical(manifest); }
function validateManifest(value:any):asserts value is ReleaseManifest {
  exactKeys(value,FIELDS); exactKeys(value.rollback,['supported','requiresBackup']);
  check(value.schemaVersion===1 && typeof value.rollback.supported==='boolean' && value.rollback.requiresBackup===true, 'INVALID_MANIFEST','A version-one manifest must require a vault backup before installation.');
  versionParts(value.version); versionParts(value.minEngineVersion);
  check(typeof value.publishedAt==='string' && Number.isFinite(Date.parse(value.publishedAt)) && new Date(value.publishedAt).toISOString()===value.publishedAt && Date.parse(value.publishedAt)<=Date.now()+300000, 'INVALID_MANIFEST','The release needs a canonical publication timestamp.');
  check(['win32','linux','darwin'].includes(value.platform) && ['x64','arm64'].includes(value.architecture) && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isSafeInteger(value.size) && value.size>0 && value.size<=MAX_ARTIFACT && Number.isSafeInteger(value.dataSchemaVersion) && value.dataSchemaVersion>0 && value.dataSchemaVersion<=1000, 'INVALID_MANIFEST','The release platform, digest, size, or data version is invalid.');
  let url:URL;try{url=new URL(value.url);}catch{check(false,'INVALID_RELEASE_URL','Use an explicit HTTPS artifact URL.');}
  const host=url!.hostname.replace(/^\[|\]$/g,'');
  check(url!.protocol==='https:' && !url!.username && !url!.password && !url!.hash && (!url!.port||url!.port==='443') && !isIP(host) && host.includes('.') && !/(?:^|\.)(localhost|local|internal|test)$/.test(host) && value.url===url!.href, 'INVALID_RELEASE_URL','Release artifacts must use canonical public HTTPS URLs without credentials.');
}
/** Exported so the release signing script refuses a manifest the updater would refuse. Returns a checked copy. */
export function validateReleaseManifest(value:unknown):ReleaseManifest {
  let copy:any;try{copy=structuredClone(value);}catch{check(false,'INVALID_MANIFEST','The release manifest is not plain data.');}
  validateManifest(copy);return copy;
}
/**
 * The one pinned-key parser for manifests and channel documents. A private key passed where the public key belongs is
 * refused: createPublicKey would silently derive its public half, which means the signing secret ships inside the app.
 */
export function releasePublicKey(key:string|KeyObject):KeyObject {
  let privateText=false;
  if(typeof key==='string'){try{createPrivateKey(key);privateText=true;}catch{}}
  check(!privateText,'INVALID_UPDATE_KEY','Pin the release public key; a private key must never ship in the app.');
  let value:KeyObject|undefined;try{value=typeof key==='string'?createPublicKey(key):key;}catch{}
  check(value&&typeof value==='object'&&value.type==='public'&&value.asymmetricKeyType==='ed25519','INVALID_UPDATE_KEY','Pin an explicit Ed25519 release public key.');
  return value;
}
async function regular(path:string):Promise<boolean> {
  try { const stat=await lstat(path);check(stat.isFile()&&!stat.isSymbolicLink(),'UNSAFE_STAGE','The staging path must be a regular file without symbolic links.');return true; }
  catch(error:any){if(error.code==='ENOENT')return false;throw error;}
}
async function writeStaged(path:string,bytes:Uint8Array,replace=false) {
  const temporary=path+'.'+newId('stage')+'.tmp',file=await open(temporary,'wx',0o600);
  try {await file.writeFile(bytes);await file.sync();await file.close();if(replace){await regular(path);await rename(temporary,path);}else{await link(temporary,path);await unlink(temporary);}}
  catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
function digest(bytes:Uint8Array){return createHash('sha256').update(bytes).digest('hex');}
/** Read a bounded snapshot from a regular file, checking both handle and path identity. */
async function rollbackFile(path:string,maximum:number,code:string) {
  check(typeof path==='string'&&isAbsolute(path),'UNSAFE_ROLLBACK_PATH','Rollback inputs need absolute regular-file paths.');
  const directory=await safeDirectory(dirname(path)),resolved=join(directory,basename(path)),before=await lstat(resolved);
  check(before.isFile()&&!before.isSymbolicLink(),'UNSAFE_ROLLBACK_PATH','Rollback inputs must not be links or special files.');
  check(before.size>0&&before.size<=maximum,code,'The rollback input exceeds its allowed length.');
  // Nonblocking open prevents a substituted POSIX FIFO from hanging before fstat can refuse it.
  const file=await open(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  try {
    const same=(stat:typeof before)=>stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===before.dev&&stat.ino===before.ino&&stat.size===before.size&&stat.mtimeMs===before.mtimeMs&&stat.ctimeMs===before.ctimeMs;
    check(same(await file.stat()),'ROLLBACK_INPUT_CHANGED','A rollback input changed while it was opened.');
    const bytes=Buffer.alloc(before.size+1);let length=0;
    while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}
    check(length===before.size&&same(await file.stat())&&same(await lstat(resolved)),'ROLLBACK_INPUT_CHANGED','A rollback input changed while it was read.');
    return {path:resolved,bytes:bytes.subarray(0,length)};
  } finally {await file.close();}
}
function validateBackup(bytes:Uint8Array,expected:RollbackVaultIdentity) {
  let backup:any;try{backup=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{check(false,'INVALID_ROLLBACK_BACKUP','Use a valid encrypted Chausar backup.');}
  const ciphertext=(value:any,length?:number)=>{
    if(!hasExactKeys(value,['nonce','tag','data']))return false;
    return [['nonce',12],['tag',16],['data',length]].every(([field,size])=>{
      const text=value[field as string];if(typeof text!=='string'||!text.length||! /^[A-Za-z0-9_-]+$/.test(text))return false;
      const decoded=Buffer.from(text,'base64url');return decoded.toString('base64url')===text&&(size===undefined||decoded.length===size);
    });
  };
  const wrapper=(value:any)=>hasExactKeys(value,['salt','kdf','ciphertext'])&&value.kdf==='scrypt-32768-8-1'&&typeof value.salt==='string'&&Buffer.from(value.salt,'base64url').length===16&&Buffer.from(value.salt,'base64url').toString('base64url')===value.salt&&ciphertext(value.ciphertext,32);
  const envelope=backup?.envelope;
  check(hasExactKeys(backup,['backupFormat','envelope'])&&backup.backupFormat==='chausar.backup.v1'&&hasExactKeys(envelope,['format','id','revision','passphrase','recovery','snapshot'])&&envelope.format==='chausar.vault.v1'&&typeof envelope.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)&&Number.isSafeInteger(envelope.revision)&&envelope.revision>=0&&wrapper(envelope.passphrase)&&wrapper(envelope.recovery)&&ciphertext(envelope.snapshot),'INVALID_ROLLBACK_BACKUP','Use a version-one encrypted Chausar backup with complete key wrappers.');
  check(envelope.id===expected.vaultId&&envelope.revision===expected.revision,'ROLLBACK_BACKUP_MISMATCH','The backup belongs to a different vault or revision.');
}
export class ReleaseUpdater {
  #key:KeyObject;
  #version:string;
  #directory:string;
  #http:BoundedHttp;
  constructor(options:{publicKey:string|KeyObject;version:string;stageDirectory:string;http?:BoundedHttp}) {
    this.#key=releasePublicKey(options.publicKey);
    versionParts(options.version);check(isAbsolute(options.stageDirectory),'UNSAFE_STAGE','Choose an absolute private staging directory.');
    this.#version=options.version;this.#directory=options.stageDirectory;this.#http=options.http??boundedHttp;
  }
  verify(manifest:ReleaseManifest|string,signature:string):ReleaseManifest {
    const value=this.#authenticate(manifest,signature);
    check(compareVersions(value.version,this.#version)>0,'RELEASE_DOWNGRADE_REFUSED','The release must be newer than the running version.');
    check(compareVersions(this.#version,value.minEngineVersion)>=0,'INCOMPATIBLE_ENGINE','Install an intermediate compatible engine before this release.');
    return value;
  }
  #authenticate(manifest:ReleaseManifest|string,signature:string):ReleaseManifest {
    let value:any;
    check(typeof manifest !== 'string' || Buffer.byteLength(manifest) <= 65536, 'INVALID_MANIFEST', 'The signed manifest exceeds its byte limit.');
    try{value=typeof manifest==='string'?JSON.parse(manifest):structuredClone(manifest);}catch{check(false,'INVALID_MANIFEST','The signed manifest is not valid JSON data.');}
    validateManifest(value);
    const payload=canonicalReleaseManifest(value);
    check(typeof manifest!=='string'||manifest===payload,'NONCANONICAL_MANIFEST','Verify the exact canonical signing payload, without duplicate keys or alternate encodings.');
    check(typeof signature==='string' && signature.length === 86 && /^[A-Za-z0-9_-]+$/.test(signature),'INVALID_RELEASE_SIGNATURE','A release requires a detached base64url Ed25519 signature.');
    const bytes=Buffer.from(signature,'base64url');
    check(bytes.length===64 && bytes.toString('base64url')===signature && verifySignature(null,Buffer.from(payload),this.#key,bytes),'INVALID_RELEASE_SIGNATURE','The release signature is invalid.');
    check(value.platform===process.platform && value.architecture===process.arch,'INCOMPATIBLE_PLATFORM','This signed artifact targets a different operating system or architecture.');
    return Object.freeze({...value,rollback:Object.freeze({...value.rollback})});
  }
  /** Checks local rollback prerequisites; it never installs a package or restores the authoritative vault. */
  async prepareRollback(options:PrepareRollbackOptions):Promise<PreparedRollback> {
    const previousSignature=options.previousSignature;
    const current=this.#authenticate(options.currentManifest,options.currentSignature),previous=this.#authenticate(options.previousManifest,previousSignature);
    check(current.version===this.#version,'ROLLBACK_VERSION_MISMATCH','The current signed release must identify the running engine.');
    check(compareVersions(previous.version,current.version)<0,'INVALID_ROLLBACK_TARGET','A rollback target must be an explicitly verified older release.');
    check(current.rollback.supported,'ROLLBACK_UNSUPPORTED','The running release does not declare rollback support.');
    check(typeof options.validateRestore==='function','ROLLBACK_RESTORE_REQUIRED','Trusted engine code must validate a disposable restore before preparing rollback.');
    const expected=Object.freeze({...options.expectedVault}),backup={...options.backup},validator=options.validateRestore;
    check(hasExactKeys(expected,['vaultId','workspaceId','revision'])&&typeof expected.vaultId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(expected.vaultId)&&typeof expected.workspaceId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(expected.workspaceId)&&Number.isSafeInteger(expected.revision)&&expected.revision>=0,'INVALID_ROLLBACK_IDENTITY','Capture the expected vault, workspace and backup revision from trusted engine state.');
    check(typeof backup.sha256==='string'&&/^[a-f0-9]{64}$/.test(backup.sha256),'INVALID_ROLLBACK_BACKUP','Pin the digest captured when the encrypted backup was created.');
    const artifact=await rollbackFile(options.previousArtifactPath,previous.size,'ROLLBACK_ARTIFACT_MISMATCH');
    check(artifact.bytes.length===previous.size&&digest(artifact.bytes)===previous.sha256,'ROLLBACK_ARTIFACT_MISMATCH','The previous package differs from its signed length or digest.');
    const snapshot=await rollbackFile(backup.path,MAX_BACKUP,'INVALID_ROLLBACK_BACKUP');
    check(digest(snapshot.bytes)===backup.sha256,'ROLLBACK_BACKUP_MISMATCH','The backup differs from its pinned digest.');validateBackup(snapshot.bytes,expected);
    const bindings={fromManifestSha256:digest(Buffer.from(canonicalReleaseManifest(current))),toManifestSha256:digest(Buffer.from(canonicalReleaseManifest(previous))),artifactSha256:previous.sha256,backupSha256:backup.sha256};
    let restored:RollbackRestoreResult;
    try {
      restored=await validator(Object.freeze({...bindings,fromManifest:current,toManifest:previous,artifactBytes:Uint8Array.from(artifact.bytes),backupBytes:Uint8Array.from(snapshot.bytes),expectedVault:expected}));
    } catch {check(false,'ROLLBACK_RESTORE_UNVERIFIED','The trusted restore validation failed. The authoritative vault was not changed by the updater.');}
    check(hasExactKeys(restored!,['restored','fromManifestSha256','toManifestSha256','artifactSha256','backupSha256','vaultId','workspaceId','revision','dataSchemaVersion'])&&restored!.restored===true&&Object.entries(bindings).every(([key,value])=>restored![key as keyof RollbackRestoreResult]===value)&&restored!.vaultId===expected.vaultId&&restored!.workspaceId===expected.workspaceId&&restored!.revision===expected.revision,'ROLLBACK_RESTORE_UNVERIFIED','The restore result is not bound to this package, backup, workspace and revision.');
    check(Number.isSafeInteger(restored!.dataSchemaVersion)&&restored!.dataSchemaVersion===previous.dataSchemaVersion,'ROLLBACK_SCHEMA_INCOMPATIBLE','The restored data schema is not supported by the previous signed package.');
    // A plan is a snapshot of checked bytes, not authority to execute files that may later change.
    return Object.freeze({prepared:true,installed:false,automatic:false,fromVersion:current.version,toVersion:previous.version,previousManifest:previous,previousSignature,artifactPath:artifact.path,artifactSha256:previous.sha256,artifactSize:previous.size,backup:Object.freeze({path:snapshot.path,sha256:backup.sha256,...expected}),restore:Object.freeze({...restored!}),installMode:'manual-native-installer-required',requiresNativeInstaller:true,requiresInputRevalidation:true,requiresExclusiveVaultLock:true,requiresEffectReconciliation:true,requiresUserApproval:true,unsignedFallbackAllowed:false});
  }
  async stage(manifest:ReleaseManifest|string,signature:string) {
    const verified=this.verify(manifest,signature),directory=await safeDirectory(this.#directory,true),lockPath=join(directory,'stage.lock');
    const lock=await acquireProcessLock(lockPath,{busyCode:'UPDATE_BUSY',changedCode:'UPDATE_LOCK_CHANGED',unsafeCode:'UNSAFE_STAGE'});
    try {
      const pendingPath=join(directory,'pending-release.json');
      if(await regular(pendingPath)) {
        check((await lstat(pendingPath)).size<=65536,'UNSAFE_STAGE','The pending release record exceeds its limit.');const raw=await readFile(pendingPath,'utf8');
        let pending:any;try{pending=JSON.parse(raw);}catch{check(false,'UNSAFE_STAGE','The pending release record is not valid JSON.');}
        const prior=this.#authenticate(pending.manifest,pending.signature);
        check(compareVersions(verified.version,prior.version)>=0,'RELEASE_DOWNGRADE_REFUSED','A newer signed release has already been staged.');
        if(compareVersions(verified.version,prior.version)===0)check(canonicalReleaseManifest(verified)===canonicalReleaseManifest(prior),'RELEASE_VERSION_CONFLICT','The same version was signed with different release contents.');
      }
      const request:HttpRequest={url:verified.url,method:'GET',headers:{Accept:'application/octet-stream'},maxBytes:verified.size,timeoutMs:60000,redirect:'error'};
      const response=await this.#http(request);
      check(response.status===200 && (!response.url||response.url===verified.url),'RELEASE_FETCH_REFUSED','The release download failed or redirected.');
      const bytes=typeof response.body==='string'?Buffer.from(response.body):Buffer.from(response.body);
      check(bytes.length===verified.size && bytes.length<=MAX_ARTIFACT && digest(bytes)===verified.sha256,'RELEASE_HASH_MISMATCH','The staged artifact length or SHA-256 does not match the signed manifest.');
      const artifactPath=join(directory,`release-${verified.version}-${verified.sha256.slice(0,16)}.artifact`);
      if(await regular(artifactPath)) {check((await lstat(artifactPath)).size===verified.size,'UNSAFE_STAGE','An existing staged artifact was modified.');const existing=await readFile(artifactPath);check(existing.length===verified.size&&digest(existing)===verified.sha256,'UNSAFE_STAGE','An existing staged artifact was modified.');}
      else await writeStaged(artifactPath,bytes);
      const rollback={fromVersion:verified.version,toVersion:this.#version,automatic:false,requiresVaultBackup:true,requiresVerifiedPreviousPackage:true,requiresNativeInstaller:true,dataSchemaVersion:verified.dataSchemaVersion};
      const record={manifest:verified,signature,artifactPath,baseVersion:this.#version,rollback,verifiedAt:new Date().toISOString(),installed:false};
      await writeStaged(pendingPath,Buffer.from(JSON.stringify(record)),true);
      return {...record,staged:true,installMode:'manual-native-installer-required',unsignedFallbackAllowed:false};
    } finally {await lock.release();}
  }
}
