// Original model-boundary tests for tender answers, with commercial questions always owner-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tenderTask} from '../runtime/venture/playbooks/tender-desk/ai-core.ts';
import {extractTenderQuestions} from '../runtime/venture/playbooks/tender-desk/questions.ts';
const controls={lengthWords:30,tone:'professional' as const},documents=[{id:'company',text:'We provide support.'}];
test('tender model drafts only source-grounded non-commercial answers with exact bounded output',()=>{
 const question=extractTenderQuestions('Describe support.','rfp')[0]!,task=tenderTask(question,controls,documents);
 assert.equal(task.containsClientData,true);assert.equal(task.validate({answer:'We provide support.'}).answer,'We provide support.');
 assert.throws(()=>task.validate({answer:'We are ISO 27001 certified.'}),{code:'TENDER_GROUNDING_REQUIRED'});
 assert.throws(()=>task.validate({answer:'We provide support.',extra:true}),{code:'INVALID_VENTURE_REQUEST'});
 assert.throws(()=>task.validate({answer:Array(31).fill('support').join(' ')}),{code:'TENDER_LENGTH_EXCEEDED'});
 assert.throws(()=>tenderTask(extractTenderQuestions('State the price.','rfp')[0]!,controls,documents),{code:'PRICING_OWNER_ONLY'});
});
test('a source gap cannot receive an affirmative AI answer',()=>{
 const task=tenderTask(extractTenderQuestions('Do you provide hosting?','rfp')[0]!,controls,documents);
 assert.throws(()=>task.validate({answer:'Yes, we provide hosting.'}),{code:'TENDER_GROUNDING_REQUIRED'});
 assert.equal(task.validate({answer:'Hosting is not confirmed in the supplied documents.'}).ground.gap,true);
});
