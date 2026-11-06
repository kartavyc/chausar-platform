// Original client APK source boundary. Reuses the shared bounded ZIP reader; no archive member is executed or extracted.
import {open,lstat,mkdtemp,writeFile,rm} from 'node:fs/promises';import {isAbsolute,basename,join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {openSync,fstatSync,readFileSync,closeSync,lstatSync} from 'node:fs';
import {check,ChausarError} from '../../../portable.ts';import {unzip} from '../kit/ooxml/zip.ts';
export const APK_MAX_BYTES=64*1024*1024;
export type ClientApk={path:string;name:string;sha256:string;bytes:number};
/** This is archive validation only. Package/activity identity must still come from the installed Android SDK analyzer. */
export function checkApkArchive(bytes:Uint8Array){
 check(bytes.length>0&&bytes.length<=APK_MAX_BYTES,'CLIENT_APK_REQUIRED','Choose a client APK up to 64 megabytes.');
 try{const entries=unzip(bytes,{maxEntries:20_000,maxBytes:128*1024*1024});const names=entries.map(e=>e.name);check(new Set(names).size===names.length&&names.filter(n=>n==='AndroidManifest.xml').length===1&&names.some(n=>/^classes(?:[0-9]+)?\.dex$/.test(n)||n==='resources.arsc'),'CLIENT_APK_REQUIRED','Choose a complete client APK, with one manifest and its code or resources.');}catch{throw new ChausarError('CLIENT_APK_REQUIRED','The client APK could not be checked. Use a complete, bounded Android APK.');}
}
async function load(path:string){
 check(typeof path==='string'&&isAbsolute(path)&&!path.startsWith('\\\\')&&!path.startsWith('//')&&/\.apk$/i.test(path)&&!/[\x00-\x1f]/.test(path),'CLIENT_APK_REQUIRED','Choose the client APK on this computer, not a network path.');
 let file:Awaited<ReturnType<typeof open>>|undefined;
 try{const before=await lstat(path);check(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=APK_MAX_BYTES,'CLIENT_APK_REQUIRED','Choose a regular client APK up to 64 megabytes.');file=await open(path,'r');const opened=await file.stat();check(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size,'CLIENT_APK_REQUIRED','The client APK changed while opening it. Choose it again.');const bytes=await file.readFile();const after=await file.stat();check(after.size===opened.size&&after.mtimeMs===opened.mtimeMs&&bytes.length===opened.size,'APPROVAL_STALE','The client APK changed while reading it. Choose it again.');checkApkArchive(bytes);return {source:{path,name:basename(path),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},bytes};}
 catch(error){if(error instanceof ChausarError)throw error;throw new ChausarError('CLIENT_APK_REQUIRED','The client APK is missing or unreadable. Choose it again on this computer.');}finally{await file?.close();}
}
/** Read and fingerprint a file selected by the owner. The UI receives metadata, never the local path or APK bytes. */
export async function readClientApk(path:string):Promise<ClientApk>{return (await load(path)).source;}
/** The final dispatch boundary is synchronous: no awaited read can reopen a stale owner approval. */
export function assertClientApk(source:ClientApk){let fd:number|undefined;try{const entry=lstatSync(source.path);check(entry.isFile()&&!entry.isSymbolicLink()&&entry.size===source.bytes&&entry.size<=APK_MAX_BYTES,'APPROVAL_STALE','The client APK changed. Import it again.');fd=openSync(source.path,'r');const info=fstatSync(fd);check(info.ino===entry.ino&&info.dev===entry.dev&&info.size===source.bytes,'APPROVAL_STALE','The client APK changed. Import it again.');const bytes=readFileSync(fd);check(bytes.length===source.bytes&&createHash('sha256').update(bytes).digest('hex')===source.sha256,'APPROVAL_STALE','The client APK changed. Import it again.');}catch(error){if(error instanceof ChausarError)throw error;throw new ChausarError('APPROVAL_STALE','The client APK is no longer available. Import it again.');}finally{if(fd!==undefined)closeSync(fd);}}
/** Every invocation rechecks actual source bytes, then gives the SDK a private copy that is always removed. */
export async function withClientApk<T>(source:ClientApk,run:(privatePath:string)=>Promise<T>):Promise<T>{
 source={...source};const current=await load(source.path);check(current.source.sha256===source.sha256&&current.source.bytes===source.bytes,'APPROVAL_STALE','The client APK changed. Import it and approve a new plan.');
 const folder=await mkdtemp(join(tmpdir(),'chausar-client-apk-'));try{const path=join(folder,'client.apk');await writeFile(path,current.bytes,{flag:'wx',mode:0o600});return await run(path);}finally{await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
