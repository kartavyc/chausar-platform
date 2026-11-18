// The owner changes what the business needs after setup (15 Nov 2026). Step 3 lists the needs the owner's AI picked
// beside the way to earn; until now nobody but the AI could say what they were. venture.needs.list now also answers
// what is chosen and what can be chosen, and the owner ticks or unticks needs through the existing venture.owner.set
// { needs }. The AI still names four at most (a short list to read in one look); the owner's own choice has no such
// ceiling: every listed need may be ticked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEED_IDS, NEEDS_MAX, businessNeeds, keptNeeds, neededGroups, ownerNeeds } from '../runtime/venture/core/needs.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { CURATED_MCP_SERVERS } from '../runtime/venture/agent-runtime/mcp-registry.ts';
import { sourceRows } from '../runtime/venture/customers/find-words.ts';
import { chiefBusiness } from './venture-chief-helpers.ts';

const POTTER_NEEDS = ['find-customers', 'write-to-customers', 'payments'];
const OFFERED = sourceRows([], CURATED_MCP_SERVERS.filter(entry => entry.finds === 'leads'));

test('the owner\'s own needs: listed ids, once each, in the order given, every one of them if they wish', () => {
  assert.deepEqual(ownerNeeds([...NEED_IDS]), [...NEED_IDS]);
  assert.deepEqual(ownerNeeds(['payments', 'teleport', 'find-customers', 7, null, 'payments']), ['payments', 'find-customers']);
  for (const none of [undefined, null, 'payments', { 0: 'payments' }, []]) assert.deepEqual(ownerNeeds(none), []);
  // The AI's answer is still a short list.
  assert.equal(keptNeeds([...NEED_IDS]).length, NEEDS_MAX);
  // Every need the owner keeps is answered with its ways, all five when all are kept.
  assert.deepEqual(neededGroups([...NEED_IDS], 'IN', [], OFFERED).map(group => group.id), [...NEED_IDS]);
});

test('needs.list says what is chosen and what can be chosen, and owner.set changes it', async () => {
  const env = await chiefBusiness();
  const venture = listRecords(env.store.read(), 'venture-record')[0]!;
  // Nothing kept: nothing is chosen, the field's list stands, and every need can be chosen.
  const before = await env.call('venture.needs.list', {});
  assert.deepEqual(before.chosen, []);
  assert.deepEqual(before.choices, [...NEED_IDS]);
  assert.deepEqual(before.needs, businessNeeds(before.family?.id ?? null, venture.country.code, venture.country.paymentRails));
  // The plan's needs, as kept at setup.
  await env.call('venture.owner.set', { needs: POTTER_NEEDS });
  let list = await env.call('venture.needs.list', {});
  assert.deepEqual(list.chosen, POTTER_NEEDS);
  assert.deepEqual(list.groups.map((group: any) => group.id), POTTER_NEEDS);
  // The owner unticks one and ticks two more: all of it is kept, in the order sent.
  const mine = ['find-customers', 'write-to-customers', 'designs-documents', 'appointments'];
  assert.deepEqual((await env.call('venture.owner.set', { needs: mine })).needs, mine);
  list = await env.call('venture.needs.list', {});
  assert.deepEqual(list.chosen, mine);
  assert.deepEqual(list.groups.map((group: any) => group.id), mine);
  assert.deepEqual(list.needs, []);
  // All five: the owner's choice has no ceiling.
  assert.deepEqual((await env.call('venture.owner.set', { needs: [...NEED_IDS] })).needs, [...NEED_IDS]);
  list = await env.call('venture.needs.list', {});
  assert.deepEqual(list.chosen, [...NEED_IDS]);
  assert.deepEqual(list.groups.map((group: any) => group.id), [...NEED_IDS]);
  assert.deepEqual(listRecords(env.store.read(), 'venture-owner-profile').at(-1)!.needs, [...NEED_IDS]);
  // Every one unticked: nothing is chosen, and the field's list is back.
  await env.call('venture.owner.set', { needs: [] });
  list = await env.call('venture.needs.list', {});
  assert.deepEqual(list.chosen, []);
  assert.deepEqual(list.groups, []);
  assert.deepEqual(list.needs, before.needs);
  assert.deepEqual(list.choices, [...NEED_IDS]);
});
