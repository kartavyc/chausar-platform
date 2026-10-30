// Original source-bound app test report. Owner reproduction is labelled as such, never represented as an automated assertion.
import {check,digest} from '../../../portable.ts';import {reviewedFindings,type AppFinding,type FindingDecision} from './logcat.ts';
export type FindingReproduction={id:string;stepIds:string[];observed:string};
export type AppTestReportInput={packageName:string;apkSha256:string;planDigest:string;steps:readonly {id:string;title:string;expected:string}[];attempts:readonly {id:string;operation:string;stepId:string|null;phase:string;at:string;journalId:string;line:string}[];findings:readonly AppFinding[];decisions:readonly FindingDecision[];reproductions:readonly FindingReproduction[]};
/** Exact reviewed evidence and successful step receipts determine report contents and its provenance hash. */
export function appTestReport(input:AppTestReportInput){
 const included=reviewedFindings(input.findings,input.decisions),ids=new Set(input.steps.map(s=>s.id));check(/^[a-f0-9]{64}$/.test(input.apkSha256)&&/^[a-f0-9]{64}$/.test(input.planDigest),'APPROVAL_STALE','Bind this report to the approved client APK and plan.');
 check(Array.isArray(input.reproductions)&&input.reproductions.length===included.length&&new Set(input.reproductions.map(r=>r.id)).size===included.length,'FINDING_REPRODUCTION_REQUIRED','Record how you reproduced every included finding.');
 const executed=new Set(input.attempts.filter(a=>a.phase==='applied'&&['launch','tap'].includes(a.operation)&&a.journalId).map(a=>a.stepId).filter(Boolean));
 const lines=['App test report','Package: '+input.packageName,'APK SHA256: '+input.apkSha256,'Plan receipt: '+input.planDigest,'Coverage is limited to the recorded steps and log tail. No finding does not prove the app is correct.','Test steps'];
 for(const step of input.steps)lines.push((executed.has(step.id)?'Executed: ':'Unexecuted: ')+step.title,'Expected: '+step.expected);
 lines.push('Reviewed findings');if(included.length===0)lines.push('No findings were included. This is not a full app quality or security assessment.');
 for(const finding of included){
  check(finding.packageName===input.packageName&&finding.sourceDigest===digest({packageName:finding.packageName,kind:finding.kind,startLine:finding.startLine,endLine:finding.endLine,evidence:finding.evidence}),'APPROVAL_STALE','The finding evidence changed. Read and review its source again.');
  const reproduction=input.reproductions.find(r=>r.id===finding.id)!;check(Array.isArray(reproduction.stepIds)&&reproduction.stepIds.length>0&&reproduction.stepIds.length<=input.steps.length&&new Set(reproduction.stepIds).size===reproduction.stepIds.length&&reproduction.stepIds.every((id:string)=>ids.has(id)&&executed.has(id))&&typeof reproduction.observed==='string'&&reproduction.observed.trim().length>0&&reproduction.observed.length<=4000,'FINDING_REPRODUCTION_REQUIRED','Use executed test steps and your observed result for every included finding.');
  lines.push(finding.kind,'Log lines: '+finding.startLine+' to '+finding.endLine,'Evidence receipt: '+finding.sourceDigest,'Owner-confirmed reproduction: '+reproduction.stepIds.join(', '),reproduction.observed,'First app frame: '+(finding.appFrame??'Not present in the captured log'),finding.evidence);
 }
 lines.push('Excluded finding receipts',...input.decisions.filter(d=>d.decision==='exclude').map(d=>d.sourceDigest));const text=lines.join('\n'),sourceDigest=digest(input);return {text,sourceDigest,digest:digest({text,sourceDigest}),included:included.length,excluded:input.findings.length-included.length};
}
