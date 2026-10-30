import test from 'node:test';
import assert from 'node:assert/strict';
import {JOB_SEARCH_DESK_DEFINITION as definition} from '../runtime/venture/playbooks/job-search-desk/definition.ts';
import {allWords,hiOf} from '../runtime/venture/playbooks/kit/words.ts';
test('career playbook has the six priced services, client handoff workflow and conservative connectors',()=>{
 assert.ok(definition);
 assert.equal(definition.registration.id,'job-search-desk');
 assert.equal(definition.offers.length,6);
 assert.ok(definition.offers.every(o=>o.price==='owner-sets'&&o.workflow?.includes('approve-facts')&&o.workflow?.at(-1)==='handoff'));
 assert.equal(definition.offers.find(o=>o.id==='profile-and-tailoring')?.pilotable,true);
 assert.deepEqual(definition.planPicks.offers,['monthly-job-search','interview-prep-pack','job-title-audit','profile-and-tailoring','weekly-shortlist','career-coaching']);
 assert.ok(definition.connectors.every(c=>c.label==='read'||c.label==='handoff'));
 assert.ok(definition.rules.every(r=>Object.hasOwn(r,'needs')));
 assert.ok(definition.rules.some(r=>r.needs==='lawyer'&&r.confirmedBy===null));
 for(const word of allWords(definition))assert.match(hiOf('job-search-desk',word),/\p{Script=Devanagari}/u);
});
