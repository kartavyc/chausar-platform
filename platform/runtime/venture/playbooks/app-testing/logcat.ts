// Original parser informed by Android logcat documentation. No phone-harness (MIT) code copied.
import {check,digest} from '../../../portable.ts';

export type AppFinding={id:string;kind:'java-crash'|'anr'|'native-crash';packageName:string;startLine:number;endLine:number;appFrame:string|null;evidence:string;sourceDigest:string;review:'pending'};
export type FindingDecision={id:string;sourceDigest:string;decision:'include'|'exclude'};
const packagePattern=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const marker=(line:string):AppFinding['kind']|null=>/FATAL EXCEPTION:/.test(line)?'java-crash':/\bANR in\s+/.test(line)?'anr':/\*\*\* \*\*\* \*\*\*/.test(line)?'native-crash':null;
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Code-derived evidence, never a claim that a crash was reproduced or reviewed. */
export function parseLogcat(text:string,packageName:string):AppFinding[]{
 check(typeof text==='string'&&text.length<=2_000_000&&typeof packageName==='string'&&packageName.length<=200&&packagePattern.test(packageName),'INVALID_VENTURE_REQUEST','Use a bounded client log and its Android package name.');
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 check(lines.length<=30_000,'INVALID_VENTURE_REQUEST','Split this log into smaller files.');
 const starts=lines.flatMap((line,index)=>{const kind=marker(line);return kind?[{index,kind}]:[];}),out:AppFinding[]=[],pkg=escape(packageName);
 for(let n=0;n<starts.length;n++){
  const {index,kind}=starts[n]!,end=Math.min(starts[n+1]?.index??lines.length,index+120),block=lines.slice(index,end),evidence=block.join('\n');
  const actual=kind==='java-crash'?/\bProcess:\s*([\w.]+(?::[\w.-]+)?)(?=,|\s|$)/.exec(evidence)?.[1]:kind==='anr'?/\bANR in\s+([\w.]+(?::[\w.-]+)?)(?=\s|$|\()/.exec(block[0]!)?.[1]:/>>>\s*([\w.]+(?::[\w.-]+)?)\s*<<</.exec(evidence)?.[1];
  if(actual!==packageName&&!actual?.startsWith(packageName+':'))continue;
  const frame=kind==='native-crash'?block.find(line=>/#\d+\s+pc\s/.test(line)&&new RegExp('/(?:data/app/[^\\s]*'+pkg+'(?:[./-]|$))').test(line)):block.find(line=>new RegExp('\\bat\\s+'+pkg+'\\.').test(line));
  const sourceDigest=digest({packageName,kind,startLine:index+1,endLine:end,evidence});
  out.push({id:'finding_'+sourceDigest.slice(0,24),kind,packageName,startLine:index+1,endLine:end,appFrame:frame?.trim()??null,evidence,sourceDigest,review:'pending'});
 }
 return out;
}

/** Reporting requires one explicit decision for every exact finding, including exclusions. */
export function reviewedFindings(findings:readonly AppFinding[],decisions:readonly FindingDecision[]):AppFinding[]{
 check(Array.isArray(decisions)&&decisions.length===findings.length&&new Set(decisions.map(d=>d.id)).size===decisions.length,'FINDING_REVIEW_REQUIRED','Review every finding before making the report.');
 for(const finding of findings){const choice=decisions.find(d=>d.id===finding.id);check(choice&&choice.sourceDigest===finding.sourceDigest&&['include','exclude'].includes(choice.decision),'FINDING_REVIEW_REQUIRED','Review the current evidence for every finding.');}
 return findings.filter(f=>decisions.find(d=>d.id===f.id)!.decision==='include').map(f=>structuredClone(f));
}
