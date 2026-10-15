import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  isRouteStateProbe, isShellReply, isUpdateStepReply, isUpdatesReply, ROUTE_STATES, TODAYX_R4_REFUSALS, updateRefusal,
  type ShellReply, type UpdatesReply,
} from '../src/bridge/todayx-contract.ts';
import { shellBanners } from '../src/app/shell-banners.ts';
import { todayUpdateRow, updateOffered, updateSentence, updateSteps } from '../src/app/updates-model.ts';
import { createFakeEngine } from '../src/bridge/fake.ts';
import { createShellPort, type DesktopShellBridge } from '../src/bridge/shell.ts';
import { laneRefusalCodes } from '../src/bridge/client.ts';
import { words } from '../src/text/lanes/frame-today.ts';

// Round 4, frame-today contracts and pure adapters: synthetic replies only, no engine, bridge or clock.
const shared = JSON.parse(readFileSync(new URL('../src/text/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const reply = (banners: ShellReply['banners']): ShellReply => ({ workspace: { demo: false }, clock: { mode: 'real' }, banners, autoLockMinutes: 10 });

test('sending closed says the restore date and the count only when the engine knows them', () => {
  const one = (b: ShellReply['banners'][number]) => { const r = reply([b]); assert.equal(isShellReply(r), true); return shellBanners(r, 'en')[0]!; };
  assert.deepEqual(one({ kind: 'sending-closed', restoredFrom: '2026-09-28', unchecked: '3' }).textKey, undefined);
  const dated = one({ kind: 'sending-closed', restoredFrom: '2026-09-28', unchecked: null });
  assert.equal(dated.textKey, 'SH-03.sending-closed.uncounted'); assert.deepEqual(dated.values, { date: '28 Sep 2026' });
  const counted = one({ kind: 'sending-closed', restoredFrom: null, unchecked: '1' });
  assert.equal(counted.textKey, 'SH-03.sending-closed.undated'); assert.equal(counted.values?.['display'], '1');
  assert.equal(one({ kind: 'sending-closed', restoredFrom: null, unchecked: null }).textKey, 'SH-03.sending-closed.undated-uncounted');
  assert.equal(one({ kind: 'update-needed', reason: 'vault-newer', date: null }).textKey, 'SH-03.update-needed.vault-newer');
  // A count that is not digits, or a reason the contract does not name, is refused before drawing.
  assert.equal(isShellReply(reply([{ kind: 'sending-closed', restoredFrom: null, unchecked: '-1' } as never])), false);
  assert.equal(isShellReply(reply([{ kind: 'update-needed', reason: 'newer', date: null } as never])), false);
  for (const key of ['SH-03.sending-closed.uncounted', 'SH-03.sending-closed.undated', 'SH-03.sending-closed.undated-uncounted', 'SH-03.update-needed.vault-newer'])
    assert.ok(words.en[key] && words.hi[key], key);
});

test('the updates reply and step replies are checked field by field', () => {
  const ok: UpdatesReply = { state: 'ready', version: '1.0.0', channel: 'preview', expiresAt: '2026-12-01T00:00:00.000Z', candidate: '1.1.0', platform: 'windows', canUpdate: true };
  assert.equal(isUpdatesReply(ok), true);
  assert.equal(isUpdatesReply({ ...ok, candidate: null }), false, 'Ready names the version it would install.');
  assert.equal(isUpdatesReply({ ...ok, version: '1.0.0 <b>' }), false);
  assert.equal(isUpdatesReply({ ...ok, extra: true }), false);
  assert.equal(isUpdatesReply({ ...ok, state: 'downloading' }), false);
  assert.equal(isUpdateStepReply({ step: 'checked', version: '1.1.0' }), true);
  assert.equal(isUpdateStepReply({ step: 'installed', version: '1.1.0' }), false);
});

test('updates as words: the sentence, the steps, when Update is offered, and Today\'s row', () => {
  const ready: UpdatesReply = { state: 'ready', version: '1.0.0', channel: 'stable', expiresAt: null, candidate: '1.1.0', platform: 'windows', canUpdate: true };
  assert.deepEqual(updateSentence(ready, { phase: 'idle' }), { key: 'SH-08.ready', values: { version: '1.1.0' } });
  assert.equal(updateOffered(ready, { phase: 'idle' }), true);
  assert.equal(updateOffered(ready, { phase: 'checking' }), false, 'Never twice at once.');
  assert.equal(updateOffered(ready, { phase: 'refused', why: 'not-signed' }), false, 'A refused update is not offered again.');
  assert.equal(updateOffered({ ...ready, canUpdate: false }, { phase: 'idle' }), false);
  assert.deepEqual(updateSteps({ phase: 'checking' }).map(s => s.state), ['now', 'waiting', 'waiting']);
  assert.deepEqual(updateSteps({ phase: 'idle' }), []);
  assert.equal(updateSentence(ready, { phase: 'refused', why: 'manual' })?.key, 'SH-08.manual');
  assert.equal(updateSentence({ ...ready, platform: 'mac' }, { phase: 'refused', why: 'manual' })?.key, 'SH-08.mac-unsigned');
  assert.equal(updateSentence({ ...ready, state: 'not-built', candidate: null }, { phase: 'idle' }), null);
  assert.deepEqual(todayUpdateRow(ready), { can: ['update'] });
  assert.deepEqual(todayUpdateRow({ ...ready, canUpdate: false }), { can: [] });
  assert.equal(todayUpdateRow({ ...ready, state: 'current', candidate: null }), undefined);
  assert.equal(todayUpdateRow(null), undefined);
  assert.equal(shared['TD-01.update'], 'Update ready. Your data is saved first.');
  for (const why of ['not-signed', 'older', 'withdrawn', 'older-than-vault', 'owner-only', 'failed'] as const) {
    const key = updateSentence(ready, { phase: 'refused', why })!.key;
    assert.ok(words.en[key] && words.hi[key], key);
  }
});

test('release refusal codes become reasons in words, and reach the screen through the lane line', () => {
  const code = (value: string) => ({ code: value });
  assert.equal(updateRefusal(code('UPDATE_FEED_SIGNATURE_INVALID')), 'not-signed');
  assert.equal(updateRefusal(code('INVALID_RELEASE_SIGNATURE')), 'not-signed');
  assert.equal(updateRefusal(code('RELEASE_DOWNGRADE_REFUSED')), 'older');
  assert.equal(updateRefusal(code('UPDATE_WITHDRAWN')), 'withdrawn');
  assert.equal(updateRefusal(code('VAULT_NEWER_THAN_APP')), 'older-than-vault');
  assert.equal(updateRefusal(code('NATIVE_INSTALLER_REQUIRED')), 'manual');
  assert.equal(updateRefusal(code('FORBIDDEN')), 'owner-only');
  assert.equal(updateRefusal(code('REQUEST_FAILED')), 'failed');
  assert.equal(updateRefusal(new Error('no code')), 'failed');
  for (const value of [...TODAYX_R4_REFUSALS, 'NATIVE_INSTALLER_REQUIRED', 'VAULT_NEWER_THAN_APP']) assert.ok(laneRefusalCodes.includes(value), value);
});

test('route states: every state has words in both languages, and only the declared extras ride beside the probe', () => {
  for (const state of ROUTE_STATES) if (state !== 'skipped-by-send') assert.ok(words.en[`SH-09.${state}`] && words.hi[`SH-09.${state}`], state);
  for (const key of ['SH-09.skipped-by-send', 'SH-09.skipped-by-send.plain']) assert.ok(words.en[key] && words.hi[key], key);
  const probe = { routeId: 'r1', state: 'signed-out', checkedAt: '2026-09-30T06:00:00.000Z' };
  assert.equal(isRouteStateProbe(probe), true, 'The core-gateway-auth shape alone.');
  assert.equal(isRouteStateProbe({ ...probe, state: 'skipped-by-send', send: { route: 'samples', yours: 'shape' }, resumesAt: null }), true);
  assert.equal(isRouteStateProbe({ ...probe, state: 'retrying' }), false);
  assert.equal(isRouteStateProbe({ ...probe, token: 'secret' }), false);
  assert.equal(isRouteStateProbe({ ...probe, send: { route: 'everything', yours: 'shape' } }), false);
  assert.equal(isRouteStateProbe({ ...probe, resumesAt: 'soon' }), false);
});

test('the fake engine serves the round 4 frame methods from fixtures, and refuses Send', async () => {
  assert.equal((await createFakeEngine().request('todayx.updates', {}) as UpdatesReply).state, 'current', 'No candidate unless a preview asks for one.');
  const engine = createFakeEngine({ updateReady: true });
  const updates = await engine.request('todayx.updates', {});
  assert.equal(isUpdatesReply(updates), true);
  assert.equal((updates as UpdatesReply).state, 'ready');
  await assert.rejects(engine.request('todayx.updates.apply', { confirmed: true }), (e: any) => e.code === 'UPDATE_NOT_STAGED');
  assert.equal(isUpdateStepReply(await engine.request('todayx.updates.stage', { confirmed: true })), true);
  assert.equal(isUpdateStepReply(await engine.request('todayx.updates.apply', { confirmed: true })), true);
  assert.equal((await engine.request('todayx.updates', {}) as UpdatesReply).state, 'restart');
  assert.equal(isRouteStateProbe(await engine.request('models.probe', { routeId: 'route_local_demo' })), true, 'The shared fixture fits SH-09 too.');
  await assert.rejects(engine.request('todayx.faultReport.send', {}), (e: any) => e.code === 'FAULT_REPORT_SEND_UNAVAILABLE');
  const viewer = createFakeEngine({ scenario: 'read-only', updateReady: true });
  assert.equal((await viewer.request('todayx.updates', {}) as UpdatesReply).canUpdate, false);
  await assert.rejects(viewer.request('todayx.updates.stage', { confirmed: true }), (e: any) => e.code === 'FORBIDDEN');
});

test('the shell port saves only the fault report text and asks the crash question only on the desktop', async () => {
  const saved: unknown[][] = [];
  const desktop: DesktopShellBridge = { saveText: async (kind, text) => { saved.push([kind, text]); return 'saved'; }, crashState: async () => 'crashed', crashAnswer: async () => 'answered' };
  const port = createShellPort(desktop, null);
  assert.equal(await port.saveText!('fault-report', 'app 1.0.0'), 'saved');
  assert.equal(await port.saveText!('receipt' as never, 'x'), 'refused');
  assert.equal(await port.saveText!('fault-report', ''), 'refused');
  assert.equal(await port.saveText!('fault-report', 'x'.repeat(70_000)), 'refused');
  assert.deepEqual(saved, [['fault-report', 'app 1.0.0']]);
  assert.equal(await port.crashState!(), 'crashed');
  assert.equal(await createShellPort({}, null).crashState!(), 'clean', 'An older preload never claims a crash.');
  assert.equal(await createShellPort({ saveText: async () => '/etc/passwd' }, null).saveText!('fault-report', 'x'), 'refused');
});
