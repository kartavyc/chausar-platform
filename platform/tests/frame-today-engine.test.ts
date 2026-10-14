import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import {
  isActivityReply, isCapabilitiesReply, isChecklistReply, isFaultReport, isFirstRunStatusReply, isHelpReply, isIdentityCard,
  isIdentityCheckReply, isPhoneMessagesReply, isShellReply, isStatusReply, isWorthReply, TODAYX_REFUSALS,
} from '../../app/ui/src/bridge/todayx-contract.ts';

const passphrase = 'Frame today synthetic passphrase 2026';
/** Asserts a reply against its contract validator without narrowing the test's view of it. */
const valid = (guard: (v: unknown) => boolean, value: unknown) => assert.ok(guard(value), JSON.stringify(value));
const code = (expected: string) => (error: any) => error?.code === expected;

async function engineWith(t: any, demo: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-frame-today-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: demo ? 'Frame Demo Shop' : 'Frame Real Shop', passphrase, demo, pack: 'ecommerce', folder: 'main' });
  return engine;
}
async function viewerOf(engine: Engine): Promise<Context> {
  const member = await engine.request('members.add', { id: 'frame-viewer', name: 'Synthetic viewer', role: 'viewer', branches: ['*'] });
  return { memberId: member.id, role: 'viewer', epoch: member.epoch, channel: 'desktop' };
}

test('the demo clock: owner only, demo only, set once, never goes back', async t => {
  const engine = await engineWith(t, true);
  const before = await engine.request('todayx.shell', {});
  valid(isShellReply, before);
  assert.deepEqual(before.clock, { mode: 'real' });
  assert.equal(before.workspace.demo, true);
  assert.equal(before.autoLockMinutes, 10);
  await assert.rejects(engine.request('todayx.clock.advance', { by: 'day' }), code('DEMO_CLOCK_NOT_SET'));

  const viewer = await viewerOf(engine);
  await assert.rejects(engine.requestAs(viewer, 'todayx.clock.set', { date: '2026-04-01' }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(viewer, 'todayx.clock.advance', { by: 'day' }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(viewer, 'todayx.lock.settings', { minutes: 5 }), code('FORBIDDEN'));
  assert.ok(isShellReply(await engine.requestAs(viewer, 'todayx.shell', {})));

  await assert.rejects(engine.request('todayx.clock.set', { date: '2026-02-30' }), code('INVALID_TODAYX_REQUEST'));
  const set = await engine.request('todayx.clock.set', { date: '2026-04-01' });
  valid(isShellReply, set);
  assert.deepEqual(set.clock, { mode: 'demo', date: '2026-04-01' });
  assert.deepEqual(set.banners[0], { kind: 'demo-clock', date: '2026-04-01' });
  await assert.rejects(engine.request('todayx.clock.set', { date: '2026-01-01' }), code('DEMO_CLOCK_ALREADY_SET'));
  await assert.rejects(engine.request('todayx.clock.advance', { by: 'year' }), code('INVALID_TODAYX_REQUEST'));
  const day = await engine.request('todayx.clock.advance', { by: 'day' });
  assert.equal(day.clock.date, '2026-04-02');
  const week = await engine.request('todayx.clock.advance', { by: 'week' });
  assert.equal(week.clock.date, '2026-04-09');
  valid(isShellReply, week);
  // Nothing moves it back: a second set is refused and the date only grows.
  await assert.rejects(engine.request('todayx.clock.set', { date: '2026-04-01' }), code('DEMO_CLOCK_ALREADY_SET'));
  assert.equal((await engine.request('todayx.shell', {})).clock.date, '2026-04-09');

  await assert.rejects(engine.request('todayx.lock.settings', { minutes: 0 }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.lock.settings', { minutes: 241 }), code('INVALID_TODAYX_REQUEST'));
  assert.equal((await engine.request('todayx.lock.settings', { minutes: 240 })).autoLockMinutes, 240);
  assert.ok(isShellReply(await engine.requestAs(viewer, 'todayx.jobsPaused.dismiss', {})));
});

test('a real workspace refuses the demo clock and shows no demo banner', async t => {
  const engine = await engineWith(t, false);
  await assert.rejects(engine.request('todayx.clock.set', { date: '2026-04-01' }), code('DEMO_CLOCK_REAL_WORKSPACE'));
  await assert.rejects(engine.request('todayx.clock.advance', { by: 'week' }), code('DEMO_CLOCK_REAL_WORKSPACE'));
  const shell = await engine.request('todayx.shell', {});
  valid(isShellReply, shell);
  assert.deepEqual(shell.clock, { mode: 'real' });
  assert.deepEqual(shell.banners, []);
  for (const refusal of ['DEMO_CLOCK_REAL_WORKSPACE', 'DEMO_CLOCK_ALREADY_SET', 'DEMO_CLOCK_NOT_SET', 'IDENTITY_INVALID']) assert.ok((TODAYX_REFUSALS as readonly string[]).includes(refusal));
});

test('status, capabilities, first run, checklist, help and phone replies pass their validators', async t => {
  const engine = await engineWith(t, true);
  const status = await engine.request('todayx.status', {});
  valid(isStatusReply, status);
  assert.notEqual(status.sources.state, 'none');
  assert.equal(status.sources.count, '1');
  assert.deepEqual(status.model, { state: 'none' });
  assert.deepEqual(status.third, { kind: 'nothing-left' });

  const capabilities = await engine.request('todayx.capabilities', {});
  valid(isCapabilitiesReply, capabilities);
  const group = (name: string) => capabilities.groups.find((g: any) => g.group === name);
  assert.equal(group('todayx').state, 'live');
  assert.equal(group('todayx').methods, '24');
  assert.equal(group('today').state, 'live');
  assert.equal(group('actions').state, 'live');
  assert.equal(group('askx').day, 5);
  assert.equal(capabilities.groups.length, 24);

  const first = await engine.request('todayx.firstRun.status', {});
  valid(isFirstRunStatusReply, first);
  assert.equal(first.steps.vault, 'done');
  assert.equal(first.steps.books, 'done');
  assert.equal(first.steps.meanings, 'done');
  assert.equal(first.steps.you, 'not-done');
  assert.equal(first.steps.model, 'not-done');
  assert.equal(first.leftThisComputer, 'nothing');

  const checklist = await engine.request('todayx.setupChecklist', {});
  valid(isChecklistReply, checklist);
  assert.deepEqual(checklist.rows.map((r: any) => r.id), ['entity', 'registration', 'bank', 'gst', 'udyam', 'licences']);
  assert.ok(checklist.rows.every((r: any) => r.ruleId && r.source && r.checkedOn));
  assert.ok(checklist.rows.every((r: any) => r.state === 'not-done'));

  assert.ok(isHelpReply(await engine.request('todayx.help', {})));
  const phone = await engine.request('todayx.phoneMessages', {});
  valid(isPhoneMessagesReply, phone);
  // The hosted-link module is registered, so the channels are built and off until a channel is set up.
  assert.deepEqual(phone.channels.map((c: any) => c.state), ['off', 'off', 'off']);
  assert.equal(phone.sentThisMonth, null);
  assert.equal(phone.monthlyBudget, '30');

  const real = await engineWith(t, false);
  const empty = await real.request('todayx.status', {});
  valid(isStatusReply, empty);
  assert.deepEqual(empty.sources, { state: 'none' });
  const worth = await real.request('todayx.worthALook', {});
  valid(isWorthReply, worth);
  assert.deepEqual(worth, { rows: [], state: 'not-loaded-yet' });
  const blocked = await real.request('todayx.firstRun.status', {});
  assert.equal(blocked.blocked, 'no-source');
});

test('identity is checked by format only, saved with prepare permission and completes first-run "you"', async t => {
  const engine = await engineWith(t, true);
  const checked = await engine.request('todayx.identity.check', { fields: { pan: 'AAPFU0939F', gstin: '27AAPFU0939F1ZV', udyam: 'UDYAM-MH-01-0000001', cin: 'U72900MH2015PTC123456', fssai: '12345678901234', iec: 'AAPFU0939F' } });
  valid(isIdentityCheckReply, checked);
  assert.ok(Object.values(checked.fields).every((r: any) => r.ok === true));
  const bad = await engine.request('todayx.identity.check', { fields: { pan: 'AAPF0939F', gstin: '27AAPFU0939F1ZW', udyam: 'UDYAM-M1-01-0000001' } });
  valid(isIdentityCheckReply, bad);
  assert.deepEqual(bad.fields.pan, { ok: false, problem: 'length', expectedLength: 10 });
  assert.deepEqual(bad.fields.gstin, { ok: false, problem: 'checksum', expectedLength: 15 });
  assert.deepEqual(bad.fields.udyam, { ok: false, problem: 'characters', expectedLength: 19 });
  const mismatch = await engine.request('todayx.identity.check', { fields: { pan: 'AAGCB7383J', gstin: '27AAPFU0939F1ZV' } });
  assert.equal(mismatch.fields.gstin.problem, 'pan-mismatch');
  assert.equal((await engine.request('todayx.identity.check', { fields: { gstin: '40AAPFU0939F1ZV' } })).fields.gstin.problem, 'state-code');
  assert.equal((await engine.request('todayx.identity.check', { fields: { gstin: '29AAGCB7383J1Z4' } })).fields.gstin.ok, true);

  const secret = 'ZZZZZ9999Q-SECRET';
  await assert.rejects(engine.request('todayx.identity.save', { fields: { pan: secret }, gstMode: 'regular' }), (error: any) => error.code === 'IDENTITY_INVALID' && !error.message.includes('ZZZZZ'));
  await assert.rejects(engine.request('todayx.identity.save', { fields: { gstin: '27AAPFU0939F1ZV' }, gstMode: 'not-registered' }), code('IDENTITY_INVALID'));
  await assert.rejects(engine.request('todayx.identity.check', { fields: { aadhaar: '1234' } }), code('IDENTITY_INVALID'));
  const viewer = await viewerOf(engine);
  await assert.rejects(engine.requestAs(viewer, 'todayx.identity.save', { fields: { pan: 'AAPFU0939F' }, gstMode: null }), code('FORBIDDEN'));

  assert.equal(await engine.request('todayx.identity.get', {}), null);
  const card = await engine.request('todayx.identity.save', { fields: { pan: ' aapfu0939f ', gstin: '27AAPFU0939F1ZV', fssai: '12345678901234' }, gstMode: 'regular' });
  valid(isIdentityCard, card);
  assert.equal(card.fields.pan, 'AAPFU0939F');
  assert.deepEqual(await engine.request('todayx.identity.get', {}), card);
  assert.equal((await engine.request('todayx.firstRun.status', {})).steps.you, 'done');
  const rows = (await engine.request('todayx.setupChecklist', {})).rows;
  assert.deepEqual(Object.fromEntries(rows.map((r: any) => [r.id, r.state])), { entity: 'done', registration: 'not-done', bank: 'not-done', gst: 'done', udyam: 'not-done', licences: 'done' });
});

test('activity pages newest first with an opaque cursor', async t => {
  const engine = await engineWith(t, true);
  for (let i = 0; i < 60; i++) await engine.request('todayx.identity.save', { fields: { pan: 'AAPFU0939F' }, gstMode: null });
  const first = await engine.request('todayx.activity', {});
  valid(isActivityReply, first);
  assert.equal(first.events.length, 50);
  assert.ok(first.nextCursor);
  const total = Number(first.total);
  assert.ok(total > 60);
  for (let i = 1; i < first.events.length; i++) assert.ok(first.events[i - 1].at >= first.events[i].at);
  const seen = new Set(first.events.map((e: any) => e.id));
  let cursor = first.nextCursor, pages = 1;
  while (cursor) {
    const page = await engine.request('todayx.activity', { cursor });
    valid(isActivityReply, page);
    for (const event of page.events) { assert.equal(seen.has(event.id), false); seen.add(event.id); }
    cursor = page.nextCursor; pages++;
  }
  assert.equal(seen.size, total);
  assert.equal(pages, Math.ceil(total / 50));
  const identity = first.events.find((e: any) => e.type === 'identity.saved');
  assert.equal(identity.actor.kind, 'you');
  assert.deepEqual(identity.values, { rows: '1' });
  assert.ok(first.events.every((e: any) => !JSON.stringify(e.values).includes('AAPFU0939F')));
  const read = await engine.request('todayx.activity', { state: 'done', actor: 'chausar' });
  valid(isActivityReply, read);
  assert.ok(read.events.some((e: any) => e.type === 'import.done' && e.values.source === 'demo-export' && /^[0-9]+$/.test(e.values.rows)));
  const named = await engine.request('todayx.activity', { actor: 'you' });
  assert.ok(named.events.length > 0 && named.events.every((e: any) => e.actor.kind === 'you'));
  assert.equal((await engine.request('todayx.activity', { day: '1999-01-01' })).total, '0');
  await assert.rejects(engine.request('todayx.activity', { cursor: 'not-a-cursor' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.activity', { state: 'maybe' }), code('INVALID_TODAYX_REQUEST'));
});

test('worth a look shows at most five rows from real refusals', async t => {
  const engine = await engineWith(t, true);
  for (let i = 0; i < 7; i++) {
    const content = `id,kind,date,amount,currency\nrow-${i},sale,2026-09-0${i + 1},10.00,INR\n`;
    await assert.rejects(engine.request('sources.import', { sourceId: `refused-file-${i}`, format: 'csv', content, expectedTotals: { rowCount: 2, amountMinor: '1' } }));
  }
  const worth = await engine.request('todayx.worthALook', {});
  valid(isWorthReply, worth);
  assert.equal(worth.state, 'ready');
  assert.equal(worth.rows.length, 5);
  assert.equal(worth.rows[0].kind, 'setup');
  assert.ok(worth.rows.slice(1).every((row: any) => row.kind === 'file-refused' && row.opens === '#/books/sources'));
  assert.ok(worth.rows.every((row: any) => !('figure' in row)));
});
