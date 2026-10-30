// Dynamic kit routes preserve every approval floor, after cfo question-routing (MIT ideas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitWorkflowIds } from '../runtime/venture/playbooks/kit/workflow.ts';
import { kitFixture } from './fixtures/venture/kit-fixture.ts';

test('a route cannot be empty, duplicated, unknown, lose an approval floor or change its final step', () => {
  const definition = kitFixture();
  const offer = { ...definition.offers[0], stages: ['calendar'], workflow: ['voice', 'approve', 'calendar'] };
  for (const stages of [[], ['voice', 'voice', 'approve', 'calendar'], ['voice', 'unknown', 'approve', 'calendar'], ['voice', 'calendar'], ['voice', 'calendar', 'approve']]) {
    assert.throws(() => kitWorkflowIds({ ...definition, routeSteps: () => stages }, offer), { code: 'PLAYBOOK_ROUTE_INVALID' });
  }
  assert.deepEqual(kitWorkflowIds({ ...definition, routeSteps: () => ['approve', 'calendar'] }, offer), ['approve', 'calendar']);
});
