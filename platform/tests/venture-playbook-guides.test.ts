// Setup guidance must describe the public owner paths, never a generic invented connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONNECTOR_CATALOGUE} from '../runtime/venture/build/catalogue.ts';
import {guideOf,hasHandGuide,halfConfigured} from '../runtime/venture/build/guides.ts';
import {connectorCapabilities,checkConnectorFields} from '../runtime/venture/build/connector-truth.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {owner,setup} from './venture-views-env.ts';
const guide=(id:string)=>{const entry=CONNECTOR_CATALOGUE.find(row=>row.id===id);assert.ok(entry,id);assert.ok(hasHandGuide(id),id);return guideOf(entry);};
test('new working connectors describe their actual setup, checks and limits',()=>{
 const wp=guide('seo-wordpress');assert.match(wp.steps.join(' '),/Application Passwords/);assert.match(wp.checks,/does not test/);assert.match(wp.sends,/draft/);assert.match(wp.agentLimits,/publish/);
 const kv=guide('seo-cloudflare-kv');assert.match(kv.steps.join(' '),/existing.*namespace/);assert.match(kv.steps.join(' '),/Workers KV Storage/);assert.match(kv.skipped,/Worker/);assert.match(kv.agentLimits,/unknown/);
 for(const id of ['recruit-greenhouse','recruit-lever','recruit-ashby']){const g=guide(id);assert.match(g.steps.join(' '),/board.*filters/);assert.match(g.checks,/first read.*alerts/);assert.match(g.sends,/No applications/);}
 assert.match(guide('article-transcript').steps.join(' '),/SRT, VTT or TXT/);
 assert.match(guide('article-local-transcription').skipped,/50 MB/);
 assert.match(guide('article-publishing').sends,/publish.*yourself/);
 assert.match(guide('overpass').skipped,/ODbL/);
 assert.match(guide('nominatim').steps.join(' '),/operations.osmfoundation.org/);
 assert.match(guide('own-site').skipped,/robots/);
 assert.match(guide('happenstance').sends,/exact.*approved.*search/);
 assert.match(guide('happenstance').agentLimits,/unknown/);
});
test('LinkedIn setup is copy-and-open with no automated posting or messaging',()=>{
 const g=guide('linkedin');assert.match(g.steps.join(' '),/copy/i);assert.match(g.sends,/nothing/);assert.match(g.agentLimits,/cannot post or message/);assert.doesNotMatch(g.steps.join(' '),/Playwright|posting steps check/);
});
test('LinkedIn capability metadata permits only a text handoff and refuses posting fields',()=>{
 assert.deepEqual(connectorCapabilities('linkedin'),[{operation:'copy-and-open',mode:'handoff',fields:['text']}]);
 assert.doesNotThrow(()=>checkConnectorFields('linkedin','copy-and-open',['text']));
 assert.throws(()=>checkConnectorFields('linkedin','post',['text']),{code:'CONNECTOR_FIELD_UNSUPPORTED'});
 assert.throws(()=>checkConnectorFields('linkedin','copy-and-open',['text','account']),{code:'CONNECTOR_FIELD_UNSUPPORTED'});
});
test('old LinkedIn browser records never ask the owner to enable automated posting',async()=>{
 const env=await setup();await ventureAction(env.deps,owner,'admin','seed.review',tx=>{tx.put({...tx.base('venture-posting-steps'),connectorId:'linkedin',checked:[],added:[]});});
 assert.equal(halfConfigured(env.deps,env.store.read(),env.venture.id,'linkedin'),null);
});
test('new localized guide words match engine English exactly and retain Hindi review entries',()=>{
 const en=JSON.parse(readFileSync(new URL('../../app/ui/src/text/en/pb-connector-guides.json',import.meta.url),'utf8'));
 const hi=JSON.parse(readFileSync(new URL('../../app/ui/src/text/hi/pb-connector-guides.json',import.meta.url),'utf8'));
 const review=JSON.parse(readFileSync(new URL('../../app/ui/src/text/hi-review.json',import.meta.url),'utf8'));
 const fake=JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-guides.json',import.meta.url),'utf8'));
 for(const id of [...new Set(Object.keys(en).map(key=>key.split('.')[1]))] as string[]){const entry=CONNECTOR_CATALOGUE.find(row=>row.id===id);assert.ok(entry,id);const g=guideOf(entry);g.steps.forEach((step,index)=>assert.equal(en[`pb-connector-guides.${id}.step${index+1}`],step.replace(/^\d+\. /,'')));for(const key of ['skipped','checks','sends','agentLimits'] as const)assert.equal(en[`pb-connector-guides.${id}.${key}`],g[key]);assert.equal(en[`pb-connector-guides.${id}.charges`],g.charges.line);assert.deepEqual(fake[id],{guide:g,capabilities:connectorCapabilities(id)},id);}
 for(const key of Object.keys(en)){assert.ok(hi[key],key);assert.ok(review.machineDrafted.includes(key),key);}
});


test('the browser Zoho Books guide retains the exact native guide and capability contract', () => {
 const entry=CONNECTOR_CATALOGUE.find(row=>row.id==='zoho-books');
 assert.ok(entry);
 const fake=JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-guides.json',import.meta.url),'utf8'));
 assert.deepEqual(fake['zoho-books'],{guide:guideOf(entry),capabilities:connectorCapabilities(entry.id)});
});
