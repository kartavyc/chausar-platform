// Chausar SEO playbook acceptance tests. GEOHub (AGPL, ideas only), seo-agent (MIT); no source copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEO_VISIBILITY_DEFINITION } from '../runtime/venture/playbooks/seo-visibility/definition.ts';
import { pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import {scoreSeoBaseline} from '../runtime/venture/playbooks/seo-visibility/checks.ts';
import {SEO_RULES} from '../runtime/venture/playbooks/seo-visibility/rules.ts';
import {SEO_VISIBILITY_CATALOGUE} from '../runtime/venture/build/catalogue/seo-visibility.ts';
import {connectorModes} from '../runtime/venture/build/connectors.ts';
test('E2 baseline cases and official rules are registered, scored and offered with honest write modes',()=>{
 const result=runKitBaseline(SEO_VISIBILITY_DEFINITION);for(const id of ['article-uncorroborated-number','local-page-four-elements','refresh-plan-not-edit']){assert.ok(result.cases.find(c=>c.id===id)?.pass,id);assert.equal(scoreSeoBaseline(id,'Generic success with no evidence.').pass,false);}
 assert.equal(result.passed,8);assert.equal(result.of,8);
 for(const id of ['google-title-links','google-snippets','google-structured-data','google-business-profile'])assert.ok(SEO_RULES.some(r=>r.id===id&&r.needs===null&&r.checkedOn==='2026-10-28'));
 for(const id of ['seo-wordpress','seo-cloudflare-kv']){const entry=SEO_VISIBILITY_CATALOGUE.find(e=>e.id===id);assert.ok(entry);assert.ok(connectorModes(entry).some(m=>m.mode==='write'&&m.status==='available'));}
});

test('the visibility playbook lands with owner prices, an honest tile and a committed baseline', () => {
  const definition = SEO_VISIBILITY_DEFINITION;
  assert.ok(definition, 'the playbook must be built');
  assert.equal(definition.registration.id, 'seo-visibility');
  assert.equal(pickPlaybook('SEO agency for clinics')?.id, 'seo-visibility');
  assert.equal(pickPlaybook('Seoul food truck'), null);
  assert.deepEqual(definition.offers.map(offer => offer.id), ['visibility-check', 'quarterly-remeasure', 'website-check', 'content-retainer', 'fix-and-measure', 'local-seo']);
  assert.ok(definition.offers.every(offer => offer.price === 'owner-sets'));
  assert.ok(definition.roles.some(role => role.id === 'chausar' && role.kind === 'code'));
  assert.equal(definition.steps.find(step => step.id === 'capture-answers')?.waitDays, 14);
  assert.equal(definition.startTile.category, 'marketing');
  assert.ok(definition.connectors.filter(connector => connector.label.startsWith('planned:')).every(connector => connector.manualPath && connector.waitsOn));
  assert.equal(runKitBaseline(definition).ok, true);
});

test('the committed baseline rejects a generic answer that omits the case evidence boundaries',()=>{
  assert.ok(SEO_VISIBILITY_DEFINITION);
  const result=runKitBaseline(SEO_VISIBILITY_DEFINITION,undefined,()=> 'A generic report with no specific evidence.');
  assert.equal(result.ok,false);
});


test('monthly offers use actual writing and verification steps while the Writer has no web grant',()=>{
 const d=SEO_VISIBILITY_DEFINITION;
 const writer=d.steps.filter(s=>s.role==='writer');assert.ok(writer.length);assert.ok(writer.every(s=>(s.tools??[]).length===0));
 assert.equal(d.draftStep('content-retainer'),'write');
 for(const id of ['content-retainer','fix-and-measure','local-seo'])assert.equal(d.offers.find(o=>o.id===id)?.pricing,'monthly');
 for(const tool of ['seo.corroborate','seo.lint','seo.meta','seo.impact','seo.refresh','seo.local'])assert.ok(d.tools.includes(tool as any));
 for(const id of ['claims-corroborated','local-not-doorway','report-cites-receipts'])assert.ok(d.judgeRules.some(r=>r.id===id));
});
