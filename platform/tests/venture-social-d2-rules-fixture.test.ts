import assert from 'node:assert/strict';
import {test} from 'node:test';
import {playbookRules} from '../runtime/venture/playbooks/rules-current.ts';
test('the fake social register preserves every current real rule, source and freshness line',async()=>{
 const fixtureUrl=new URL('../../app/ui/src/engine/fixtures-rules-data.ts',import.meta.url);
 const {RULE_DATA}=await import(fixtureUrl.href);
 const expected=playbookRules('social-agency','2026-10-28').map(({id,platform,name,rule,checkedOn,windowDays,unconfirmed,usedBy,limitations,source,sources,line})=>({id,kind:'social',platform,name,rule,checkedOn,windowDays,unconfirmed,usedBy,limitations,source,sources,freshLine:line}));
 assert.deepEqual(RULE_DATA['social-agency'],expected);
});
