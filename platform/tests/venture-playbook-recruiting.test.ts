// Original Chausar registration and evidence-bound recruiting checks, after recruiting-copilot (MIT).
import test from 'node:test';
import assert from 'node:assert/strict';
import {RECRUITING_DESK_REGISTRATION} from '../runtime/venture/playbooks/recruiting-desk/registration.ts';
import {RECRUITING_DESK_DEFINITION} from '../runtime/venture/playbooks/recruiting-desk/definition.ts';
import {runKitBaseline} from '../runtime/venture/playbooks/kit/baseline.ts';
import {scoreRecruitBaseline} from '../runtime/venture/playbooks/recruiting-desk/checks.ts';
import {readFileSync} from 'node:fs';
test('recruiting is a live owner-priced kit with all required baseline cases and manual outside actions',()=>{
 assert.equal(RECRUITING_DESK_REGISTRATION?.id,'recruiting-desk');assert.ok(RECRUITING_DESK_DEFINITION);
 assert.deepEqual(RECRUITING_DESK_DEFINITION.offers.map(o=>o.id),['role-intake','shortlist','resume-screening','interview-scheduling','success-fee']);
 assert.ok(RECRUITING_DESK_DEFINITION.offers.every(o=>o.price==='owner-sets'));
 assert.deepEqual(runKitBaseline(RECRUITING_DESK_DEFINITION).cases.map(c=>c.id),['unknown-not-not-met','protected-trait-refused','first-message-privacy-line','experience-overlap']);
 assert.equal(runKitBaseline(RECRUITING_DESK_DEFINITION).ok,true);
 assert.equal(runKitBaseline(RECRUITING_DESK_DEFINITION,undefined,()=> 'All candidates are approved.').passed,0);
 assert.ok(RECRUITING_DESK_DEFINITION.connectors.filter(c=>['linkedin','naukri','calendar'].includes(c.id)).every(c=>c.label==='handoff'));
 assert.ok(RECRUITING_DESK_DEFINITION.rules.every(r=>Object.hasOwn(r,'needs')));
});
test('recruiting reference scores require valid source inputs, not just convincing answer sentences',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../runtime/venture/playbooks/recruiting-desk/baselines/recruiting-desk.json',import.meta.url),'utf8'));
 for(const item of fixture.cases){assert.equal(scoreRecruitBaseline({...item,meta:undefined},item.draft).pass,false,item.id+' missing source');assert.equal(scoreRecruitBaseline({...item,meta:{source:'{}'}},item.draft).pass,false,item.id+' corrupt source');}
});
