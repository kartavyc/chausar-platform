// Connector guide accurately describes the implemented owner accounting path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTOR_CATALOGUE} from '../runtime/venture/build/catalogue.ts';
import {connectorCard} from '../runtime/venture/build/connectors.ts';
test('Zoho setup guide names session owner approvals and manual limits without claiming global planned',()=>{const guide=connectorCard(CONNECTOR_CATALOGUE.find(row=>row.id==='zoho-books')!,false).guide;assert.ok(guide);assert.match(guide.steps.join(' '),/client.*cycle/i);assert.match(guide.steps.join(' '),/session/i);assert.match(guide.sends,/opening/i);assert.match(guide.sends,/settlement/i);assert.match(guide.agentLimits,/cannot send directly/i);assert.doesNotMatch(guide.steps.join(' '),/Nothing to set up/);assert.match(guide.checks,/fixture-tested/i);});
