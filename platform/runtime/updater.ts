import { createPublicKey, createHash, randomBytes, verify as verifySignature, type KeyObject } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { open, readFile, lstat, rename, unlink, link, mkdir } from 'node:fs/promises';
import { join, isAbsolute, dirname, basename } from 'node:path';
import { isIP } from 'node:net';
import { check, internalCheck, newId } from './contracts.ts';
import { safeDirectory } from './vault.ts';
import { acquireProcessLock } from './process-lock.ts';
import type { BoundedHttp } from './connectors.ts';

// C5 task 31: the cap is the signed size, under a 512 MiB ceiling (the beta installer is about 309 MB).
const MAX_ARTIFACT = 512 * 1024 * 1024;
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

// C5 task 30: the signed feed. One file lists every release, signed whole with the same pinned key and in the same
// canonical form as a manifest; each release inside keeps its own manifest signature, so a picked release is checked
// twice and staged exactly as before. The install's bucket, sha256(installId + version) mod 100, decides a staged rollout.
export type ReleaseChannel = 'beta'|'stable';
export type FeedRelease = { manifest:ReleaseManifest; signature:string };
/** expiresAt (review round 1): signed with the rest, so a replayed old feed is refused once it expires. */
export type ReleaseFeed = { schemaVersion:1; channel:ReleaseChannel; rolloutPercent:number; expiresAt:string; releases:FeedRelease[] };
export type FeedChoice = Readonly<{ offer:FeedRelease|null; reason:'offered'|'up-to-date'|'no-release'|'not-in-rollout' }>;
const MAX_FEED_BYTES = 1024 * 1024, MAX_FEED_RELEASES = 64;
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = Object.freeze(['beta','stable']);
/** Canonical sorted JSON of the whole feed; this exact byte sequence is the feed's Ed25519 signing payload. */
export function canonicalReleaseFeed(feed:ReleaseFeed):string { return canonical(feed); }
/** This install's place in a staged rollout of one version, 0 to 99. The same id and version always give the same place. */
export function rolloutBucket(installId:string,version:string):number {
  return createHash('sha256').update(installId+version).digest().readUIntBE(0,6)%100;
}
const INSTALL_ID = /^[a-f0-9]{32}$/;
/** The install's random id, made once and kept in <updates>/install-id. A missing or damaged file gets a fresh id. */
export async function installIdIn(updatesFolder:string):Promise<string> {
  check(typeof updatesFolder==='string'&&isAbsolute(updatesFolder),'UNSAFE_STAGE','Choose an absolute updates folder.');
  await mkdir(updatesFolder,{recursive:true});
  const directory=await safeDirectory(updatesFolder),path=join(directory,'install-id'),exists=await regular(path);
  if(exists&&(await lstat(path)).size<=64){const kept=(await readFile(path,'utf8')).trim();if(INSTALL_ID.test(kept))return kept;}
  const made=randomBytes(16).toString('hex');
  await writeStaged(path,Buffer.from(made+'\n'),exists);
  return made;
}
function signatureBytes(signature:unknown,code:string,message:string):Buffer {
  check(typeof signature==='string'&&signature.length===86&&/^[A-Za-z0-9_-]+$/.test(signature),code,message);
  const bytes=Buffer.from(signature as string,'base64url');check(bytes.length===64&&bytes.toString('base64url')===signature,code,message);return bytes;
}
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
async function fileDigest(path:string,hash=createHash('sha256')){for await(const chunk of createReadStream(path))hash.update(chunk as Buffer);return hash;}

// C5 task 31, the stage half: a release is fetched as a stream. `ReleaseDownload` is the seam: tests pass a stand-in,
// the app uses `fetchDownload` (fetch, a redirect followed only to the release hosts, and an idle timer). A BoundedHttp passed as `http` still
// works and is read as one chunk, so older callers keep their shape.
export type DownloadRequest = { url:string; headers:Record<string,string>; idleTimeoutMs:number; redirect:'error' };
export type DownloadResponse = { status:number; url?:string; headers?:Record<string,string>; body:AsyncIterable<Uint8Array> };
export type ReleaseDownload = (request:DownloadRequest)=>Promise<DownloadResponse>;
const IDLE_TIMEOUT_MS = 60000;
/** GitHub's release hosts: where a release link may send a download or the feed. */
export const RELEASE_HOSTS = Object.freeze(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_HOPS = 5;
/** One address, following only https redirects to the release hosts (and the address's own host). */
export async function followRelease(url:string,init:RequestInit,fetcher:typeof fetch):Promise<Response>{
  const allowed=new Set([...RELEASE_HOSTS,new URL(url).hostname]);
  let at=url;
  for(let count=0;count<=MAX_HOPS;count+=1){
    const response=await fetcher(at,{...init,redirect:'manual'});
    if(response.status<300||response.status>=400)return response;
    const location=response.headers.get('location');
    const next=location?new URL(location,at):null;
    check(next&&next.protocol==='https:'&&allowed.has(next.hostname)&&count<MAX_HOPS,'UPDATE_REDIRECT_REFUSED','The update host sent Chausar somewhere it does not trust.');
    at=next!.href;
  }
  return check(false,'UPDATE_REDIRECT_REFUSED','The update host sent Chausar somewhere it does not trust.') as never;
}
/**
 * The app's download: a GitHub release link always redirects to its asset host, so a redirect is followed only to the
 * release hosts. The stream is aborted when no byte arrives for the idle time. No response url goes back: where the bytes
 * came from doesn't matter, since the signed length and hash decide.
 */
export async function fetchDownload(request:DownloadRequest,fetcher:typeof fetch=fetch):Promise<DownloadResponse>{
  const controller=new AbortController();let timer=setTimeout(()=>controller.abort(),request.idleTimeoutMs);
  const response=await followRelease(request.url,{method:'GET',headers:request.headers,signal:controller.signal},fetcher).catch(error=>{clearTimeout(timer);throw error;});
  const headers:Record<string,string>={};response.headers.forEach((value,key)=>{headers[key]=value;});
  const reader=response.body?.getReader();
  async function*body(){
    try{while(reader){const {done,value}=await reader.read();if(done)return;clearTimeout(timer);timer=setTimeout(()=>controller.abort(),request.idleTimeoutMs);yield value;}}
    finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
  }
  return {status:response.status,headers,body:body()};
}
function fromBoundedHttp(http:BoundedHttp,maxBytes:number):ReleaseDownload{
  return async request=>{
    const response=await http({url:request.url,method:'GET',headers:request.headers,maxBytes,timeoutMs:request.idleTimeoutMs,redirect:'error'});
    const bytes=typeof response.body==='string'?Buffer.from(response.body):Buffer.from(response.body);
    return {status:response.status,url:response.url,headers:response.headers,body:(async function*(){yield bytes;})()};
  };
}
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
  #http:BoundedHttp|undefined;
  #download:ReleaseDownload|undefined;
  constructor(options:{publicKey:string|KeyObject;version:string;stageDirectory:string;http?:BoundedHttp;download?:ReleaseDownload}) {
    this.#key=typeof options.publicKey==='string'?createPublicKey(options.publicKey):options.publicKey;
    check(this.#key.type==='public' && this.#key.asymmetricKeyType==='ed25519','INVALID_UPDATE_KEY','Pin an explicit Ed25519 release public key.');
    versionParts(options.version);check(isAbsolute(options.stageDirectory),'UNSAFE_STAGE','Choose an absolute private staging directory.');
    this.#version=options.version;this.#directory=options.stageDirectory;this.#http=options.http;this.#download=options.download;
  }
  verify(manifest:ReleaseManifest|string,signature:string):ReleaseManifest {
    const value=this.#authenticate(manifest,signature);
    check(compareVersions(value.version,this.#version)>0,'RELEASE_DOWNGRADE_REFUSED','The release must be newer than the running version.');
    check(compareVersions(this.#version,value.minEngineVersion)>=0,'INCOMPATIBLE_ENGINE','Install an intermediate compatible engine before this release.');
    return value;
  }
  /**
   * Checks the whole feed against the pinned key, then every release in it, then picks this platform's newest release
   * that this engine may install. A changed byte, another key, another channel or a bad release refuses the feed; a
   * feed with nothing newer here, or a rollout this install is outside, offers nothing.
   */
  verifyFeed(feed:ReleaseFeed|string,signature:string,options:{channel:ReleaseChannel;installId:string;now?:Date}):FeedChoice {
    check(RELEASE_CHANNELS.includes(options?.channel)&&typeof options.installId==='string'&&options.installId.length>0&&options.installId.length<=100,'INVALID_FEED','Name this install\'s channel and id before reading a feed.');
    check(typeof feed!=='string'||Buffer.byteLength(feed)<=MAX_FEED_BYTES,'INVALID_FEED','The update feed exceeds its byte limit.');
    let value:any;try{value=typeof feed==='string'?JSON.parse(feed):structuredClone(feed);}catch{check(false,'INVALID_FEED','The update feed is not valid JSON data.');}
    check(hasExactKeys(value,['schemaVersion','channel','rolloutPercent','expiresAt','releases'])&&value.schemaVersion===1&&typeof value.expiresAt==='string'&&Number.isFinite(Date.parse(value.expiresAt))&&new Date(value.expiresAt).toISOString()===value.expiresAt&&RELEASE_CHANNELS.includes(value.channel)&&Number.isSafeInteger(value.rolloutPercent)&&value.rolloutPercent>=0&&value.rolloutPercent<=100&&Array.isArray(value.releases)&&value.releases.length>0&&value.releases.length<=MAX_FEED_RELEASES&&value.releases.every((release:any)=>hasExactKeys(release,['manifest','signature'])),'INVALID_FEED','The update feed has unexpected or missing fields.');
    const payload=canonical(value);
    check(typeof feed!=='string'||feed===payload,'NONCANONICAL_FEED','Verify the exact canonical feed, without duplicate keys or alternate encodings.');
    const bytes=signatureBytes(signature,'INVALID_FEED_SIGNATURE','A feed requires a detached base64url Ed25519 signature.');
    check(verifySignature(null,Buffer.from(payload),this.#key,bytes),'INVALID_FEED_SIGNATURE','The update feed signature is invalid.');
    check(Date.parse(value.expiresAt)>(options.now??new Date()).getTime(),'FEED_EXPIRED','This update feed has expired, or this computer\'s clock may be wrong. Chausar checks for a newer one later.');
    check(value.channel===options.channel,'FEED_CHANNEL_MISMATCH','This feed is for another release channel.');
    const releases:FeedRelease[]=value.releases.map((release:any)=>({manifest:this.#authenticate(release.manifest,release.signature,false),signature:release.signature}));
    const seen=new Map<string,string>();
    for(const {manifest} of releases){const key=`${manifest.platform}/${manifest.architecture}/${manifest.version}`,body=canonicalReleaseManifest(manifest);check(!seen.has(key)||seen.get(key)===body,'INVALID_FEED','The feed lists one version twice with different contents.');seen.set(key,body);}
    const here=releases.filter(({manifest})=>manifest.platform===process.platform&&manifest.architecture===process.arch&&compareVersions(this.#version,manifest.minEngineVersion)>=0);
    if(!here.length)return Object.freeze({offer:null,reason:'no-release'});
    const newest=here.reduce((best,release)=>compareVersions(release.manifest.version,best.manifest.version)>0?release:best);
    if(compareVersions(newest.manifest.version,this.#version)<=0)return Object.freeze({offer:null,reason:'up-to-date'});
    if(rolloutBucket(options.installId,newest.manifest.version)>=value.rolloutPercent)return Object.freeze({offer:null,reason:'not-in-rollout'});
    return Object.freeze({offer:Object.freeze({manifest:newest.manifest,signature:newest.signature}),reason:'offered'});
  }
  #authenticate(manifest:ReleaseManifest|string,signature:string,thisPlatform=true):ReleaseManifest {
    let value:any;
    check(typeof manifest !== 'string' || Buffer.byteLength(manifest) <= 65536, 'INVALID_MANIFEST', 'The signed manifest exceeds its byte limit.');
    try{value=typeof manifest==='string'?JSON.parse(manifest):structuredClone(manifest);}catch{check(false,'INVALID_MANIFEST','The signed manifest is not valid JSON data.');}
    validateManifest(value);
    const payload=canonicalReleaseManifest(value);
    check(typeof manifest!=='string'||manifest===payload,'NONCANONICAL_MANIFEST','Verify the exact canonical signing payload, without duplicate keys or alternate encodings.');
    const bytes=signatureBytes(signature,'INVALID_RELEASE_SIGNATURE','A release requires a detached base64url Ed25519 signature.');
    check(verifySignature(null,Buffer.from(payload),this.#key,bytes),'INVALID_RELEASE_SIGNATURE','The release signature is invalid.');
    if(thisPlatform)check(value.platform===process.platform && value.architecture===process.arch,'INCOMPATIBLE_PLATFORM','This signed artifact targets a different operating system or architecture.');
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
  /**
   * Streams the signed artifact into <artifact>.part with a running SHA-256, then links it into place. A cut stream keeps
   * the part file and the next stage asks only for the rest (Range); a server that ignores the Range starts it again.
   * A body longer or shorter than the signed size, or with another digest, deletes the part file.
   */
  async #fetchTo(verified:ReleaseManifest,artifactPath:string) {
    const partPath=artifactPath+'.part';let offset=0,hash=createHash('sha256');
    if(await regular(partPath)){
      const size=(await lstat(partPath)).size;
      if(size>0&&size<verified.size){hash=await fileDigest(partPath);offset=size;}else await unlink(partPath);
    }
    const download=this.#download??(this.#http?fromBoundedHttp(this.#http,verified.size):fetchDownload);
    const headers:Record<string,string>={Accept:'application/octet-stream'};if(offset)headers.Range=`bytes=${offset}-`;
    const response=await download({url:verified.url,headers,idleTimeoutMs:IDLE_TIMEOUT_MS,redirect:'error'});
    check(!response.url||response.url===verified.url,'RELEASE_FETCH_REFUSED','The release download failed or redirected.');
    if(offset&&response.status===200){offset=0;hash=createHash('sha256');}
    else if(offset){
      const range=response.headers?.['content-range']??response.headers?.['Content-Range'];
      check(response.status===206&&range===`bytes ${offset}-${verified.size-1}/${verified.size}`,'RELEASE_FETCH_REFUSED','The release server answered another part of the file.');
    } else check(response.status===200,'RELEASE_FETCH_REFUSED','The release download failed or redirected.');
    const file=await open(partPath,offset?'a':'w',0o600);let written=offset,finished=false;
    try {
      try {
        for await (const chunk of response.body) {
          written+=chunk.byteLength;
          if(written>verified.size)break;
          hash.update(chunk);await file.write(chunk);
        }
        finished=true;
      } catch {
        await file.sync().catch(()=>{});
        check(false,'RELEASE_DOWNLOAD_CUT','The download stopped part way. It continues from there next time.');
      }
    } finally {await file.close();if(finished&&(written!==verified.size||hash.copy().digest('hex')!==verified.sha256))await unlink(partPath).catch(()=>{});}
    if(written!==verified.size||hash.digest('hex')!==verified.sha256){await unlink(partPath).catch(()=>{});internalCheck(false,'RELEASE_HASH_MISMATCH','The staged artifact length or SHA-256 does not match the signed manifest.');}
    await link(partPath,artifactPath);await unlink(partPath);
  }
  async stage(manifest:ReleaseManifest|string,signature:string) {
    const verified=this.verify(manifest,signature),directory=await safeDirectory(this.#directory,true),lockPath=join(directory,'stage.lock');
    const lock=await acquireProcessLock(lockPath,{busyCode:'UPDATE_BUSY',changedCode:'UPDATE_LOCK_CHANGED',unsafeCode:'UNSAFE_STAGE'});
    try {
      const pendingPath=join(directory,'pending-release.json');
      if(await regular(pendingPath)) {
        check((await lstat(pendingPath)).size<=65536,'UNSAFE_STAGE','The pending release record exceeds its limit.');const raw=await readFile(pendingPath,'utf8');
        const pending=JSON.parse(raw),prior=this.#authenticate(pending.manifest,pending.signature);
        check(compareVersions(verified.version,prior.version)>=0,'RELEASE_DOWNGRADE_REFUSED','A newer signed release has already been staged.');
        if(compareVersions(verified.version,prior.version)===0)check(canonicalReleaseManifest(verified)===canonicalReleaseManifest(prior),'RELEASE_VERSION_CONFLICT','The same version was signed with different release contents.');
      }
      const artifactPath=join(directory,`release-${verified.version}-${verified.sha256.slice(0,16)}.artifact`);
      if(await regular(artifactPath)) {check((await lstat(artifactPath)).size===verified.size,'UNSAFE_STAGE','An existing staged artifact was modified.');check((await fileDigest(artifactPath)).digest('hex')===verified.sha256,'UNSAFE_STAGE','An existing staged artifact was modified.');}
      else await this.#fetchTo(verified,artifactPath);
      const rollback={fromVersion:verified.version,toVersion:this.#version,automatic:false,requiresVaultBackup:true,requiresVerifiedPreviousPackage:true,requiresNativeInstaller:true,dataSchemaVersion:verified.dataSchemaVersion};
      const record={manifest:verified,signature,artifactPath,baseVersion:this.#version,rollback,verifiedAt:new Date().toISOString(),installed:false};
      await writeStaged(pendingPath,Buffer.from(JSON.stringify(record)),true);
      return {...record,staged:true,installMode:'manual-native-installer-required',unsignedFallbackAllowed:false};
    } finally {await lock.release();}
  }
}
