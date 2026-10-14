import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isShellReply, type CapabilitiesReply, type ShellReply } from '../src/bridge/todayx-contract.ts';
import {
  BANNER_ORDER,
  bannersFor,
  demoClockState,
  firstRunBanners,
  foldBanners,
  lockScreenBanners,
  notBuiltFromCapabilities,
  orderBanners,
  shellBanners,
  startDate,
} from '../src/app/shell-banners.ts';
import { KEY_MAP, readGlobalKey } from '../src/app/keys.ts';

// Synthetic shell replies only; no engine, bridge or clock.
const every: ShellReply = {
  workspace: { demo: true },
  clock: { mode: 'demo', date: '2026-09-30' },
  banners: [
    { kind: 'driving', program: 'Tally' },
    { kind: 'demo-clock', date: '2026-09-30' },
    { kind: 'read-only', holder: 'Laptop 2' },
    { kind: 'sending-closed', restoredFrom: '2026-09-28', unchecked: '3' },
    { kind: 'jobs-paused' },
    { kind: 'update-needed', reason: 'expired', date: '2026-10-12' },
    { kind: 'no-connection' },
  ],
  autoLockMinutes: 10,
};

test('the synthetic reply is a valid todayx.shell reply', () => {
  assert.equal(isShellReply(every), true);
});

test('every banner kind maps in the fixed order with formatted dates and counts', () => {
  const items = shellBanners(every, 'en');
  assert.deepEqual(items.map((b) => b.kind), [...BANNER_ORDER]);
  assert.deepEqual(items[0]?.values, { program: 'Tally' });
  assert.deepEqual(items[1]?.values, { date: '30 Sep 2026' });
  assert.deepEqual(items[2]?.values, { holder: 'Laptop 2' });
  assert.deepEqual(items[3]?.values, { date: '28 Sep 2026', count: 2, display: '3' });
  assert.equal(items[4]?.values, undefined);
  assert.deepEqual(items[5]?.values, { date: '12 Oct 2026' });
  assert.equal(items.every((b) => b.action === undefined), true, 'no callback, no action');
});

test('Hindi dates come from the format module, not from the component', () => {
  const [, demo] = shellBanners(every, 'hi');
  assert.equal(typeof demo?.values?.['date'], 'string');
  assert.notEqual(demo?.values?.['date'], '2026-09-30');
});

test('an action is attached only for the banner whose callback the host supplied', () => {
  let pressed = '';
  const items = shellBanners(every, 'en', { dismissJobsPaused: () => { pressed = 'jobs'; }, openDemoClock: () => { pressed = 'clock'; } });
  const withAction = items.filter((b) => b.action !== undefined).map((b) => b.kind);
  assert.deepEqual(withAction, ['demo-clock', 'jobs-paused']);
  items.find((b) => b.kind === 'jobs-paused')?.action?.onPress();
  assert.equal(pressed, 'jobs');
  assert.equal(items.find((b) => b.kind === 'no-connection')?.action, undefined);
});

test('update needed: expired with and without a date, and a withdrawn release', () => {
  const one = (b: ShellReply['banners'][number]) => shellBanners({ ...every, banners: [b] }, 'en')[0];
  assert.equal(one({ kind: 'update-needed', reason: 'expired', date: null })?.textKey, 'SH-03.update-needed.undated');
  assert.equal(one({ kind: 'update-needed', reason: 'withdrawn', date: '2026-10-12' })?.textKey, 'SH-03.update-needed.withdrawn');
  assert.equal(one({ kind: 'update-needed', reason: 'expired', date: '2026-10-12' })?.textKey, undefined);
});

test('a real workspace never shows a demo clock banner', () => {
  const real = { ...every, workspace: { demo: false }, clock: { mode: 'real' as const } };
  assert.equal(shellBanners(real, 'en').some((b) => b.kind === 'demo-clock'), false);
});

test('ordering is fixed whatever order items arrive in, one per kind', () => {
  const shuffled = [{ kind: 'no-connection' as const }, { kind: 'driving' as const }, { kind: 'jobs-paused' as const }, { kind: 'driving' as const }];
  assert.deepEqual(orderBanners(shuffled).map((b) => b.kind), ['driving', 'jobs-paused', 'no-connection']);
});

test('at most two show; the rest fold', () => {
  const items = shellBanners(every, 'en');
  const { shown, folded } = foldBanners(items);
  assert.deepEqual(shown.map((b) => b.kind), ['driving', 'demo-clock']);
  assert.equal(folded.length, 5);
  assert.deepEqual(foldBanners(items.slice(0, 2)).folded, []);
});

test('first run shows only Update needed and Demo clock; the lock screen shows none', () => {
  const items = shellBanners(every, 'en');
  assert.deepEqual(firstRunBanners(items).map((b) => b.kind), ['demo-clock', 'update-needed']);
  assert.deepEqual(bannersFor('first-run', items).map((b) => b.kind), ['demo-clock', 'update-needed']);
  assert.deepEqual(bannersFor('lock', items), []);
  assert.deepEqual(lockScreenBanners(), []);
  assert.equal(bannersFor('frame', items).length, 7);
});

test('demo clock state: real, not set, set', () => {
  assert.deepEqual(demoClockState({ ...every, workspace: { demo: false }, clock: { mode: 'real' } }, 'en'), { kind: 'real' });
  assert.deepEqual(demoClockState({ ...every, clock: { mode: 'real' } }, 'en'), { kind: 'not-set' });
  assert.deepEqual(demoClockState(every, 'en'), { kind: 'set', date: '2026-09-30', display: '30 Sep 2026' });
});

test('a typed start date must be a real calendar date', () => {
  assert.equal(startDate('2026-09-30'), '2026-09-30');
  assert.equal(startDate(' 2026-09-30 '), '2026-09-30');
  for (const bad of ['', '2026-02-30', '30-09-2026', '2026-9-3', 'tomorrow']) assert.equal(startDate(bad), null, bad);
});

test('not built yet: day and missing part from a capabilities group', () => {
  const reply: CapabilitiesReply = { groups: [
    { group: 'approvals', state: 'missing', day: 7, methods: 'approvals.*' },
    { group: 'today', state: 'live', day: null, methods: 'todayx.*' },
    { group: 'voice', state: 'partial', day: null, methods: 'voice.*' },
  ] };
  assert.deepEqual(notBuiltFromCapabilities(reply, 'approvals'), {
    kind: 'not-built', part: 'approvals', capability: { state: 'missing', reasonCode: 'CAPABILITY_MISSING', expectedDay: 7 },
  });
  const voice = notBuiltFromCapabilities(reply, 'voice');
  assert.equal(voice?.kind, 'not-built');
  assert.equal(voice?.kind === 'not-built' && voice.capability !== undefined && 'expectedDay' in voice.capability, false);
  assert.equal(notBuiltFromCapabilities(reply, 'today'), null);
  assert.equal(notBuiltFromCapabilities(reply, 'nothing'), null);
});

test('KEY_MAP is the one keyboard list: every global intent the handler emits is listed in it', () => {
  const ids = new Set(KEY_MAP.map((k) => k.id));
  assert.equal(ids.size, KEY_MAP.length, 'no duplicates');
  for (const id of ['ask', 'place', 'rows', 'open', 'close', 'adjacent', 'primary', 'talk', 'stop-driving', 'region', 'help'] as const) assert.ok(ids.has(id), id);
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) => readGlobalKey({ key, code: key === ' ' ? 'Space' : '', type: 'keydown', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, keyCode: 0, ...extra } as KeyboardEvent);
  const kindToId: Record<string, string> = { ask: 'ask', place: 'place', escape: 'close', adjacent: 'adjacent', primary: 'primary', talk: 'talk', region: 'region', help: 'help' };
  const seen = [press('k', { ctrlKey: true }), press('3', { ctrlKey: true }), press('Escape'), press('ArrowDown', { altKey: true }), press('Enter', { ctrlKey: true }), press(' ', { ctrlKey: true }), press('F6'), press('/', { ctrlKey: true })];
  for (const k of seen) {
    assert.ok(k, 'chord recognised');
    const id = kindToId[k.kind];
    assert.ok(id !== undefined && ids.has(id as never), k.kind);
    assert.ok(KEY_MAP.find((e) => e.id === id)?.match, `${k.kind} is matched from the map`);
  }
});

test('every new shell text key exists in both catalogues, with no em dash or exclamation mark', () => {
  const en = JSON.parse(readFileSync(new URL('../src/text/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  const hi = JSON.parse(readFileSync(new URL('../src/text/hi.json', import.meta.url), 'utf8')) as Record<string, string>;
  const keys = [
    ...KEY_MAP.map((k) => k.textKey),
    'SH-02.recovery', 'SH-03.more', 'SH-03.fewer', 'SH-03.label', 'SH-03.jobs-paused.action', 'SH-03.demo-clock.action',
    'SH-03.update-needed.undated', 'SH-03.update-needed.withdrawn', 'SH-03.clock.real', 'SH-03.clock.day', 'SH-03.clock.week',
    'SH-10.title', 'SH-10.open', 'SH-10.cancel', 'SH-11.header', 'SH-11.send', 'SH-11.dontSend', 'SH-11.save', 'SH-12.title', 'SH-13.part',
  ];
  for (const k of keys) {
    for (const cat of [en, hi]) {
      assert.equal(typeof cat[k], 'string', k);
      assert.doesNotMatch(cat[k] ?? '', /[—!]/u, k);
    }
  }
  for (const button of ['SH-03.clock.day', 'SH-03.clock.week', 'SH-03.clock.set', 'SH-10.open', 'SH-10.cancel', 'SH-11.send', 'SH-11.dontSend', 'SH-11.save', 'SH-03.jobs-paused.action', 'SH-03.demo-clock.action']) {
    for (const cat of [en, hi]) assert.ok([...(cat[button] ?? '')].length <= 22, button);
  }
  assert.equal(en['SH-11.header'], 'No names, amounts, file names, cell values or questions are in this report.');
  assert.equal(en['SH-03.clock.real'], 'This workspace is real. The demo clock is not available.');
});
