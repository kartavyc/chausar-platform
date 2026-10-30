// The three real public-board guides and their browser fixture stay field-exact across isolated package commits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guideOf,hasHandGuide} from '../runtime/venture/build/guides.ts';
import {CONNECTOR_CATALOGUE} from '../runtime/venture/build/catalogue.ts';
import {connectorCapabilities} from '../runtime/venture/build/connector-truth.ts';
test('recruitment public-board guides have exact fake metadata and complete localized owner setup',()=>{
 const read=(path:string)=>JSON.parse(readFileSync(new URL('../../app/ui/src/'+path,import.meta.url),'utf8'));
 const fake=read('engine/fixtures-guides.json'),en=read('text/en/pb-connector-guides.json'),hi=read('text/hi/pb-connector-guides.json'),review=read('text/hi-review.json');
 for(const id of ['recruit-greenhouse','recruit-lever','recruit-ashby']){assert.equal(hasHandGuide(id),true);const g=guideOf(CONNECTOR_CATALOGUE.find(c=>c.id===id)!);assert.deepEqual(fake[id],{guide:g,capabilities:connectorCapabilities(id)});assert.match(g.sends,/No applications/);const prefix='pb-connector-guides.'+id+'.';g.steps.forEach((v,i)=>assert.equal(en[prefix+'step'+(i+1)],v.replace(/^\d+\. /,'')));for(const key of ['skipped','checks','sends','agentLimits'] as const)assert.equal(en[prefix+key],g[key]);assert.equal(en[prefix+'charges'],g.charges.line);for(const key of Object.keys(en).filter(k=>k.startsWith(prefix))){assert.ok(hi[key]);assert.ok(review.machineDrafted.includes(key));}}
});
