import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFakeEngine, FAKE_PASSPHRASE, FAKE_SECOND_FOLDER, FAKE_SECOND_PASSPHRASE } from '../src/bridge/fake.ts';
import { FAKE_JOIN_BACKUP, FAKE_JOIN_CODE, FAKE_PIN, FAKE_PIN_TRIES, FAKE_SHARED_FOLDER, R4_METHODS, R4_PRE_VAULT } from '../src/bridge/fixtures/r4.ts';
import {
  contextTimeZone, isLadderReply, isPinStatus, isRouteProbe, isTimeZone, isTimeZoneReply, joinPhaseAt, R4_REFUSALS,
  readIntakeStatus, readJoinAnswer, readJoinRequests, readJoinState, readLocalModels, readSharingConsent, readSharingPreview,
} from '../src/bridge/r4-contracts.ts';
import { notBuilt } from '../src/bridge/todayx-contract.ts';
import { canSwitch, menuWorkspaces, switchWorkspace } from '../src/host/workspace-switch.ts';
import { initialJourney, reduceJourney, stepOf } from '../src/screens/first-run/journey.ts';
import { words } from '../src/text/lanes/frame-today.ts';

const codeOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return (error as { code?: unknown }).code; } };
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, string>;

test('round 4 refusals are on the frame-today line, so they reach the screen over the desktop bridge', () => {
  const preload = readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8');
  const line = preload.split('\n').find(text => text.includes('/* frame-today */')) ?? '';
  for (const code of R4_REFUSALS) assert.ok(line.includes(`'${code}'`), code);
});

test('PIN, ladder, probe and time zone replies are checked before anything is drawn', () => {
  assert.ok(isPinStatus({ set: true, passphraseOnly: false }));
  assert.ok(isPinStatus({ set: false, passphraseOnly: false, folder: 'main' }));
  assert.ok(!isPinStatus({ set: true, passphraseOnly: false, tries: 2 }), 'no count of tries is ever accepted');
  assert.ok(!isPinStatus({ set: 'yes', passphraseOnly: false }));
  assert.ok(isLadderReply({ routeIds: ['route_a', 'route_b'] }));
  assert.ok(!isLadderReply({ routeIds: ['route_a', 'route_a'] }));
  assert.ok(!isLadderReply({ routeIds: ['../x'] }));
  assert.ok(isRouteProbe({ routeId: 'route_a', state: 'signed-out', checkedAt: '2026-10-15T10:00:00.000Z' }));
  assert.ok(!isRouteProbe({ routeId: 'route_a', state: 'fine', checkedAt: '2026-10-15T10:00:00.000Z' }));
  assert.ok(isTimeZone('Asia/Kolkata') && isTimeZone('UTC'));
  assert.ok(!isTimeZone('Mars/Olympus') && !isTimeZone('../etc') && !isTimeZone(''));
  assert.ok(isTimeZoneReply({ timeZone: 'Europe/London' }) && !isTimeZoneReply({ timeZone: 'Europe/London', extra: 1 }));
  assert.deepEqual(contextTimeZone({ workspace: {}, timeZone: null }), { timeZone: null });
  assert.deepEqual(contextTimeZone({ workspace: {}, timeZone: 'Asia/Kolkata' }), { timeZone: 'Asia/Kolkata' });
  assert.equal(contextTimeZone({ timeZone: 'Nowhere/Here' }), null);
});

test('the local model list matches models-ext’s registered shape exactly', () => {
  const ready = readLocalModels({ endpoint: 'http://127.0.0.1:11434', reachable: true, models: [{ name: 'llama3:8b', sizeBytes: 4_661_224_676, modifiedAt: '2026-09-01T10:00:00.000Z', family: 'llama' }], skipped: 1 });
  assert.deepEqual(ready, { reachable: true, endpoint: 'http://127.0.0.1:11434', models: [{ name: 'llama3:8b', sizeBytes: 4_661_224_676, modifiedAt: '2026-09-01T10:00:00.000Z', family: 'llama' }] });
  assert.deepEqual(readLocalModels({ endpoint: 'http://127.0.0.1:11434', reachable: false, models: [], words: 'Ollama did not answer.' }), { reachable: false }, 'its words are data and are not kept');
  assert.deepEqual(readLocalModels({ reachable: false, words: 'Ollama did not answer.' }), { reachable: false });
  assert.equal(readLocalModels({ reachable: false, models: [{ name: 'x' }] }), null, 'an unreachable service lists nothing');
  assert.equal(readLocalModels({ reachable: true, endpoint: 'x', models: [], skipped: -1 }), null);
  assert.equal(readLocalModels({ reachable: true, endpoint: 'x', models: [{ name: '; rm -rf' }] }), null);
  assert.equal(readLocalModels({ reachable: true, models: [] }), null);
  assert.equal(readLocalModels({ models: [] }), null);
});

test('joins (core-sync-jobs’ real shapes), and the sharing replies from learning-ext, are checked', () => {
  const requestId = 'join_0123abcd-0000-4000-8000-000000000001';
  const join = { state: 'waiting', requestId, code: '482199', expiresAt: '2026-10-15T10:15:00.000Z' };
  const read = readJoinState(join)!;
  assert.deepEqual(read, join);
  assert.equal(readJoinState({ ...join, code: '4821-9930' }), null);
  assert.equal(readJoinState({ ...join, requestId: 'join_1' }), null);
  assert.equal(readJoinState({ ...join, state: 'pending' }), null);
  assert.deepEqual(readJoinState({ state: 'ready', backupFile: 'joined-1760500000000.backup', revision: 4, next: 'restore-then-restart' }), { state: 'ready', backupFile: 'joined-1760500000000.backup', revision: 4 });
  assert.equal(readJoinState({ state: 'ready', backupFile: '../x.backup', revision: 4, next: 'restore-then-restart' }), null, 'a path is never accepted');
  for (const state of ['refused', 'expired', 'cancelled']) assert.deepEqual(readJoinState({ state }), { state });
  assert.equal(readJoinState({ state: 'approved', folder: 'main' }), null, 'the old guessed shape is refused');
  const listed = { requestId, name: 'Laptop', code: '482199', expiresAt: '2026-10-15T10:15:00.000Z', fingerprint: '0123456789abcdef' };
  assert.deepEqual(readJoinRequests({ requests: [listed] }), [listed]);
  assert.equal(readJoinRequests({ requests: [{ ...listed, name: '<b>x</b>' }] }), null);
  assert.deepEqual(readJoinAnswer({ approved: true, requestId, deviceId: 'device_abc', revision: 7 }, requestId), { approved: true, revision: 7 });
  assert.deepEqual(readJoinAnswer({ refused: true, requestId }, requestId), { refused: true });
  assert.equal(readJoinAnswer({ refused: true, requestId }, 'join_0123abcd-0000-4000-8000-000000000002'), null, 'an answer for another request is not used');
  assert.equal(joinPhaseAt(read, Date.parse('2026-10-15T10:14:59Z')), 'waiting');
  assert.equal(joinPhaseAt(read, Date.parse('2026-10-15T10:15:00Z')), 'expired', 'fifteen minutes and it is expired, whatever the reply said');
  assert.equal(joinPhaseAt({ state: 'refused' }, 0), 'refused');
  assert.deepEqual(readIntakeStatus({ open: false, mode: 'closed', sharingSwitch: false, label: 'x', boxes: [] }), { open: false, mode: 'closed', sharingSwitch: false });
  assert.equal(readIntakeStatus({ open: true, mode: 'closed', sharingSwitch: false }), null);
  const digest = 'a'.repeat(64);
  assert.ok(readSharingPreview({ id: 'sharepreview_1', digest, bytes: '{"schema":"chausar.learning.v1"}', size: 33, count: 1, blocked: [] }));
  assert.equal(readSharingPreview({ id: 'sharepreview_1', digest: 'zz', bytes: '', size: 0, count: 0, blocked: [] }), null);
  assert.deepEqual(readSharingConsent({ id: 'shareconsent_1', digest, integrity: 'x' }), { id: 'shareconsent_1', digest });
});

test('the fake engine serves every round 4 method, and leaves out any named absent', async () => {
  const engine = createFakeEngine();
  for (const method of R4_METHODS) assert.ok(engine.methods().includes(method), method);
  const absent = createFakeEngine({ absent: ['models.setLadder', 'workspace.pin.status'] });
  assert.ok(notBuilt(await engine.request('x.y').catch(error => error)));
  const refused = await absent.request('models.setLadder', { routeIds: [] }).catch(error => error);
  assert.equal(refused.code, 'UNKNOWN_METHOD'); assert.ok(notBuilt(refused));
  assert.equal(absent.methods().includes('workspace.pin.status'), false);
});

test('PIN: set with the passphrase, a wrong PIN says so with no count, too many tries leaves only the passphrase', async () => {
  const engine = createFakeEngine({ twoWorkspaces: true });
  assert.deepEqual(await engine.request('workspace.pin.status', {}), { set: false, passphraseOnly: false });
  assert.equal(await codeOf(engine.request('workspace.pin.set', { pin: '12', passphrase: FAKE_PASSPHRASE })), 'PIN_INVALID');
  assert.equal(await codeOf(engine.request('workspace.pin.set', { pin: FAKE_PIN, passphrase: 'wrong' })), 'UNLOCK_FAILED');
  assert.deepEqual(await engine.request('workspace.pin.set', { pin: FAKE_PIN, passphrase: FAKE_PASSPHRASE }), { set: true, passphraseOnly: false });
  await engine.request('workspace.lock', {});
  // Before the vault: the status for a folder, and the PIN for that folder only.
  assert.deepEqual(await engine.request('workspace.pin.status', { folder: 'main' }), { set: true, passphraseOnly: false });
  assert.deepEqual(await engine.request('workspace.pin.status', { folder: FAKE_SECOND_FOLDER }), { set: false, passphraseOnly: false });
  assert.equal(await codeOf(engine.request('workspace.pin.unlock', { folder: FAKE_SECOND_FOLDER, pin: FAKE_PIN })), 'PIN_NOT_SET');
  for (let attempt = 1; attempt < FAKE_PIN_TRIES; attempt++) assert.equal(await codeOf(engine.request('workspace.pin.unlock', { folder: 'main', pin: '000000' })), 'PIN_WRONG');
  assert.equal(await codeOf(engine.request('workspace.pin.unlock', { folder: 'main', pin: '000000' })), 'PIN_LOCKED_OUT');
  assert.equal(await codeOf(engine.request('workspace.pin.unlock', { folder: 'main', pin: FAKE_PIN })), 'PIN_LOCKED_OUT', 'even the right PIN waits for the passphrase');
  assert.deepEqual(await engine.request('workspace.pin.status', { folder: 'main' }), { set: true, passphraseOnly: true });
  await engine.request('workspace.open', { folder: 'main', passphrase: FAKE_PASSPHRASE });
  assert.equal(((await engine.request('ui.context', {})) as { workspace: { name: string } }).workspace.name, 'Demo shop');
});

test('each workspace has its own passphrase; a PIN opens only its own folder', async () => {
  const engine = createFakeEngine({ scenario: 'locked', pins: [FAKE_SECOND_FOLDER] });
  assert.equal(await codeOf(engine.request('workspace.open', { folder: FAKE_SECOND_FOLDER, passphrase: FAKE_PASSPHRASE })), 'UNLOCK_FAILED');
  assert.equal(await codeOf(engine.request('workspace.open', { folder: 'main', passphrase: FAKE_SECOND_PASSPHRASE })), 'UNLOCK_FAILED');
  await engine.request('workspace.pin.unlock', { folder: FAKE_SECOND_FOLDER, pin: FAKE_PIN });
  const context = await engine.request('ui.context', {}) as { workspace: { name: string; demo: boolean } };
  assert.equal(context.workspace.name, 'Second Demo shop');
  assert.equal(await codeOf(engine.request('workspace.pin.unlock', { folder: FAKE_SECOND_FOLDER, pin: FAKE_PIN })), 'VAULT_OPEN');
});

test('the ladder reorders the routes, the time zone reaches ui.context, and a join is approved only with its code', async () => {
  const routes = ['a', 'b', 'c'].map(name => ({ id: `route_${name}`, kind: 'ollama', model: `m-${name}`, enabled: true, installationVerified: false, label: `Route ${name}` }));
  const engine = createFakeEngine({ routes });
  assert.equal(await codeOf(engine.request('models.setLadder', { routeIds: ['route_a'] })), 'LADDER_INVALID');
  assert.equal(await codeOf(engine.request('models.setLadder', { routeIds: ['route_a', 'route_b', 'route_x'] })), 'ROUTE_NOT_FOUND');
  assert.deepEqual(await engine.request('models.setLadder', { routeIds: ['route_c', 'route_a', 'route_b'] }), { routeIds: ['route_c', 'route_a', 'route_b'] });
  assert.deepEqual(((await engine.request('models.list', {})) as { id: string }[]).map(route => route.id), ['route_c', 'route_a', 'route_b']);
  assert.ok(isRouteProbe(await engine.request('models.probe', { routeId: 'route_a' })));

  assert.equal(await codeOf(engine.request('workspace.setTimeZone', { timeZone: 'Nowhere/Here' })), 'INVALID_TIME_ZONE');
  await engine.request('workspace.setTimeZone', { timeZone: 'Europe/London' });
  assert.equal(((await engine.request('ui.context', {})) as { timeZone: string }).timeZone, 'Europe/London');

  // Joining, in core-sync-jobs' steps and refusal codes.
  assert.equal(await codeOf(engine.request('devices.join', { step: 'finish' })), 'DEVICE_JOIN_NOT_STARTED');
  assert.equal(await codeOf(engine.request('devices.join', { step: 'request', folder: 'relative/path' })), 'INVALID_DEVICE_REQUEST');
  assert.equal(await codeOf(engine.request('devices.join', { step: 'request', folder: '/elsewhere' })), 'DEVICE_FOLDER_NOT_SET_UP');
  const started = readJoinState(await engine.request('devices.join', { step: 'request', folder: FAKE_SHARED_FOLDER, deviceName: 'Laptop' }));
  assert.ok(started?.state === 'waiting'); assert.equal(started.code, FAKE_JOIN_CODE);
  const listed = readJoinRequests(await engine.request('seats.inviteVerify', {}));
  assert.deepEqual(listed?.map(item => [item.requestId, item.name]), [[started.requestId, 'Laptop']]);
  assert.equal(await codeOf(engine.request('seats.inviteVerify', { requestId: started.requestId, code: '000000', approve: true })), 'DEVICE_JOIN_CODE_MISMATCH');
  assert.deepEqual(readJoinAnswer(await engine.request('seats.inviteVerify', { requestId: started.requestId, code: FAKE_JOIN_CODE, approve: true }), started.requestId), { approved: true, revision: 3 });
  assert.equal(await codeOf(engine.request('seats.inviteVerify', { requestId: started.requestId, code: FAKE_JOIN_CODE, approve: true })), 'DEVICE_JOIN_USED');
  assert.deepEqual(readJoinState(await engine.request('devices.join', { step: 'finish' })), { state: 'ready', backupFile: FAKE_JOIN_BACKUP, revision: 3 });
  assert.equal(await codeOf(engine.request('devices.join', { step: 'finish' })), 'DEVICE_JOIN_NOT_STARTED', 'a finished join is used once');
  // Refused on the computer already in: the new computer reads "refused".
  const second = readJoinState(await engine.request('devices.join', { step: 'request', folder: FAKE_SHARED_FOLDER }));
  assert.ok(second?.state === 'waiting');
  assert.deepEqual(readJoinAnswer(await engine.request('seats.inviteVerify', { requestId: second.requestId, approve: false }), second.requestId), { refused: true });
  assert.deepEqual(readJoinState(await engine.request('devices.join', { step: 'finish' })), { state: 'refused' });

  const viewer = createFakeEngine({ scenario: 'read-only' });
  assert.equal(await codeOf(viewer.request('workspace.setTimeZone', { timeZone: 'UTC' })), 'FORBIDDEN');
});

test('the owners’ pre-vault methods answer while locked; nothing else does', async () => {
  const engine = createFakeEngine({ scenario: 'locked' });
  const payloads: Record<string, Record<string, unknown>> = { 'workspace.pin.unlock': { folder: 'main', pin: FAKE_PIN }, 'devices.join': { step: 'cancel' } };
  for (const method of R4_PRE_VAULT) assert.notEqual(await codeOf(engine.request(method, payloads[method] ?? {})), 'VAULT_LOCKED', method);
  assert.equal(await codeOf(engine.request('models.setLadder', { routeIds: [] })), 'VAULT_LOCKED');
});

test('switching: only seats that can lock the engine switch; the same folder is no switch; the menu marks only what is known', () => {
  assert.ok(canSwitch('owner') && canSwitch('cofounder'));
  assert.ok(!canSwitch('accountant') && !canSwitch('viewer') && !canSwitch(undefined));
  const locks: string[] = [];
  const chosen: string[] = [];
  const host = { lock: async () => { locks.push('lock'); } };
  assert.equal(switchWorkspace(host, 'main', 'main', folder => chosen.push(folder)), false);
  assert.equal(switchWorkspace(host, '../x', 'main', folder => chosen.push(folder)), false);
  assert.equal(switchWorkspace(host, 'second-shop', 'main', folder => chosen.push(folder)), true);
  assert.deepEqual(chosen, ['second-shop'], 'the chosen folder is set before the lock, so its lock screen is the very next screen');
  assert.deepEqual(locks, ['lock']);
  assert.deepEqual(menuWorkspaces(['main', 'second-shop'], { folder: 'main', name: 'Demo shop' }, new Map([['main', true]])),
    [{ id: 'main', name: 'Demo shop', demo: true }, { id: 'second-shop', name: 'second-shop' }]);
  assert.deepEqual(menuWorkspaces(['main'], { folder: null, name: 'Demo shop' }, new Map()), [{ id: 'main', name: 'main' }], 'an unknown open folder lends its name to none');
});

test('the journey reaches FR-14 only from Welcome before any vault', () => {
  let state = initialJourney(0);
  state = reduceJourney(state, { type: 'open-join' });
  assert.equal(state.screen, 'join'); assert.equal(stepOf('join'), 'you');
  assert.equal(reduceJourney(state, { type: 'close-join' }).screen, 'welcome');
  const opened = reduceJourney(reduceJourney(initialJourney(0), { type: 'resume' }), { type: 'back' });
  assert.equal(reduceJourney(opened, { type: 'open-join' }), opened);
});

test('the lane words are complete in Hindi, collide with no first-run key, and keep the writing rules', () => {
  const local = { en: json('../src/screens/first-run/text/en.json'), hi: json('../src/screens/first-run/text/hi.json') };
  assert.deepEqual(Object.keys(words.hi).sort(), Object.keys(words.en).sort());
  for (const language of ['en', 'hi'] as const) {
    for (const [key, value] of Object.entries(words[language])) {
      assert.equal(key in local.en, false, `${key} would be shadowed in first run`);
      assert.equal(/[—!]/u.test(value), false, `${language} ${key}`);
      if (key.endsWith('.btn')) assert.ok([...value].length <= 22, `${language} ${key} is ${[...value].length} long`);
    }
  }
  assert.equal(words.en['FR-10.others'], "Your books also hold other people's details. Those never leave this computer.");
  assert.equal(words.en['FR-10.closed'], 'Sharing is not open yet. Nothing is sent.');
  assert.equal(words.en['FR-10.demoTest'], 'Demo test: sends to a test inbox only');
});
