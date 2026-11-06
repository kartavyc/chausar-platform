// Genuine browser Office files. Same code-owned content as the native career renderer, no PDF capability claim.
import {sha256} from '@noble/hashes/sha2.js';import {bytesToHex} from '@noble/hashes/utils.js';
import {docxParts} from '../../../../platform/runtime/venture/playbooks/kit/ooxml/docx-parts';
import {storedZipBytes} from '../../../../platform/runtime/venture/playbooks/kit/ooxml/browser';
import type {CareerStoredPack} from '../../../../platform/runtime/venture/playbooks/job-search-desk/thread-state';
import type {CareerPackFile} from '../../../../platform/runtime/venture/playbooks/job-search-desk/file-types';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const bytesHash=(b:Uint8Array)=>bytesToHex(sha256(b));
export function fakeCareerFiles(kind:string,text:string){const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>Career pack</title><body><h1>Career pack</h1>'+text.split('\n').map(line=>'<p>'+escape(line)+'</p>').join('')+'</body></html>';
 const file=(name:string,mime:string,bytes:Uint8Array):CareerPackFile=>{let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return{name,mime,contentBase64:btoa(binary),bytes:bytes.length,sha256:bytesHash(bytes)};};
 return {files:[file(kind+'.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',storedZipBytes(docxParts({cover:{title:'Career pack'},sections:[{heading:'Approved evidence',paragraphs:text.split('\n')}]}))),file(kind+'.html','text/html',new TextEncoder().encode(html))],note:'A PDF needs the desktop app.'};}
export function fakeCareerFilesValid(pack:CareerStoredPack){return pack.files.length===2&&new Set(pack.files.map(f=>f.name)).size===2&&pack.files.every(file=>{try{const bytes=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0));return bytes.length>0&&bytes.length<=8000000&&bytes.length===file.bytes&&bytesHash(bytes)===file.sha256;}catch{return false;}});}
