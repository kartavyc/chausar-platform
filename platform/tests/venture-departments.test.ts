// Ink v2 wave 4 (4A1): the five fixed departments, every flagship role on exactly one of them, the department of the
// one agent the eight fixed steps have, and which role a harness turn worked for (code decides, never a guess).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPARTMENT_IDS, SERVICE_TYPES, type AgentTurnRecord } from '../runtime/venture/contracts.ts';
import {
  DEPARTMENTS, ROLE_DEPARTMENTS, departmentOfRole, departmentOfService, roleOfTurn, validateDepartments,
} from '../runtime/venture/playbooks/departments.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';

const code = (expected: string, words?: RegExp) => (error: any) => {
  assert.equal(error?.code, expected, error?.message);
  if (words) assert.match(error.message, words);
  return true;
};

test('DEPARTMENTS is exactly the five fixed departments, in order, with their words', () => {
  assert.deepEqual(DEPARTMENTS.map(item => [item.id, item.name]), [
    ['sales', 'Sales and clients'], ['marketing', 'Marketing'], ['production', 'Production'], ['money', 'Money'], ['operations', 'Operations'],
  ]);
  assert.deepEqual(DEPARTMENTS.map(item => item.id), [...DEPARTMENT_IDS]);
  assert.ok(Object.isFrozen(DEPARTMENTS));
});

test('validateDepartments passes for the three flagships: every role id has exactly one department', () => {
  validateDepartments();
  const map = (id: string) => {
    const delivery = flagshipDelivery(id)!;
    return Object.fromEntries(delivery.roles.map(role => [role.id, departmentOfRole(delivery, role.id)]));
  };
  assert.deepEqual(map('youtube'), {
    'intake-clerk': 'production', producer: 'sales', chausar: 'production', 'story-editor': 'production', packager: 'marketing', cutter: 'production', analyst:'marketing', 'community-helper':'sales',
  });
  // The CA firm's checks role is the auditor; the calculator is code that works out tax, so it sits with Money.
  assert.deepEqual(map('ca-firm'), {
    intake: 'sales', preparer: 'money', reconciler: 'money', writer: 'money', checker: 'operations', calculator: 'money',
  });
  assert.deepEqual(map('social-agency'), {
    intake: 'sales', strategist: 'marketing', writer: 'marketing', creative: 'production', checker: 'operations', code: 'operations', analyst: 'marketing',
  });
});

test('a playbook with a role missing from the map fails with DEPARTMENT_MISSING naming the role', () => {
  const youtube = flagshipDelivery('youtube')!;
  const fixture = { ...youtube, roles: [...youtube.roles, { id: 'thumbnail-artist', name: 'Thumbnail artist', job: 'Draws thumbnails.', kind: 'agent' as const }] };
  assert.throws(() => validateDepartments([fixture]), code('DEPARTMENT_MISSING', /Thumbnail artist/));
  assert.throws(() => departmentOfRole(fixture, 'thumbnail-artist'), code('DEPARTMENT_MISSING', /Thumbnail artist/));
  // A map entry that names something other than the five departments is missing too.
  const wrong = { ...ROLE_DEPARTMENTS, youtube: { ...ROLE_DEPARTMENTS.youtube, packager: 'design' } } as unknown as typeof ROLE_DEPARTMENTS;
  assert.throws(() => validateDepartments([youtube], wrong), code('DEPARTMENT_MISSING', /Packager/));
});

test("the eight fixed steps' one agent takes its department from the service type", () => {
  const expected: Record<string, string> = {
    bookkeeping: 'money', agency: 'marketing', content: 'marketing', support: 'sales',
    studio: 'production', consulting: 'production', research: 'production', other: 'production',
  };
  assert.deepEqual(Object.fromEntries(SERVICE_TYPES.map(type => [type, departmentOfService(type)])), expected);
});

test('a turn belongs to the one role whose steps hold its tools, else the drafting role for a write turn, else to no single role', () => {
  const youtube = flagshipDelivery('youtube')!;
  const turn = (calls: string[], step: 'act' | 'write' = 'act', role?: string): Pick<AgentTurnRecord, 'step' | 'calls' | 'role'> =>
    ({ step, calls: calls.map(tool => ({ tool, input: '{}' })), ...(role ? { role } : {}) });
  const of = (value: ReturnType<typeof turn>) => roleOfTurn(youtube, youtube.steps, value, 'package');
  assert.equal(of(turn(['youtube.hooks'])), 'story-editor', 'held only by the find step');
  assert.equal(of(turn(['youtube.hooks', 'files.read'])), 'story-editor', 'files.read is held by two roles, the hooks tool by one');
  assert.equal(of(turn(['files.read'])), null, 'held by the intake clerk and the story editor: shared, never split by guess');
  assert.equal(of(turn(['youtube.hooks', 'evidence.record'])), null, 'two tools held by two different roles');
  assert.equal(of(turn(['youtube.retention', 'handoff.client'])), 'intake-clerk');
  assert.equal(of(turn(['youtube.hooks', 'outbox.propose'])), 'story-editor', 'a tool no step holds says nothing about whose turn it was');
  assert.equal(of(turn([])), null, 'an act turn with no calls');
  assert.equal(of(turn([], 'write')), 'packager', "a write turn drafts on the order's drafting step");
  assert.equal(of(turn(['files.read'], 'act', 'intake-clerk')), 'intake-clerk', 'a role the turn record names wins');
  assert.equal(of(turn(['youtube.hooks'], 'act', 'nobody')), 'story-editor', 'a stored role that is not on the team is ignored');
});
