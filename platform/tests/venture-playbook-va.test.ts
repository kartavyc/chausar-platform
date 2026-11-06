import test from 'node:test';import assert from 'node:assert/strict';
import {VIRTUAL_ASSISTANT_DEFINITION as definition} from '../runtime/venture/playbooks/virtual-assistant/definition.ts';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
import {runKitBaseline} from '../runtime/venture/playbooks/kit/baseline.ts';
test('virtual assistant registers both owner-priced offers, reusable room and all approval floors',async()=>{
 assert.ok(definition);assert.equal(definition.clientRoom,true);assert.deepEqual(definition.offers.map(o=>o.id),['va-monthly','errands-pack']);assert.ok(definition.offers.every(o=>o.price==='owner-sets'));
 assert.ok(definition.rules.every(r=>r.needs===null));assert.deepEqual(definition.steps.map(s=>s.id),['inbox','plan','routines','draft','approve','handoff']);assert.ok(definition.approvals.filter(a=>['routines','approve'].includes(a.step)).every(a=>a.floor));
 const e=await kitBusiness(undefined,{idea:'A virtual assistant service'});assert.deepEqual(e.offers.map(o=>o.playbookOffer),['va-monthly','errands-pack']);
});
test('VA committed domain cases use actual refusal and version guards and reject changed answers',()=>{
 assert.ok(definition);const result=runKitBaseline(definition);assert.equal(result.ok,true);assert.deepEqual(result.cases.map(c=>c.id),['card-field-refused','morning-brief-sources','brief-version-changed']);
 const broken=runKitBaseline(definition,undefined,()=> 'Unproved answer');assert.equal(broken.passed,0);
});
