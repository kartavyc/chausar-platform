// Original code snapshot and coverage validation. X6: exact source citations, no repository code execution.
import {check,devObject} from './core.ts';
import {secretFindings} from '../../core/secrets.ts';
import type {DevSourceFile} from './verdict.ts';
export type DevSource={repository:string;revision:string;files:DevSourceFile[]};
export type DevRead={path:string;first:number;last:number};
/** Only explicit bounded text files from an owner-provided local snapshot enter the review. */
export function parseDevSource(text:string):DevSource{
 check(typeof text==='string'&&text.length<=2_000_000,'DEV_SOURCE_INVALID','Add a source snapshot below two megabytes.');let raw:unknown;try{raw=JSON.parse(text);}catch{check(false,'DEV_SOURCE_INVALID','Add a JSON source snapshot with repository, revision and files.');}
 const r=devObject(raw,['repository','revision','files']);check(typeof r.repository==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.repository)&&typeof r.revision==='string'&&/^[a-f0-9]{40,64}$/.test(r.revision)&&Array.isArray(r.files)&&r.files.length>0&&r.files.length<=200,'DEV_SOURCE_INVALID','Choose a named repository revision with bounded source files.');const paths=new Set<string>();
 const files=r.files.map(value=>{const f=devObject(value,['path','content']);check(typeof f.path==='string'&&f.path.length<=240&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path)&&!f.path.split('/').some(p=>['.','..','.git','node_modules'].includes(p)||p.startsWith('.env'))&&!paths.has(f.path),'DEV_SOURCE_INVALID','Use unique relative source paths, excluding private settings and dependencies.');paths.add(f.path);check(typeof f.content==='string'&&f.content.length<=128_000&&!f.content.includes('\u0000'),'DEV_SOURCE_INVALID','Keep each source file readable and bounded.');check(secretFindings(f.content).length===0,'DEV_SECRET_FOUND','A source file contains a possible secret. Remove it before review; the screen is not a security certification.');return {path:f.path,content:f.content};});
 return {repository:r.repository,revision:r.revision,files};
}
/** Only recorded successful reads count. The writer cannot mark a whole review complete. */
export function devCoverage(source:DevSource,reads:readonly DevRead[]):{complete:boolean;readLines:number;totalLines:number;line:string}{let readLines=0,totalLines=0;for(const file of source.files){const count=file.content.split(/\r?\n/).length;totalLines+=count;const read=new Set<number>();for(const r of reads.filter(r=>r.path===file.path)){check(Number.isSafeInteger(r.first)&&Number.isSafeInteger(r.last)&&r.first>=1&&r.last>=r.first&&r.last<=count,'DEV_SOURCE_INVALID','Read only valid source line ranges.');for(let i=r.first;i<=r.last;i++)read.add(i);}readLines+=read.size;}return {complete:readLines===totalLines,readLines,totalLines,line:`Read ${readLines} of ${totalLines} source lines.`};}
