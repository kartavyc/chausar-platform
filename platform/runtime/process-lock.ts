import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { ChausarError } from './contracts.ts';

type Owner={pid:number;token:string;startedAt?:string};
type Owned={owner:Owner;raw:string};
type Options={busyCode?:string;busyMessage?:string;changedCode?:string;changedMessage?:string;unsafeCode?:string};
export type ProcessLock={path:string;token:string;release():Promise<void>};
const MAX_BYTES=4096,MAX_GENERATIONS=32;
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const fresh=():Owned=>{const owner={pid:process.pid,token:randomUUID(),startedAt:new Date().toISOString()};return{owner,raw:JSON.stringify(owner)};};
function dead(owner:Owner):boolean {try{process.kill(owner.pid,0);return false;}catch(error:any){return error.code==='ESRCH';}}
function failure(options:Options,kind:'busy'|'changed'|'unsafe',message?:string):never {
  throw new ChausarError(kind==='busy'?(options.busyCode??'PROCESS_BUSY'):kind==='changed'?(options.changedCode??'LOCK_CHANGED'):(options.unsafeCode??'UNSAFE_PATH'),message??(kind==='busy'?(options.busyMessage??'Another live or unverifiable process owns this lock.'):kind==='changed'?(options.changedMessage??'The process lock changed.'): 'A process lock must use regular files in a real directory.'));
}
async function syncDirectory(directory:string) {
  let file;try{file=await open(directory,constants.O_RDONLY);await file.sync();}
  catch(error:any){if(process.platform!=='win32'||!['EISDIR','EPERM','EACCES','EINVAL','EBADF'].includes(error.code))throw error;}
  finally{await file?.close();}
}
/** Publishes complete JSON atomically. A crash before publication cannot leave a partial owner record. */
async function publish(path:string,raw:string) {
  const temporary=join(dirname(path),`${basename(path)}.${randomUUID()}.tmp`),file=await open(temporary,'wx',0o600);
  try{await file.writeFile(raw);await file.sync();await file.close();await link(temporary,path);await unlink(temporary);await syncDirectory(dirname(path));}
  catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
async function readOwner(path:string,options:Options):Promise<Owned> {
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink())failure(options,'unsafe');
  if(before.size<=0||before.size>MAX_BYTES)failure(options,'busy');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let raw='';
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.dev!==before.dev||stat.ino!==before.ino||stat.size>MAX_BYTES)failure(options,'busy');
    const bytes=Buffer.alloc(MAX_BYTES+1),result=await file.read(bytes,0,bytes.length,0);
    if(result.bytesRead!==stat.size||result.bytesRead>MAX_BYTES)failure(options,'busy');
    raw=bytes.subarray(0,result.bytesRead).toString('utf8');
  }finally{await file.close();}
  let owner:any;try{owner=JSON.parse(raw);}catch{failure(options,'busy');}
  const keys=owner&&typeof owner==='object'&&!Array.isArray(owner)?Object.keys(owner).sort().join(','):'';
  // Existing vault locks used {token,pid}. Preserve their exact bytes while recovering them.
  if(!['pid,token','pid,startedAt,token'].includes(keys)||raw!==JSON.stringify(owner)||!Number.isSafeInteger(owner.pid)||owner.pid<=0||owner.pid>2147483647||typeof owner.token!=='string'||! /^(?:update-lock_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner.token))failure(options,'busy');
  if(keys==='pid,startedAt,token'&&(typeof owner.startedAt!=='string'||!Number.isFinite(Date.parse(owner.startedAt))||new Date(owner.startedAt).toISOString()!==owner.startedAt))failure(options,'busy');
  return{owner,raw};
}
async function recoveryClaim(path:string,original:Owned,options:Options) {
  const claims:{path:string;raw:string}[]=[];let previous=original,vanished=0;
  for(let generation=0;generation<MAX_GENERATIONS;generation++) {
    const claimPath=join(dirname(path),`${basename(path)}.recovery-${hash(previous.raw)}.lock`),ours=fresh();
    try{
      await publish(claimPath,ours.raw);claims.push({path:claimPath,raw:ours.raw});
      return async()=>{
        for(const claim of claims.reverse()) {
          try{if((await readOwner(claim.path,options)).raw===claim.raw)await unlink(claim.path);}
          catch(error:any){if(error.code!=='ENOENT')throw error;}
        }
        await syncDirectory(dirname(path));
      };
    }catch(error:any){
      if(error.code!=='EEXIST')throw error;
      let existing:Owned;
      try{existing=await readOwner(claimPath,options);}
      catch(error:any){if(error.code==='ENOENT'){if(vanished++<2){generation--;continue;}failure(options,'busy');}throw error;}
      if(!dead(existing.owner))failure(options,'busy');
      claims.push({path:claimPath,raw:existing.raw});previous=existing;
    }
  }
  failure(options,'busy','Process-lock recovery exceeds 32 abandoned generations; inspect the private lock directory.');
}
/**
 * Exclusive writer lock with conservative crash recovery. Only ESRCH proves a dead PID;
 * live/reused PIDs, EPERM, unknown ownership and malformed records always refuse recovery.
 * Atomic claims serialize recovery of the exact original bytes without compare/unlink races.
 * A crashed claim advances to another immutable generation rather than replacing that claim.
 */
export async function acquireProcessLock(path:string,options:Options={}):Promise<ProcessLock> {
  if(!isAbsolute(path))failure(options,'unsafe');
  for(let directory=dirname(path);;directory=dirname(directory)) {
    const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())failure(options,'unsafe');
    if(directory===dirname(directory))break;
  }
  const ours=fresh();let releasing:Promise<void>|undefined;
  const result=():ProcessLock=>({path,token:ours.owner.token,release(){
    if(!releasing)releasing=(async()=>{
      let current:Owned;try{current=await readOwner(path,options);}catch(error:any){if(error.code==='ENOENT')return;throw error;}
      if(current.raw!==ours.raw)failure(options,'changed');
      await unlink(path);await syncDirectory(dirname(path));
    })();
    return releasing;
  }});
  for(let attempt=0;attempt<2;attempt++) {
    try{await publish(path,ours.raw);return result();}catch(error:any){if(error.code!=='EEXIST')throw error;}
    let original:Owned;try{original=await readOwner(path,options);}catch(error:any){if(error.code==='ENOENT')continue;throw error;}
    if(attempt!==0||!dead(original.owner))failure(options,'busy');
    const releaseClaim=await recoveryClaim(path,original,options);
    try{
      let current:Owned|undefined;try{current=await readOwner(path,options);}catch(error:any){if(error.code!=='ENOENT')throw error;}
      if(current){if(current.raw!==original.raw||!dead(current.owner))failure(options,'busy');await unlink(path);}
      try{await publish(path,ours.raw);return result();}
      catch(error:any){if(error.code==='EEXIST')failure(options,'busy');throw error;}
    }finally{await releaseClaim();}
  }
  failure(options,'busy');
}
