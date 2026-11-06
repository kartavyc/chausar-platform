// Original evidence-first findings and code verdict. Learned from OpenQodex and Open Security catalogue X6; no source copied.
import {check} from './core.ts';
export type DevSourceFile={path:string;content:string};
export type DevSeverity='critical'|'major'|'minor'|'nitpick'|'info';
export type DevFinding={id:string;severity:DevSeverity;kind:'finding'|'observation';title:string;problem:string;why:string;fix:string;citations:{path:string;line:number;quote:string}[]};
const plain=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const text=(v:unknown,max:number)=>{check(typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v),'INVALID_VENTURE_REQUEST','Use bounded readable finding text.');return v.trim();};
const exact=(v:unknown,keys:string[])=>{check(plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'INVALID_VENTURE_REQUEST','Use the exact finding fields.');return v;};
/** Findings contain remediation advice, never executable exploitation instructions. */
export function assertNoExploit(value:string):void{check(!/(?:```|\b(?:curl|wget|sqlmap|msfconsole|metasploit|netcat|powershell|bash\s+-c|python\s+-c)\b|\b(?:exploit|attack)\s+(?:steps?|commands?|payload)|\b(?:dump|exfiltrate)\s+(?:the\s+)?(?:database|credentials|tokens)|\b(?:reverse\s+shell|union\s+select)\b)/i.test(value),'DEV_EXPLOIT_REFUSED','Describe the issue and remediation without exploit commands, payloads or attack steps.');}
/** A citation must quote current source at its exact line; reported severity alone is never evidence. */
export function validateFindings(raw:unknown,files:readonly DevSourceFile[]):DevFinding[]{
 check(Array.isArray(raw)&&raw.length<=100,'INVALID_VENTURE_REQUEST','Keep at most one hundred findings.');const ids=new Set<string>();
 return raw.map(value=>{const r=exact(value,['id','severity','kind','title','problem','why','fix','citations']);const id=text(r.id,80);check(!ids.has(id),'INVALID_VENTURE_REQUEST','Each finding needs a different identity.');ids.add(id);
 check(typeof r.severity==='string'&&['critical','major','minor','nitpick','info'].includes(r.severity)&&typeof r.kind==='string'&&['finding','observation'].includes(r.kind),'INVALID_VENTURE_REQUEST','Choose a known severity and finding kind.');
 const words={title:text(r.title,180),problem:text(r.problem,1800),why:text(r.why,1200),fix:text(r.fix,1200)};assertNoExploit(Object.values(words).join('\n'));
 check(Array.isArray(r.citations)&&r.citations.length>=1&&r.citations.length<=3,'DEV_EVIDENCE_REQUIRED','Each finding needs a current source citation.');const citations=r.citations.map(value=>{const c=exact(value,['path','line','quote']);const path=text(c.path,240),quote=text(c.quote,1200);check(typeof c.line==='number'&&Number.isSafeInteger(c.line)&&c.line>0,'DEV_EVIDENCE_REQUIRED','Cite an exact source line.');const file=files.find(f=>f.path===path),line=c.line;check(file&&file.content.split(/\r?\n/).slice(line-1,line-1+quote.split('\n').length).join('\n').includes(quote),'DEV_EVIDENCE_REQUIRED','The quote must exist at that exact line in the current source.');return {path,line,quote};});
 return {id,severity:r.severity as DevSeverity,kind:r.kind as DevFinding['kind'],...words,citations};});
}
/** Coverage is supplied by verified source reads, never inferred from an empty findings list. */
export function qaVerdict(findings:readonly Pick<DevFinding,'kind'|'severity'>[],complete:boolean):{verdict:'Do not ship'|'Ship with fixes'|'Ship'|'Review incomplete';basis:string}{
 if(!complete)return {verdict:'Review incomplete',basis:'Required source coverage or checks are incomplete.'};const actual=findings.filter(f=>f.kind==='finding');
 if(actual.some(f=>f.severity==='critical'||f.severity==='major'))return {verdict:'Do not ship',basis:'At least one major or critical finding remains.'};
 if(actual.some(f=>f.severity==='minor'||f.severity==='nitpick'))return {verdict:'Ship with fixes',basis:'Minor findings need owner review before shipping.'};return {verdict:'Ship',basis:'Required coverage is complete and no blocking finding remains. This is not a security certification.'};
}

/** Audit's scanner findings remain in the verdict even when the manual findings list is empty. */
export function devCombinedVerdict(findings:readonly DevFinding[],audit:readonly import('./scanners.ts').AuditFinding[],complete:boolean){const levels={critical:'critical',high:'major',moderate:'minor',low:'minor',info:'info'} as const;return qaVerdict([...findings,...audit.map(row=>({kind:'finding' as const,severity:levels[row.severity]}))],complete);}
