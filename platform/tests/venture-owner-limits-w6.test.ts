import test from 'node:test';
import assert from 'node:assert/strict';
import { postingLimitsGet, postingLimitsSet } from '../runtime/venture/build/posting-limits.ts';
import { ownerPostingLimits } from '../runtime/venture/build/posting.ts';
import { HOUSE_POSTING_RULES, gateUnits, effectivePostingLimits } from '../runtime/venture/playbooks/social/post-limits.ts';
import { postingRisk } from '../runtime/venture/playbooks/social/risk-gate.ts';
import { pipelineSettingsHandler } from '../runtime/venture/network/pipeline-methods.ts';
import { laneLimits, openRefusal } from '../runtime/venture/network/governor.ts';
import { setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { runsAllowWritesHandler, writeCapDenial, writeCapsToday } from '../runtime/venture/delivery/harness/write-caps.ts';
import { code, owner, phone, setup } from './venture-views-env.ts';
import { ventureAction } from '../runtime/venture/records.ts';

test('w6 owner posting settings raise the actual risk gate above the defaults', async () => {
  const env = await setup();
  const limits = { capPer24h: 10, minGapMinutes: 5, warmUpDays: 0, duplicatePercent: 99, linkStreak: 8 };
  const view = await postingLimitsSet(env.deps, owner, { connectorId: 'x', limits });
  assert.deepEqual(view.channels.find(row => row.connectorId === 'x')!.inUse, limits);
  assert.deepEqual(await postingLimitsGet(env.deps, owner, {}), view);
  assert.match(view.line, /WhatsApp, Gmail and X.*ban/);
  const effective = effectivePostingLimits(gateUnits(ownerPostingLimits(env.store.read(), 'x')));
  const history = ['2026-10-15T01:00:00.000Z', '2026-10-15T02:00:00.000Z', '2026-10-15T03:00:00.000Z'].map((at, i) => ({ id: String(i), at, text: `Different old note ${i}`, channel: 'x' }));
  const result = postingRisk({ channel: 'x', name: 'X', text: 'Fresh vegetables arrive at the store tomorrow.', now: '2026-10-15T06:00:00.000Z', history, limits: effective });
  assert.equal(result.blocked, false, result.blocks.join('\n'));
  await assert.rejects(postingLimitsSet(env.deps, phone, { connectorId: 'x', limits }), code('APP_APPROVAL_REQUIRED'));
});

test('w6 outreach daily, weekly and warm-up settings replace defaults without hidden clamps', async () => {
  const env = await setup();
  const caps = { newPerDay: 101, perWeek: 1001, channels: { email: 60, 'linkedin-note': 100 }, channelWeeks: { 'linkedin-note': 500 }, warmupPercent: [100, 100, 100, 100, 100] };
  const view = await pipelineSettingsHandler(env.deps, owner, { caps });
  assert.deepEqual(view.caps, caps);
  const today = '2026-10-15';
  const email = laneLimits(env.store.read(), env.venture, 'email', today);
  assert.equal(email.day, 60);
  await ventureAction(env.deps, owner, 'prepare', 'test.sends', tx => {
    for (let i = 0; i < 30; i++) tx.put({ ...tx.base('venture-outreach'), outreachKind: 'follow-up', channel: 'email', personId: null, sent: { at: env.now(), channel: 'own-mailbox' } } as never);
  });
  const linkedin = laneLimits(env.store.read(), env.venture, 'linkedin-note', today);
  assert.equal(linkedin.day, 100);
  assert.equal(linkedin.week, 500);
  assert.equal(openRefusal(env.store.read(), env.venture, { kind: 'follow-up', channel: 'email', lane: 'email', to: null, now: env.now() }), null);
  await pipelineSettingsHandler(env.deps, owner, { caps: { channels: { email: 30 } } });
  assert.equal(openRefusal(env.store.read(), env.venture, { kind: 'follow-up', channel: 'email', lane: 'email', to: null, now: env.now() })?.code, 'OUTREACH_DAILY_CAP');
  await assert.rejects(pipelineSettingsHandler(env.deps, phone, { caps }), code('APP_APPROVAL_REQUIRED'));
});

test('w6 weekly and warm-up settings are validated and can remove the default weekly cap', async () => {
  const env = await setup();
  for (const caps of [
    { channelWeeks: { email: 0 } }, { channelWeeks: { email: Infinity } }, { channelWeeks: { email: 1.1 } },
    { channelWeeks: { fax: 50 } }, { warmupPercent: [] }, { warmupPercent: [25, 40, 101, 100, 100] },
    { warmupPercent: [25, 20, 60, 80, 100] }, { warmupPercent: [25, 40.1, 60, 80, 100] },
  ]) await assert.rejects(pipelineSettingsHandler(env.deps, owner, { caps }), code('INVALID_VENTURE_REQUEST'));
  await pipelineSettingsHandler(env.deps, owner, { caps: { channelWeeks: { 'linkedin-note': null }, warmupPercent: [100, 100, 100, 100, 100] } });
  assert.equal(laneLimits(env.store.read(), env.venture, 'linkedin-note', '2026-10-15').week, null);
});

test('w6 owner write caps control the actual denial check above the defaults', async () => {
  const env = await setup();
  await setSpendPolicy(env.deps, owner, { writeCaps: { drafts: 60, 'books-lines': 1000, messages: 80 } });
  assert.deepEqual(writeCapsToday(env.store.read(), env.venture, env.now()).map(row => row.cap), [60, 1000, 80]);
  const flight = { runId: 'sample', calls: [], tables: [{ id: 'sample', at: env.now(), rows: Array.from({ length: 750 }, () => ({})), source: { kind: 'transform' } }] } as never;
  assert.equal(writeCapDenial(env.store.read(), env.venture, 'books-lines', env.now(), flight, 'made'), null);
  await setSpendPolicy(env.deps, owner, { writeCaps: { 'books-lines': 700 } });
  assert.equal(writeCapDenial(env.store.read(), env.venture, 'books-lines', env.now(), flight, 'made')?.code, 'WRITE_CAP_REACHED');
});

test('w6 daily allowances leave the configured limit separate for the settings editor', async () => {
  const env = await setup();
  await runsAllowWritesHandler(env.deps, owner, { kind: 'messages' });
  const row = writeCapsToday(env.store.read(), env.venture, env.now()).find(item => item.kind === 'messages')!;
  assert.equal(row.cap, 80);
  assert.equal(row.configuredCap, 40);
  await setSpendPolicy(env.deps, owner, { writeCaps: { messages: row.configuredCap } });
  assert.equal(writeCapsToday(env.store.read(), env.venture, env.now()).find(item => item.kind === 'messages')!.cap, 80);
});

test('w6 owner limits reject non-finite, fractional and unsafe numbers, not high valid counts', async () => {
  const env = await setup();
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(postingLimitsSet(env.deps, owner, { connectorId: 'x', limits: { capPer24h: value } }), code('INVALID_VENTURE_REQUEST'));
    await assert.rejects(pipelineSettingsHandler(env.deps, owner, { caps: { channels: { email: value } } }), code('INVALID_VENTURE_REQUEST'));
    await assert.rejects(setSpendPolicy(env.deps, owner, { writeCaps: { messages: value } }), code('INVALID_VENTURE_REQUEST'));
  }
  assert.equal((await postingLimitsSet(env.deps, owner, { connectorId: 'x', limits: { capPer24h: 10001 } })).channels.find(row => row.connectorId === 'x')!.inUse.capPer24h, 10001);
});

test('posting rules identify editable pace numbers as defaults', () => {
  for (const id of ['house-post-cap-24h', 'house-post-min-gap', 'house-warm-up', 'house-near-duplicate', 'house-link-streak']) {
    assert.match(HOUSE_POSTING_RULES.find(rule => rule.id === id)!.rule, /default/i);
  }
});
