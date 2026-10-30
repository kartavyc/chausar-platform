// CA4/CA6 original deterministic final checks. A model cannot declare a finding reviewed.
import type {CaReceipt} from './receipt.ts';
import type {CaWorkingBody} from './work-core.ts';
export function whatIfShown(receipts:readonly CaReceipt[],words:string):boolean{
 return receipts.filter(row=>row.engine==='what-if').every(row=>row.assumptions.length>0&&row.assumptions.every(assumption=>words.includes(assumption)));
}
export function healthReviewed(receipt:{id:string;digest:string;ca?:{working:unknown}},reviews:readonly Pick<CaWorkingBody,'receiptId'|'receiptDigest'|'decisions'>[]):boolean{
 const working=receipt.ca?.working as {coverage?:{read:number;total:number;passes:number;complete:boolean};worklist?:{id:string}[];findings?:{id:string;evidence:string[];validator:string;severity:string}[]}|undefined;
 if(!working?.coverage?.complete||working.coverage.read!==working.coverage.total||working.coverage.passes!==2||!Array.isArray(working.worklist)||working.worklist.length!==working.coverage.total||!Array.isArray(working.findings))return false;
 const review=reviews.find(row=>row.receiptId===receipt.id&&row.receiptDigest===receipt.digest);
 return working.findings.every(finding=>finding.validator==='needs-follow-up'&&['medium','high'].includes(finding.severity)&&finding.evidence.length>0&&finding.evidence.every(id=>working.worklist!.some(row=>row.id===id))&&review?.decisions.some(d=>d.findingId===finding.id&&['confirmed','dismissed'].includes(d.decision)&&d.evidence.length>0&&d.evidence.every(id=>finding.evidence.includes(id))&&d.note.trim().length>=3&&/^\d{6}$/.test(d.membershipNumber)));
}
/** Exact evidence appendix for a read-only client report. Includes limits even when no finding was raised. */
export function healthReportText(working:import('./health-check.ts').HealthWorking,decisions:CaWorkingBody['decisions']):string{
 return [`${working.coverage.read} of ${working.coverage.total} supplied lines read in two passes.`,...working.findings.map(f=>{const d=decisions.find(row=>row.findingId===f.id);return `${f.id}: ${f.kind}; ${f.severity}; evidence ${f.evidence.join(', ')}. ${d?`${d.decision} by ${d.caName}; checked ${d.evidence.join(', ')}; ${d.note}`:'Awaiting CA review.'}`;}),...working.limitations].join('\n');
}
export function healthPaperIncludes(working:import('./health-check.ts').HealthWorking,decisions:CaWorkingBody['decisions'],words:string):boolean{return words.includes(healthReportText(working,decisions));}
