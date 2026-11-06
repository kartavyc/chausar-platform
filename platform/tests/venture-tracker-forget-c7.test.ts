// C7 task 19: Forget reaches trackers. A row whose person cell is the forgotten person goes; a text cell naming them is
// erased; a row about someone else stays. A deleted business takes its trackers with its records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { ERASED_CELL } from '../runtime/venture/trackers/privacy.ts';
import { owner, setup, type Env } from './venture-views-env.ts';
import { CONNECTIONS, net, personNamed } from './venture-network-env.ts';

const agents = (env: Env, method: string, payload: unknown): Promise<any> => (agentHandlers as any)[method](env.deps, owner, payload);

test('after Forget no row or cell names the person; a row about someone else stays', async () => {
  const env = await setup();
  await net(env, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS });
  const asha = personNamed(env, 'Asha Rao'), rahul = personNamed(env, 'Rahul Mehta');
  const { tracker } = await agents(env, 'venture.trackers.set', { tracker: { name: 'Follow-ups', columns: [{ id: 'who', name: 'Who', kind: 'person' }, { id: 'note', name: 'Note', kind: 'text' }] } });
  await agents(env, 'venture.trackers.rows.add', { trackerId: tracker.id, cells: { who: asha.id, note: 'Call next week' } });
  await agents(env, 'venture.trackers.rows.add', { trackerId: tracker.id, cells: { who: rahul.id, note: 'Stall rent' } });
  await agents(env, 'venture.trackers.rows.add', { trackerId: tracker.id, cells: { note: 'Ask Asha Rao about the intro' } });
  await net(env, 'venture.network.forget', { id: asha.id });
  const rows = listRecords(env.store.read(), 'venture-tracker-row');
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => row.cells.who === rahul.id && row.cells.note === 'Stall rent'));
  assert.ok(rows.some(row => row.cells.note === ERASED_CELL));
  assert.equal(JSON.stringify(rows).includes('Asha'), false);
  assert.equal(JSON.stringify(rows).includes(asha.id), false);
});
