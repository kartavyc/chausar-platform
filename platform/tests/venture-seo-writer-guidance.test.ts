import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS, HARNESS_WRITE_INSTRUCTIONS, newHarnessState, writeTask, type WriteContext } from '../runtime/venture/delivery/harness/loop.ts';
import { deliverySchema } from '../runtime/venture/delivery/deliverable.ts';

const base: WriteContext = {
 serviceType:'bookkeeping',offer:{name:'Article',description:'A sourced article.'},clientRequest:'Write from the recorded sources.',playbook:{steps:[]},dictionaryManifest:'m',files:[],containsClientData:true,allowed:[],idea:'SEO articles',priceRefs:{figures:[],dates:[]},templateTotalRef:'order.total',proven:[],draft:{sections:['Article','Sources','Limits'],guidance:['Put a claim marker beside every number.']},
};
const corroborate: WriteContext['playbook'] = {steps:[{id:'verify',kind:'work',title:'Check claims',tier:'actor',model:'fast',doneBy:'agent',requiredSections:[],checks:[],tools:['seo.corroborate']}]};
const state = () => newHarnessState([],DEFAULT_LIMITS,[]);
const textDescription = (schema: unknown): string => (schema as {properties:{sections:{items:{properties:{parts:{items:{properties:{text:{description:string}}}}}}}}}).properties.sections.items.properties.parts.items.properties.text.description;

test('SEO Writer task and schema permit only source-grounded numeric prose with adjacent exact claim markers',()=>{
 for(const forced of [false,true]){
  const s=state();if(forced)s.stopReason='The run reached its limit.';
  const task=writeTask({...base,playbook:corroborate},s,[]);
  assert.doesNotMatch(task.instructions,/Never write digits/);
  assert.match(task.instructions,/non-money numbers/);
  assert.match(task.instructions,/\[claim:id\]/);
  assert.match(task.instructions,/exact declared number/);
  assert.match(task.instructions,/Never write prices or monetary amounts/);
  assert.doesNotMatch(textDescription(task.schema),/Words only, no digits/);
  assert.match(textDescription(task.schema),/\[claim:id\]/);
  assert.match(textDescription(task.schema),/Empty for a figure or date part/);
  if(forced)assert.match(task.instructions,/stopped before it finished/);
  const draft={title:'Clinic article',sections:[{heading:'Article',parts:[{kind:'text',text:'The source reports 35% [claim:c1] of visitors.',ref:''}]}],questionsForClient:[]};
  assert.equal(task.validate(draft).estimate,true);
  assert.throws(()=>task.validate({...draft,sections:[{heading:'Article',parts:[{kind:'text',text:'The price is INR 35 [claim:c1].',ref:''}]}]}),{code:'MODEL_OUTPUT_REJECTED'});
 }
});

test('non-article and non-SEO Writer tasks retain the original instructions, schema and numeric refusal',()=>{
 for(const ctx of [base,{...base,playbook:corroborate,draft:{sections:['Evidence'],guidance:[]}}]){
  const task=writeTask(ctx,state(),[]);
  assert.equal(task.instructions,HARNESS_WRITE_INSTRUCTIONS);
  assert.deepEqual(task.schema,deliverySchema(ctx.serviceType,ctx.draft!.sections));
  assert.throws(()=>task.validate({title:'Report',sections:[{heading:ctx.draft!.sections[0],parts:[{kind:'text',text:'Observed 35% of visitors.',ref:''}]}],questionsForClient:[]}),{code:'MODEL_OUTPUT_REJECTED'});
 }
});
