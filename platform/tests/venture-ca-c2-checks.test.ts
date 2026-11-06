// C2 final gates run on actual source-derived calculator work, not canned prose alone.
import test from 'node:test';import assert from 'node:assert/strict';
import {healthReviewed,whatIfShown} from '../runtime/venture/playbooks/ca-firm/c2-checks.ts';
import {booksHealthCheck} from '../runtime/venture/playbooks/ca-firm/health-check.ts';
import {whatIf} from '../runtime/venture/playbooks/ca-firm/what-if.ts';
import {REHEARSAL} from '../runtime/venture/playbooks/ca-firm/rates.ts';
import {CA_OFFERS,CA_STEPS} from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import {runFlagshipChecks} from '../runtime/venture/playbooks/draft-checks.ts';
test('books health is an offered source-tool workflow and final draft refuses missing evidence',async()=>{
 assert.ok(CA_OFFERS.some(row=>row.id==='books-health-check'&&row.regulated));assert.ok(CA_STEPS.some(step=>step.tools.includes('books.healthCheck')));
 const checks=await runFlagshipChecks({flagship:'ca-firm',offerKey:'books-health-check',servedBy:'model',deliverable:{title:'Books review',sections:[],questionsForClient:[]},request:'Check the quarter',intake:null,files:[],receipts:[],known:[],mode:'client',today:'2026-10-28',dateOrder:'day-month-year'} as any);
 assert.equal(checks?.find(row=>row.check==='finding-has-evidence')?.outcome,'fail');
});
test('health gate refuses unread lines, invented evidence and absent or stale CA decisions',()=>{
 const receipt=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'0',priorPayments:[],lines:[{id:'a',source:'bank',transactionId:'a',date:'2026-10-01',payee:'A',direction:'out',amountMinor:'100',cash:false,purchase:true,gstCharged:true,gstin:null,tds:null}]},REHEARSAL);const stored={id:'r',digest:receipt.id,ca:{working:receipt.working}};const review={receiptId:'r',receiptDigest:receipt.id,decisions:receipt.working.findings.map(f=>({findingId:f.id,decision:'confirmed' as const,evidence:f.evidence,note:'Invoice checked',caName:'Asha',membershipNumber:'123456',at:'2026-10-28'}))};
 assert.equal(healthReviewed(stored,[review]),true);assert.equal(healthReviewed(stored,[]),false);assert.equal(healthReviewed({...stored,digest:'changed'},[review]),false);assert.equal(healthReviewed({...stored,ca:{working:{...receipt.working,coverage:{...receipt.working.coverage,read:0}}}},[review]),false);
});
test('what-if gate requires each actual calculator assumption verbatim, including defaults',()=>{
 const receipt=whatIf({mode:'compare-regimes',base:{assessmentYear:'2027-28',regime:'new',residency:'resident',ageBand:'below-60',otherSlabIncomeMinor:'120000000'}},REHEARSAL);assert.equal(whatIfShown([receipt],receipt.assumptions.join('\n')),true);assert.equal(whatIfShown([receipt],'Assumed anything.'),false);
});
test('health client paper must carry exact coverage and evidence-backed CA decisions',async()=>{const {healthReportText,healthPaperIncludes}=await import('../runtime/venture/playbooks/ca-firm/c2-checks.ts');const receipt=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'0',priorPayments:[],lines:[{id:'a',source:'bank',transactionId:'a',date:'2026-10-01',payee:'A',direction:'out',amountMinor:'100',cash:false,purchase:true,gstCharged:true,gstin:null,tds:null}]},REHEARSAL);const decisions=receipt.working.findings.map(f=>({findingId:f.id,decision:'dismissed' as const,evidence:f.evidence,note:'Invoice checked with source',caName:'Asha',membershipNumber:'123456',at:'2026-10-28'}));const summary=healthReportText(receipt.working,decisions);assert.equal(healthPaperIncludes(receipt.working,decisions,summary),true);assert.equal(healthPaperIncludes(receipt.working,decisions,'Everything is clear.'),false);assert.equal(healthPaperIncludes(receipt.working,[{...decisions[0],note:'Changed evidence'}],summary),false);});
