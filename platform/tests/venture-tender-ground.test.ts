// Original TD3 regressions from the tender specification; Countersign is AGPL, ideas only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {groundTenderAnswer,aggregateTenderGaps} from '../runtime/venture/playbooks/tender-desk/ground.ts';

test('tender answers use the existing lexical claims with source IDs and retrieval coverage',()=>{
 const result=groundTenderAnswer('Describe ISO 27001 certification','We hold ISO 27001 certification and employ 15 staff at Acme Labs.',[{id:'doc_a',text:'Acme Labs holds ISO 27001 certification and employs 15 staff.'}]);
 assert.equal(result.passed,true);assert.equal(result.gap,false);assert.equal(result.coverage.matched,result.coverage.total);assert.ok(result.claims.some(c=>c.kind==='certification'&&c.sourceId==='doc_a'));assert.deepEqual(result.missingTerms,[]);
});
test('a missing standard or invented figure and name cannot be grounded by the RFP question alone',()=>{
 const result=groundTenderAnswer('Do you hold ISO 9001 certification?','Yes. We hold ISO 9001 and employ 92 people at Fictional Industries.',[{id:'bucket',text:'Acme Labs provides software support.'}]);
 assert.equal(result.passed,false);assert.equal(result.gap,true);assert.equal(result.affirmativeGap,true);assert.ok(result.missingTerms.some(t=>/ISO 9001/i.test(t)));assert.ok(result.claims.some(c=>c.kind==='figure'&&!c.matched));assert.ok(result.claims.some(c=>c.kind==='name'&&!c.matched));
});
test('honest gap answers remain gaps and English or Hindi affirmative openers are identified',()=>{
 for(const answer of ['Yes, we can supply it.','  **Yes**. Evidence pending.','हाँ, प्रमाण बाकी है।'])assert.equal(groundTenderAnswer('ISO 9001 certification',answer,[]).affirmativeGap,true,answer);
 const honest=groundTenderAnswer('ISO 9001 certification','Evidence is missing. The owner must supply the certificate.',[]);assert.equal(honest.gap,true);assert.equal(honest.affirmativeGap,false);assert.equal(honest.passed,false);
});
test('lexical equivalent India figures retain the established matcher behavior',()=>{
 const result=groundTenderAnswer('State annual capacity','Our annual capacity is 1.2 lakh units.',[{id:'capacity',text:'Annual capacity is 1,20,000 units.'}]);assert.equal(result.claims.find(c=>c.kind==='figure')?.matched,true);assert.equal(result.passed,true);
});
test('aggregate gaps count a missing term once per answer and sort the common requests deterministically',()=>{
 const a=groundTenderAnswer('ISO 9001 certification','Evidence pending',[]),b=groundTenderAnswer('ISO 9001 certification','Evidence pending',[]),c=groundTenderAnswer('Describe support','We provide support.',[{id:'s',text:'We provide support.'}]);
 const result=aggregateTenderGaps([{id:'q_b',result:b},{id:'q_a',result:a},{id:'q_c',result:c}]);assert.deepEqual(result.questionIds,['q_a','q_b']);assert.ok(result.terms.some(row=>row.term==='ISO 9001'&&row.count===2));assert.ok(result.terms.every(row=>row.count<=2));
});
test('groundedness refuses empty answers, duplicate document IDs and unbounded inputs',()=>{
 assert.throws(()=>groundTenderAnswer('Describe support','',[]),{code:'TENDER_INPUT_INVALID'});
 assert.throws(()=>groundTenderAnswer('Describe support','Support',[{id:'x',text:'a'},{id:'x',text:'b'}]),{code:'TENDER_SOURCE_REQUIRED'});
 assert.throws(()=>groundTenderAnswer('x'.repeat(4001),'Support',[]),{code:'TENDER_INPUT_INVALID'});
});
test('empty source text cannot certify an answer and repeated standard spellings aggregate as one gap',()=>{
 assert.throws(()=>groundTenderAnswer('Describe support','We provide support.',[{id:'empty',text:'   '}]),{code:'TENDER_SOURCE_REQUIRED'});
});
test('repeated standard spellings aggregate as one gap',()=>{
 const result=groundTenderAnswer('ISO 9001 certification','We are ISO 9001 certified.',[]);
 assert.equal(result.missingTerms.filter(term=>/^ISO 9001/i.test(term)).length,1);
});
