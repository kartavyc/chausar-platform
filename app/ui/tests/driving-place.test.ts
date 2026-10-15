import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { laneSubPlaces } from '../src/places/subplaces/index.ts';
import { laneWords } from '../src/text/lanes/index.ts';
import {
  SCREEN_DRIVING_SUB, DRIVING_ADDRESS, handlesScreenDriving, checkDriver, checkStatus, checkPlans, checkHistory, checkExports, codeOf, isNotBuilt,
} from '../src/screens/driving/contract.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Work, Screen driving is the driving lane sub-place, named in both languages', () => {
  assert.deepEqual(laneSubPlaces['driving'], [{ place: 'work', id: 'screen-driving' }]);
  const { en, hi } = laneWords['driving']!;
  assert.equal(en['SH-01.sub.work.screen-driving'], 'Screen driving');
  assert.equal(hi['SH-01.sub.work.screen-driving'], 'स्क्रीन चलाना');
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.ok(key === 'SH-01.sub.work.screen-driving' || key.startsWith('driving.x.'), `${key} is in the lane's own prefix`);
    assert.ok(en[key]!.trim() && hi[key]!.trim(), `${key} has words in both languages`);
    assert.doesNotMatch(en[key]! + hi[key]!, /[—!]/, `${key} has no em dash or exclamation mark`);
  }
});

test('every key the screen reads is in the words file', () => {
  const screen = source('../src/screens/driving/ScreenDriving.tsx');
  const { en } = laneWords['driving']!;
  const shared = JSON.parse(source('../src/text/en.json')) as Record<string, string>;
  const literal = [...screen.matchAll(/t\('([^'$]+)'/g)].map(m => m[1]!);
  const keyed = [...screen.matchAll(/emptyKey="([^"]+)"/g)].map(m => m[1]!);
  for (const key of [...literal, ...keyed]) assert.ok(key in en || key in shared, `${key} exists`);
  for (const state of ['idle', 'driving', 'sign-in', 'paused-by-you', 'stopped-by-key', 'stopped', 'step-failed', 'done']) assert.ok(en[`driving.x.state.${state}`]);
  for (const step of ['done', 'running', 'failed']) assert.ok(en[`driving.x.step.${step}`]);
  for (const platform of ['x11', 'windows-uia', 'macos-ax', 'fake']) assert.ok(en[`driving.x.platform.${platform}`]);
});

test('the module draws only its own address and is registered', () => {
  assert.equal(SCREEN_DRIVING_SUB, 'screen-driving');
  assert.equal(handlesScreenDriving({ place: 'work', sub: 'screen-driving' }), true);
  assert.equal(handlesScreenDriving({ place: 'work', sub: 'screen-driving', sheet: 'x' }), true);
  assert.equal(handlesScreenDriving({ place: 'work', sub: 'driving' }), false);
  assert.equal(handlesScreenDriving({ place: 'work' }), false);
  assert.equal(handlesScreenDriving({ place: 'tools', sub: 'screen-driving' }), false);
  assert.deepEqual(DRIVING_ADDRESS, { place: 'work', sub: 'driving' });
  assert.match(source('../src/places/lane-driving.tsx'), /handles: handlesScreenDriving/);
  assert.match(source('../src/places/registry.ts'), /\.\.\.drivingPlaces/);
});

const driver = { platform: 'x11', available: true, code: null, reason: null, stopKey: 'Ctrl+Alt+Pause', rules: { windows: 1, mode: 'read-export', typesSecrets: false } };
const step = { at: '2026-10-14T10:00:00Z', text: 'Opened the day book', state: 'done' };
const status = { state: 'driving', window: { id: 'w1', title: 'Tally Prime' }, steps: [step], reason: null, sessionId: 's1', plan: 'tally-daybook', startedAt: '2026-10-14T10:00:00Z', exports: [] };
const plans = { plans: [{ id: 'tally-daybook', title: 'Day book', app: 'Tally Prime', groups: ['vouchers'], produces: 'A day book file', status: 'experimental', steps: ['Open Display', 'Export'] }] };
const past = (id: string, startedAt: string) => ({ id, window: { title: 'Tally', app: 'Tally Prime' }, plan: 'tally-daybook', startedAt, endedAt: null, state: 'done', reason: null, steps: [step], exports: [{ id: 'e1', name: 'daybook.xml', bytes: 1200 }] });
const exportsReply = { exports: [{ id: 'e1', sessionId: 's1', name: 'daybook.xml', mediaType: 'application/xml', bytes: 1200, at: '2026-10-14T10:05:00Z', sha256: 'a'.repeat(64) }] };

test('replies of the right shape are kept; history comes newest first', () => {
  assert.ok(checkDriver(driver));
  assert.ok(checkDriver({ ...driver, platform: null, available: false, code: 'NO_DISPLAY', reason: 'No display is open.' }));
  assert.ok(checkStatus(status));
  assert.ok(checkStatus({ ...status, state: 'idle', window: null, steps: [], sessionId: null, plan: null, startedAt: null }));
  assert.ok(checkPlans(plans));
  const history = checkHistory({ sessions: [past('a', '2026-10-01T10:00:00Z'), past('b', '2026-10-10T10:00:00Z')] });
  assert.deepEqual(history?.sessions.map(h => h.id), ['b', 'a']);
  assert.ok(checkExports(exportsReply));
  assert.ok(checkExports({ exports: [] }));
  // Fields the engine adds beside the contract: the stop key on the status, `verified` on a plan; an untitled window.
  assert.ok(checkStatus({ ...status, stopKey: 'Ctrl Alt Pause', window: { id: '0x3a00007', title: '' } }));
  assert.ok(checkPlans({ plans: [{ ...plans.plans[0], verified: false }] }));
});

test('button words stay within 22 characters in both languages', () => {
  const { en, hi } = laneWords['driving']!;
  for (const key of ['driving.x.goDriving', 'driving.x.stop', 'driving.x.discard']) {
    for (const words of [en, hi]) assert.ok([...words[key]!].length <= 22, `${key}: ${words[key]}`);
  }
});

test('malformed replies are refused whole', () => {
  const bad: Array<[string, unknown]> = [
    ['driver null', null],
    ['driver array', []],
    ['driver extra field', { ...driver, extra: 1 }],
    ['driver missing field', { platform: 'x11', available: true, code: null, reason: null, rules: driver.rules }],
    ['driver unknown platform', { ...driver, platform: 'wayland' }],
    ['driver two windows', { ...driver, rules: { ...driver.rules, windows: 2 } }],
    ['driver types secrets', { ...driver, rules: { ...driver.rules, typesSecrets: true } }],
    ['driver write mode', { ...driver, rules: { ...driver.rules, mode: 'write' } }],
    ['driver available as a string', { ...driver, available: 'yes' }],
    ['driver unavailable without a reason', { ...driver, available: false, platform: null }],
    ['driver available without a platform', { ...driver, platform: null }],
    ['driver lower-case code', { ...driver, available: false, code: 'no display', reason: 'x' }],
  ];
  for (const [name, reply] of bad) assert.equal(checkDriver(reply), null, name);
  assert.equal(checkStatus({ ...status, state: 'flying' }), null);
  assert.equal(checkStatus({ ...status, extra: true }), null);
  assert.equal(checkStatus({ ...status, stopKey: 5 }), null);
  assert.equal(checkPlans({ plans: [{ ...plans.plans[0], verified: 'yes' }] }), null);
  assert.equal(checkStatus({ ...status, steps: [{ ...step, at: 'yesterday' }] }), null);
  assert.equal(checkStatus({ ...status, steps: [{ ...step, state: 'skipped' }] }), null);
  assert.equal(checkStatus({ ...status, window: { id: 'w1' } }), null);
  assert.equal(checkStatus({ ...status, exports: [{ id: 'e1', name: 'x', bytes: -1 }] }), null);
  assert.equal(checkStatus({ ...status, exports: [{ id: 'e1', name: 'x', bytes: 1.5 }] }), null);
  assert.equal(checkPlans({ plans: [{ ...plans.plans[0], status: 'supported' }] }), null);
  assert.equal(checkPlans({ plans: [{ ...plans.plans[0], steps: 'Open' }] }), null);
  assert.equal(checkPlans({ plans: {} }), null);
  assert.equal(checkHistory({ sessions: [{ ...past('a', '2026-10-01T10:00:00Z'), startedAt: null }] }), null);
  assert.equal(checkHistory({ sessions: [{ ...past('a', '2026-10-01T10:00:00Z'), window: { title: 'Tally' } }] }), null);
  assert.equal(checkHistory({}), null);
  assert.equal(checkExports({ exports: [{ ...exportsReply.exports[0], sha256: 'xyz' }] }), null);
  assert.equal(checkExports({ exports: [{ ...exportsReply.exports[0], mediaType: '<b>' }] }), null);
  assert.equal(checkExports({ exports: [{ ...exportsReply.exports[0], name: '' }] }), null);
  assert.equal(checkExports({ exports: [{ ...exportsReply.exports[0], id: '../etc' }] }), null);
});

test('refusals: not built yet for the three codes, a short code otherwise, never the raw message', () => {
  const refuse = (code: unknown) => Object.assign(new Error('raw words from somewhere'), { code });
  for (const code of ['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']) assert.equal(isNotBuilt(refuse(code)), true);
  assert.equal(isNotBuilt(refuse('DRIVER_UNAVAILABLE')), false);
  assert.equal(codeOf(refuse('SESSION_NOT_RUNNING')), 'SESSION_NOT_RUNNING');
  assert.equal(codeOf(refuse('not a code')), 'REQUEST_FAILED');
  assert.equal(codeOf(new Error('x')), 'REQUEST_FAILED');
});
