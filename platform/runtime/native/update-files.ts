import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { check } from '../contracts.ts';

/** Test-only fault injection: runs after the temporary file is durable and before the atomic rename. */
export type AtomicWriteHooks = { beforeRename?: (temporaryPath:string)=>void|Promise<void> };

export async function syncDirectory(directory:string) {
  let file;try{file=await open(directory,constants.O_RDONLY);await file.sync();}
  catch(error:any){if(process.platform!=='win32'||!['EISDIR','EPERM','EACCES','EINVAL','EBADF'].includes(error.code))throw error;}
  finally{await file?.close();}
}
/** Write complete JSON to a private temporary file, fsync it, rename it over the target and fsync the directory. */
export async function writeJsonAtomic(path:string,value:unknown,hooks:AtomicWriteHooks={}) {
  const temporary=join(dirname(path),`.${basename(path)}.${randomUUID()}.tmp`),file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(JSON.stringify(value));await file.sync();await file.close();
    await hooks.beforeRename?.(temporary);
    await rename(temporary,path);await syncDirectory(dirname(path));
  }catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
/** Read a small regular JSON file; absence returns undefined. Links, special files and oversize records refuse. */
export async function readJsonFile(path:string,maximum:number,code:string):Promise<unknown> {
  let before;try{before=await lstat(path);}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}
  check(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maximum,code,'A release record is not a small regular file.');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  try{
    const stat=await file.stat();check(stat.isFile()&&stat.ino===before.ino&&stat.size===before.size,code,'A release record changed while it was opened.');
    const bytes=Buffer.alloc(stat.size+1),read=await file.read(bytes,0,bytes.length,0);
    check(read.bytesRead===stat.size,code,'A release record changed while it was read.');
    let text='';try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,read.bytesRead));}catch{check(false,code,'A release record is not valid text.');}
    try{return JSON.parse(text);}catch{check(false,code,'A release record is not valid JSON.');}
  }finally{await file.close();}
}
/** Stream a regular file's SHA-256 and length, checking that its identity is unchanged by the end of the read. */
export async function hashRegularFile(path:string,code:string,message:string):Promise<{sha256:string;size:number;birthtimeMs:number;mtimeMs:number}> {
  let before;try{before=await lstat(path);}catch(error:any){if(error.code==='ENOENT')check(false,code,message);throw error;}
  check(before.isFile()&&!before.isSymbolicLink(),code,message);
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  try{
    const same=(stat:typeof before)=>stat.isFile()&&stat.dev===before.dev&&stat.ino===before.ino&&stat.size===before.size&&stat.mtimeMs===before.mtimeMs;
    check(same(await file.stat()),code,message);
    const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let size=0;
    while(true){const read=await file.read(buffer,0,buffer.length,size);if(!read.bytesRead)break;digest.update(buffer.subarray(0,read.bytesRead));size+=read.bytesRead;}
    check(size===before.size&&same(await file.stat())&&same(await lstat(path)),code,message);
    return {sha256:digest.digest('hex'),size,birthtimeMs:before.birthtimeMs,mtimeMs:before.mtimeMs};
  }finally{await file.close();}
}
export const isoTimestamp=(value:unknown):value is string=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export const exactKeys=(value:any,keys:readonly string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
