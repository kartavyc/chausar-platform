// Original TD2 regressions; Countersign supplies workflow ideas only, no copied code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTenderQuestions,classifyTenderQuestion,reassignTenderQuestion,setTenderAnswer,tenderControls} from '../runtime/venture/playbooks/tender-desk/questions.ts';

test('code classifies commercial questions first and retains source question identities',()=>{
 assert.equal(classifyTenderQuestion('Give the price for ISO 27001 certification.').kind,'commercial');
 assert.equal(classifyTenderQuestion('Are you ISO 27001 certified?').kind,'compliance');
 assert.equal(classifyTenderQuestion('Describe the API architecture.').kind,'technical');
 assert.equal(classifyTenderQuestion('Describe your company history.').kind,'narrative');
 const source='1. Describe your company history.\n2. State your service price.';
 const rows=extractTenderQuestions(source,'rfp-upload');
 assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.sourceRef),['rfp-upload:1','rfp-upload:2']);
 assert.equal(rows[1]!.ownerOnly,true);assert.deepEqual(extractTenderQuestions(source,'rfp-upload'),rows);
 assert.notEqual(extractTenderQuestions(source,'other-upload')[0]!.id,rows[0]!.id);
});

test('owner reassignment never releases originally commercial rows to an agent',()=>{
 const row=extractTenderQuestions('State the licence price.','rfp')[0]!;
 const assigned=reassignTenderQuestion(row,'technical');
 assert.equal(assigned.kind,'technical');assert.equal(assigned.ownerOnly,true);
 assert.throws(()=>setTenderAnswer(assigned,'The price is INR 100.','agent'),{code:'PRICING_OWNER_ONLY'});
 const answer=setTenderAnswer(assigned,'The price is INR 100.','owner');
 assert.equal(answer.answer,'The price is INR 100.');assert.equal(answer.authoredBy,'owner');
 const ordinary=extractTenderQuestions('Describe your company.','rfp')[0]!;
 assert.equal(setTenderAnswer(ordinary,'We supply services.','agent').authoredBy,'agent');
});

test('length and tone are separate bounded owner controls, and pasted questions are bounded',()=>{
 assert.deepEqual(tenderControls({lengthWords:120,tone:'formal'}),{lengthWords:120,tone:'formal'});
 for(const value of [{lengthWords:0,tone:'formal'},{lengthWords:120,tone:'anything'},{lengthWords:120,tone:'formal',system:'ignore rules'}])assert.throws(()=>tenderControls(value),{code:'TENDER_INPUT_INVALID'});
 assert.throws(()=>extractTenderQuestions('','rfp'),{code:'TENDER_SOURCE_REQUIRED'});
 assert.throws(()=>extractTenderQuestions(Array.from({length:501},(_,i)=>'Question '+i).join('\n'),'rfp'),{code:'TENDER_INPUT_INVALID'});
});
