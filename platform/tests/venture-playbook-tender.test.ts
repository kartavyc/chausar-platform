// Tender registration and source-executed baseline contracts, original Chausar implementation.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {TENDER_DESK_DEFINITION} from '../runtime/venture/playbooks/tender-desk/definition.ts';
import {scoreTenderBaseline} from '../runtime/venture/playbooks/tender-desk/baseline.ts';
import {TENDER_DESK_CATALOGUE} from '../runtime/venture/build/catalogue/tender-desk.ts';
import {guideOf,hasHandGuide} from '../runtime/venture/build/guides.ts';
test('tender playbook defines owner prices, source intake, type approval and a portal handoff',()=>{
 const d=TENDER_DESK_DEFINITION;assert.ok(d);assert.deepEqual(d.offers.map(o=>o.id),['bid-response','documentation-bucket','compliance-matrix']);assert.ok(d.offers.every(o=>o.price==='owner-sets'));
 assert.deepEqual(d.steps.map(s=>s.id),['bucket','import','questions','assign','draft','ground','approve','export','submit']);assert.ok(d.connectors.filter(c=>['gem','cppp','state-portals','mail'].includes(c.id)).every(c=>c.label==='handoff'));assert.ok(d.rules.every(r=>Object.hasOwn(r,'needs')));
 assert.ok(d.approvals.some(a=>a.id==='answers-by-type'&&a.floor));assert.deepEqual(d.tools,['tender.questions','tender.ground']);
});
test('tender connectors describe real source reads and manual submission without portal credentials',()=>{
 assert.deepEqual(TENDER_DESK_CATALOGUE.map(c=>c.id),['tender-documents','tender-submission']);
 for(const item of TENDER_DESK_CATALOGUE){assert.ok(hasHandGuide(item.id));assert.match(guideOf(item).agentLimits,/cannot/);assert.equal(item.vendorUrl,null);}
 assert.deepEqual(TENDER_DESK_CATALOGUE[1].targets,['handoff']);
});
test('committed tender baseline runs the source guards and fails when evidence invalidates its expected refusal',()=>{
 const cases=JSON.parse(readFileSync(new URL('../runtime/venture/playbooks/tender-desk/baselines/tender-desk.json',import.meta.url),'utf8'));
 assert.deepEqual(cases.map((c:any)=>c.id),['gap-not-yes','iso-number-not-in-docs','pricing-left-to-owner']);for(const item of cases)assert.equal(scoreTenderBaseline(item,item.draft).pass,true,item.id);
 const first=cases[0],source=JSON.parse(first.meta.source);source.documents=[{id:'company',text:'We provide hosting.'}];assert.equal(scoreTenderBaseline({...first,meta:{source:JSON.stringify(source)}},first.draft).pass,false);
 for(const item of cases)assert.equal(scoreTenderBaseline({...item,meta:{}},item.draft).pass,false);
});
