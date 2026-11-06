// C5 task 17: the monthly pack for the CA, a standing order the owner approves once. On the 1st the sweep makes last
// month's files in Chausar's own exports folder, a local write only, and raises one Today row. A second sweep makes no
// second pack; switched off, nothing happens; the pack sent, the row leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, call, code, owner, phone, START } from './venture-views-env.ts';
import { handlers } from '../runtime/venture/money/index.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { runCaPackDue } from '../runtime/venture/money/ca-pack.ts';

const money = (env: any, method: string, payload: unknown = {}, ctx = owner): Promise<any> => (handlers as any)[method](env.deps, ctx, payload);
/** 1 Dec 2026, 00:05 in India is 30 Nov 18:35 UTC. */
const ON_THE_FIRST = Date.parse('2026-11-30T18:35:00.000Z');

async function business() {
  const env = await setup();
  const kept: { name: string; text: string }[] = [];
  (env.workspace as any).keepFile = async (tail: string, text: string) => { const name = `chausar-main-${tail}`; kept.push({ name, text }); return name; };
  return { env, kept };
}
const rowsOf = async (env: any) => (await call<any>(env, 'venture.queue.list')).rows.filter((row: any) => row.id.startsWith('ca-pack:'));

test('on the 1st: one pack for last month, one Today row; a second sweep makes no second pack', async () => {
  const { env, kept } = await business();
  assert.equal((await money(env, 'venture.accountant.schedule.get')).on, false);
  const set = await money(env, 'venture.accountant.schedule.set', { on: true });
  assert.equal(set.on, true);
  assert.equal(set.next, '2026-10-31T18:30:00.000Z', 'the next 1st at midnight in India');
  assert.ok(listRecords(env.store.read(), 'venture-decision').some(record => record.subject === 'ca-pack:schedule'), 'the standing order is a recorded decision');

  // Before the 1st: nothing.
  await runCaPackDue(env.deps, owner);
  assert.equal(kept.length, 0);
  assert.deepEqual(await rowsOf(env), []);

  env.advance(ON_THE_FIRST - Date.parse(START));
  await runCaPackDue(env.deps, owner);
  assert.deepEqual(kept.map(file => file.name), ['chausar-main-ca-2026-11.csv', 'chausar-main-ca-2026-11-receipts.json'], 'only the newest month, even after a month away');
  assert.ok(kept[0].text.startsWith('﻿Section,Date,Number'), 'the same CSV as Export for your CA');
  const rows = await rowsOf(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "November's pack for your CA is ready");
  assert.match(rows[0].line, /Nothing goes to your CA until you send it/);
  assert.deepEqual(rows[0].notice, { probe: 'ca-pack', severity: 'low', link: '#/money?sheet=accountant:2026-11', file: 'chausar-main-ca-2026-11.csv' });
  assert.deepEqual(rows[0].actions.map((action: any) => [action.id, action.label, action.primary]), [['later', 'Not now', false], ['show-file', 'Show in folder', false], ['open', 'Send to my CA', true]]);

  await runCaPackDue(env.deps, owner);
  assert.equal(kept.length, 2, 'a second sweep makes no second pack');
  assert.equal(listRecords(env.store.read(), 'venture-ca-pack').length, 1);

  // Navigation actions are not decisions, so a bare press changes nothing.
  const refused = await call<any>(env, 'venture.queue.decide', { id: rows[0].id, digest: rows[0].digest, action: 'show-file' });
  assert.equal(refused.reason, 'NOT_A_DECISION');

  // The pack sent: the row leaves.
  await money(env, 'venture.accountant.pack.done', { month: '2026-11' });
  assert.deepEqual(await rowsOf(env), []);
  await money(env, 'venture.accountant.pack.done', { month: '2026-05' });
  assert.equal(listRecords(env.store.read(), 'venture-ca-pack').length, 1, 'a month with no pack changes nothing');
});

test('switched off: nothing. Turned on after the 1st: nothing until the next 1st', async () => {
  const { env, kept } = await business();
  await money(env, 'venture.accountant.schedule.set', { on: true });
  await money(env, 'venture.accountant.schedule.set', { on: false });
  env.advance(ON_THE_FIRST - Date.parse(START));
  await runCaPackDue(env.deps, owner);
  assert.equal(kept.length, 0);
  assert.deepEqual(await rowsOf(env), []);
  await money(env, 'venture.accountant.schedule.set', { on: true });
  await runCaPackDue(env.deps, owner);
  assert.equal(kept.length, 0, 'the month that already turned is not made late');
});

test('the standing order is set in the app only; a host with no folder makes no pack and raises no row', async () => {
  const env = await setup();
  await assert.rejects(money(env, 'venture.accountant.schedule.set', { on: true }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(money(env, 'venture.accountant.schedule.set', { on: 'yes' }), code('INVALID_VENTURE_REQUEST'));
  await money(env, 'venture.accountant.schedule.set', { on: true });
  env.advance(ON_THE_FIRST - Date.parse(START));
  await runCaPackDue(env.deps, owner);
  assert.equal(listRecords(env.store.read(), 'venture-ca-pack').length, 0);
  assert.deepEqual(await rowsOf(env), []);
});
