import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCareerBaseline} from '../runtime/venture/playbooks/job-search-desk/checks.ts';
import {readFileSync} from 'node:fs';
const fact={id:'internship',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['management']};
test('career baselines grade the supplied evidence and actual answer, never the case ID alone',()=>{
 const item={id:'forbidden-use-blocked',request:'Use this fact for management.',draft:'Do not use internship for management.',meta:{source:JSON.stringify({facts:[fact],claims:[{factId:'internship',use:'management'}]})}};
 assert.equal(scoreCareerBaseline(item,item.draft).pass,true);
 assert.equal(scoreCareerBaseline(item,'').pass,false);
 assert.equal(scoreCareerBaseline(item,'The client managed the entire team.').pass,false);
 assert.equal(scoreCareerBaseline({...item,meta:{source:'{}'}},item.draft).pass,false);
});
test('every committed career baseline is source-executed and rejects an empty answer',()=>{
 const baseline=JSON.parse(readFileSync(new URL('../runtime/venture/playbooks/job-search-desk/baselines/job-search-desk.json',import.meta.url),'utf8'));
 assert.equal(baseline.cases.length,4);
 for(const item of baseline.cases){assert.equal(scoreCareerBaseline(item,item.draft).pass,true,item.id);assert.equal(scoreCareerBaseline(item,'').pass,false,item.id);}
});
