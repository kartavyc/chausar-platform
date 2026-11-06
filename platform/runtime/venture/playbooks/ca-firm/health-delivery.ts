// Original live source gate shared by Accept and every client share, including owner-edited papers.
import type {State} from '../../../contracts.ts';import {listRecords} from '../../records.ts';import {caOfRecord} from './signoff.ts';import {healthReviewed,healthPaperIncludes} from './c2-checks.ts';import {rederiveCaReceipt} from './stored-receipt.ts';import type {HealthWorking} from './health-check.ts';
export function healthClientBlock(state:State,ventureId:string,run:{id:string;editedText?:string|null;renderedText:string|null;status:string}):string|null{
 const ca=caOfRecord(state,ventureId),receipts=listRecords(state,'venture-work-receipt',ventureId).filter(r=>r.ca?.engine==='books-health'&&r.runRef.kind==='delivery'&&r.runRef.runId===run.id),reviews=listRecords(state,'venture-ca-working',ventureId).filter(row=>row.mode==='health').map(row=>({...row,decisions:row.decisions.filter(d=>d.membershipNumber===ca?.membershipNumber&&d.caName===ca.name)}));
 if(!receipts.length||receipts.some(r=>rederiveCaReceipt(r).rederived!=='same'||!healthReviewed(r,reviews)))return 'The current CA must review every finding on the current source receipt before this health report can reach a client.';
 const words=((run.status==='edited'||run.status==='accepted')&&run.editedText)||run.renderedText||'';
 for(const receipt of receipts){const decisions=reviews.find(row=>row.receiptId===receipt.id&&row.receiptDigest===receipt.digest)?.decisions??[];if(!healthPaperIncludes(receipt.ca!.working as unknown as HealthWorking,decisions,words))return 'Include the exact coverage, CA evidence appendix and limitations from the saved health working before the CA signs this client report.';}
 return null;
}
