// C5 task 1: Team introduces each agent once, per member. The line is code-written (name and job line); "Got it"
// (venture.team.introduced) is a quiet seen-mark kept per member, the newest record holding every agent met.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { TeamListView } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as agents } from '../runtime/venture/agents/index.ts';
import { call, code, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import { flagshipTeam } from './venture-team-fixtures.ts';

const partner: Context = { memberId: 'partner', role: 'cofounder', epoch: 1, channel: 'desktop' };
const team = (env: Env, ctx?: Context) => call<TeamListView>(env, 'venture.team.list', {}, ctx);
const introduced = (env: Env, agentIds: unknown, ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }) =>
  (agents as Record<string, (deps: any, ctx: Context, payload: unknown) => Promise<{ met: string[] }>>)['venture.team.introduced']!(env.deps, ctx, { agentIds });

test('a new team introduces every agent once, with its code-written line; Keeper and code roles are not introduced', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  const view = await team(env);
  assert.deepEqual(view.introduce, [{ agentId: 'delivery', line: 'Bookkeeping agent reads each order, works on it with tools, and drafts the reply for you to check.' }]);
  await introduced(env, ['delivery']);
  assert.deepEqual((await team(env)).introduce, []);
  const records = listRecords(env.store.read(), 'venture-team-intro');
  assert.deepEqual(records.map(record => [record.memberId, record.agentIds]), [['owner', ['delivery']]]);
  await introduced(env, ['delivery']);
  assert.equal(listRecords(env.store.read(), 'venture-team-intro').length, 1, 'meeting again writes nothing');
});

test('a later hire is introduced alone, and a second member still meets everyone', async () => {
  const env = await setup();
  await flagshipTeam(env, 'youtube');
  const first = (await team(env)).introduce!;
  const ids = first.map(item => item.agentId);
  assert.ok(ids.length >= 2, 'the flagship has more than one agent');
  assert.ok(first.every(item => !/^Keeper\b/.test(item.line)));
  await introduced(env, ids.slice(0, -1));
  assert.deepEqual((await team(env)).introduce!.map(item => item.agentId), ids.slice(-1));
  await env.store.update(state => { state.members.push({ id: 'partner', name: 'Partner', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }); });
  assert.deepEqual((await team(env, partner)).introduce!.map(item => item.agentId), ids);
  await introduced(env, ids, partner);
  assert.deepEqual((await team(env, partner)).introduce, []);
  assert.deepEqual((await team(env)).introduce!.map(item => item.agentId), ids.slice(-1), 'one member meeting them leaves the other alone');
});

test('introduced refuses a bad list, and a team with no agents yet has no lines', async () => {
  const env = await setup();
  assert.deepEqual((await team(env)).introduce ?? [], []);
  await assert.rejects(introduced(env, []), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(introduced(env, ['a b']), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(introduced(env, 'delivery'), code('INVALID_VENTURE_REQUEST'));
});
