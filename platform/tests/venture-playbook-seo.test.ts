// Chausar SEO playbook acceptance tests. GEOHub (AGPL, ideas only), seo-agent (MIT); no source copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEO_VISIBILITY_DEFINITION } from '../runtime/venture/playbooks/seo-visibility/definition.ts';
import { pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import {scoreSeoBaseline} from '../runtime/venture/playbooks/seo-visibility/checks.ts';
test('the visibility playbook lands with owner prices, an honest tile and a committed baseline', () => {
  const definition = SEO_VISIBILITY_DEFINITION;
  assert.ok(definition, 'the playbook must be built');
  assert.equal(definition.registration.id, 'seo-visibility');
  assert.equal(pickPlaybook('SEO agency for clinics')?.id, 'seo-visibility');
  assert.equal(pickPlaybook('Seoul food truck'), null);
  assert.deepEqual(definition.offers.map(offer => offer.id), ['visibility-check', 'quarterly-remeasure', 'website-check']);
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
