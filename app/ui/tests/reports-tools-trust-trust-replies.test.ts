import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, intakeStatus, logPage, oneBatch, preview } from '../src/screens/trust/adapters/learning.ts';
import { validateHosted, validateMarkingChange, validatePending, validateService, validateVault } from '../src/screens/trust/validate.ts';
import { KEEP, codeWord } from '../src/screens/trust/words.ts';

const AT = '2026-10-14T09:00:00Z';
const VAULT = {
  backups: [], lock: { idleMinutes: null, deviceCheck: false }, disk: null, limit: 'A sentence.',
  recoveryContact: { name: null, experimental: true }, version: null,
};

test('a vault with no idle time and no version is read, as missing', () => {
  const v = validateVault(VAULT);
  assert.equal(v.lock.idleMinutes, null);
  assert.equal(v.version, null);
  assert.throws(() => validateVault({ ...VAULT, lock: { idleMinutes: -1, deviceCheck: false } }));
});

test('the hosted plan may say paid or ended (read from hosted.status); anything else is refused', () => {
  const hosted = { blind: 'b', notBlind: 'n', keeps: 'k', jobs: [], plan: 'ended' };
  assert.equal(validateHosted(hosted).ended, true);
  assert.equal(validateHosted({ ...hosted, plan: 'planned-not-available' }).ended, false);
  assert.deepEqual([validateHosted({ ...hosted, plan: 'paid' }).paid, validateHosted({ ...hosted, plan: 'paid' }).ended], [true, false]);
  assert.throws(() => validateHosted({ ...hosted, plan: 'free' }));
  assert.throws(() => validateHosted({ ...hosted, plan: 'gold' }));
});

test('a marking change is the markings or a change that waits; a pending change may name a rule this screen does not list', () => {
  const change = { id: 'c1', what: 'see', summary: 's', by: 'm', at: AT, needs: 'owner' };
  const waiting = validateMarkingChange({ state: 'waiting-for-second', change });
  assert.ok('state' in waiting && waiting.state === 'waiting-for-second');
  assert.equal(validatePending({ items: [change] })[0]!.what, 'see');
  assert.throws(() => validateMarkingChange({ state: 'done' }));
});

test('the background service status', () => {
  assert.deepEqual(validateService({ platform: 'linux', mechanism: 'linux-systemd-user', installed: true, running: null, unitPath: '/x' }), { installed: true, running: null });
  assert.throws(() => validateService({ platform: 'linux', mechanism: 'm', installed: 'yes', running: false }));
});

test('learning-ext replies are checked before a screen reads them', () => {
  const st = intakeStatus({ open: false, mode: 'closed', sharingSwitch: false, label: 'x', boxes: [{ box: 'setup-shapes', open: true }, { box: 'account-words', open: false, reason: 'r', shown: false }] });
  assert.deepEqual(st.boxes.map((b) => b.shown), [true, false]);
  assert.throws(() => intakeStatus({ open: true, mode: 'closed', sharingSwitch: false, label: 'x', boxes: [] }));
  const p = preview({ id: 'p1', digest: 'd', size: 3, count: 1, bytes: 'abc', names: 0, amounts: 0, blocked: [{ line: 2, code: 'PAN' }], publicName: null });
  assert.equal(p.blocked[0]!.code, 'PAN');
  const b = { id: 'b1', at: AT, mode: 'intake', status: 'unknown', size: 1, count: 1, digest: 'd' };
  assert.equal(oneBatch(b).bytes, null);
  assert.throws(() => oneBatch({ ...b, status: 'lost' }));
  assert.equal(batches({ items: [b], shared: { events: 1, names: 0, amounts: 0 }, credits: { publicName: null, latest: 3 } }).credits.latest, 3);
  assert.equal(logPage({ items: [{ id: 'd1', at: AT, event: { kind: 'mapping', choice: 'accepted' } }], total: 1 }).items[0]!.reason, null);
});

test('an engine code reads in catalogue words, and an unknown one as the engine wrote it', () => {
  assert.equal(codeWord(KEEP.hi, 'kind', 'facts'), KEEP.hi['kind.facts']);
  assert.equal(codeWord(KEEP.hi, 'kind', 'brand-new'), 'brand-new');
  assert.equal(codeWord(KEEP.en, 'kind', 'toString'), 'toString');
});
