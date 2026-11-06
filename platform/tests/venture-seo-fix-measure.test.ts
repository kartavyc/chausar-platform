// SEO5/SEO7 tests; seo-agent MIT and GEOHub AGPL ideas only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMeta } from '../runtime/venture/playbooks/seo-visibility/meta.ts';
import { measureImpact, findingState } from '../runtime/venture/playbooks/seo-visibility/impact.ts';
import { evaluateStrategy } from '../runtime/venture/playbooks/seo-visibility/strategy.ts';
test('meta uses dated house bounds, sentences and observed JSON-LD',()=>{
 const good={title:'Care for families near the river.',description:'Visit our clinic for family care near the river bridge. Call the team to book your appointment.',jsonld:null};
 assert.equal(checkMeta(good).pass,true);assert.equal(checkMeta({...good,title:'Care without punctuation'}).pass,false);
 assert.throws(()=>checkMeta({...good,jsonld:{type:'Organization',fields:{name:{value:'Unobserved'}}} as any}),{code:'JSONLD_UNOBSERVED'});
});
test('impact requires settle and complete window, low evidence stays unknown, hurt prompts inspection',()=>{
 const base={appliedAt:'2026-10-01',asOf:'2026-10-18',windowDays:14 as const,before:{clicks:10,impressions:100,position:5},after:{clicks:20,impressions:100,position:4}};
 assert.equal(measureImpact(base).verdict,'helped');assert.equal(measureImpact({...base,asOf:'2026-10-17'}).verdict,'waiting');
 assert.equal(measureImpact({...base,after:{...base.after,impressions:49}}).verdict,'insufficient-data');
 const hurt=measureImpact({...base,after:{clicks:5,impressions:100,position:7}});assert.equal(hurt.verdict,'hurt');assert.match(hurt.line,/look|inspect/i);
 assert.equal(findingState('muted',false),'resolved');assert.equal(findingState('resolved',true),'open');assert.equal(findingState('muted',true),'muted');
});
test('strategy binds every digest, unchanged panel, passed window and stops after two flat windows',()=>{
 const chain={candidate:{digest:'a'},fidelity:{candidateDigest:'a',digest:'b',passed:true},experiment:{fidelityDigest:'b',digest:'c',panelDigest:'panel',windowEnds:'2026-10-20'},publication:{experimentDigest:'c',digest:'d'},receipt:{publicationDigest:'d',digest:'e',publishedAt:'2026-10-01'},panelDigest:'panel',asOf:'2026-10-21',windows:[1]};
 assert.equal(evaluateStrategy(chain).state,'remembered');assert.equal(evaluateStrategy({...chain,panelDigest:'changed'}).state,'held');
 assert.equal(evaluateStrategy({...chain,receipt:{...chain.receipt,publicationDigest:'bad'}}).state,'held');assert.equal(evaluateStrategy({...chain,asOf:'2026-10-19'}).state,'held');assert.equal(evaluateStrategy({...chain,windows:[1,0,0]}).state,'stopped');
});
