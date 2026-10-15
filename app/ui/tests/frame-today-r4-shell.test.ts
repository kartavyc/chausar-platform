import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFakeEngine, FAKE_PASSPHRASE, FAKE_SECOND_FOLDER, FAKE_SECOND_PASSPHRASE } from '../src/bridge/fake.ts';
import { FAKE_JOIN_CODE, FAKE_PIN, FAKE_PIN_TRIES, R4_METHODS, R4_PRE_VAULT } from '../src/bridge/fixtures/r4.ts';
import {
  contextTimeZone, isJoinRequests, isJoinState, isLadderReply, isPinStatus, isRouteProbe, isTimeZone, isTimeZoneReply, joinPhaseAt, R4_REFUSALS,
  readIntakeStatus, readLocalModels, readSharingConsent, readSharingPreview,
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

test('the local model list matches models-ext’s published shape exactly', () => {
  const ready = readLocalModels({ reachable: true, endpoint: 'http://127.0.0.1:11434', models: [{ name: 'llama3:8b', sizeBytes: 4_661_224_676, modifiedAt: '2026-09-01T10:00:00Z', family: 'llama' }] });
  assert.deepEqual(ready, { reachable: true, endpoint: 'http://127.0.0.1:11434', models: [{ name: 'llama3:8b', sizeBytes: 4_661_224_676, modifiedAt: '2026-09-01T10:00:00Z', family: 'llama' }] });
  assert.deepEqual(readLocalModels({ reachable: false, words: 'Ollama did not answer.' }), { reachable: false }, 'its words are data and are not kept');
  assert.equal(readLocalModels({ reachable: true, endpoint: 'x', models: [{ name: '; rm -rf' }] }), null);
  assert.equal(readLocalModels({ reachable: true, models: [] }), null);
  assert.equal(readLocalModels({ models: [] }), null);
});

test('joins, and the sharing replies from learning-ext, are checked', () => {
  const join = { joinId: 'join_1', code: '4821-9930', expiresAt: '2026-10-15T10:15:00.000Z', state: 'waiting' };
  assert.ok(isJoinState(join));
  assert.ok(!isJoinState({ ...join, code: '48219930' }));
  assert.ok(!isJoinState({ ...join, state: 'pending' }));
  assert.ok(isJoinRequests({ requests: [join] }));
  assert.equal(joinPhaseAt(join as never, Date.parse('2026-10-15T10:14:59Z')), 'waiting');
  assert.equal(joinPhaseAt(join as never, Date.parse('2026-10-15T10:15:00Z')), 'expired', 'fifteen minutes and it is expired, whatever the reply said');
  assert.equal(joinPhaseAt({ ...join, state: 'used' } as never, 0), 'used');
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

  assert.equal(await codeOf(engine.request('workspace.setTimeZone', { timeZone: 'Nowhere/Here' })), 'TIME_ZONE_INVALID');
  await engine.request('workspace.setTimeZone', { timeZone: 'Europe/London' });
  assert.equal(((await engine.request('ui.context', {})) as { timeZone: string }).timeZone, 'Europe/London');

  const started = await engine.request('devices.join', {}) as { joinId: string; code: string };
  assert.ok(isJoinState(started)); assert.equal(started.code, FAKE_JOIN_CODE);
  assert.deepEqual(((await engine.request('seats.inviteVerify', {})) as { requests: { joinId: string }[] }).requests.map(item => item.joinId), [started.joinId]);
  assert.equal(await codeOf(engine.request('seats.inviteVerify', { joinId: started.joinId, code: '0000-0000' })), 'JOIN_CODE_MISMATCH');
  assert.equal((await engine.request('seats.inviteVerify', { joinId: started.joinId, code: FAKE_JOIN_CODE }) as { state: string }).state, 'approved');
  assert.equal(await codeOf(engine.request('seats.inviteVerify', { joinId: started.joinId, code: FAKE_JOIN_CODE })), 'JOIN_USED');
  assert.equal((await engine.request('devices.join', { joinId: started.joinId }) as { state: string }).state, 'approved');

  const viewer = createFakeEngine({ scenario: 'read-only' });
  assert.equal(await codeOf(viewer.request('workspace.setTimeZone', { timeZone: 'UTC' })), 'FORBIDDEN');
});

test('the owners’ pre-vault methods answer while locked; nothing else does', async () => {
  const engine = createFakeEngine({ scenario: 'locked' });
  for (const method of R4_PRE_VAULT) assert.notEqual(await codeOf(engine.request(method, method === 'workspace.pin.unlock' ? { folder: 'main', pin: FAKE_PIN } : {})), 'VAULT_LOCKED', method);
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
