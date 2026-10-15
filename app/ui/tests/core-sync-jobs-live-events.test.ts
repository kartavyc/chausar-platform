import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveEvents, desktopWake, liveEventsReply } from '../src/places/live-events.ts';
import type { LiveEvent, PlaceRpc } from '../src/places/types.ts';

const settle = () => new Promise(accept => setTimeout(accept, 0));
const refusal = (code: string) => Object.assign(new Error('Synthetic refusal.'), { code });
const ev = (id: string, type: string, kinds: string[]) => ({ id, at: '2026-10-15T10:00:00.000Z', type, kinds });

/** A scripted engine: each `events.subscribe` takes the next reply (or refusal) and records its payload. */
function engine(replies: unknown[]) {
  const asked: Record<string, unknown>[] = [];
  const rpc: PlaceRpc = { request: async (method, payload) => {
    assert.equal(method, 'events.subscribe'); asked.push(payload);
    const next = replies.shift(); if (next instanceof Error) throw next; return next ?? { cursor: 'quiet', events: [], more: false };
  } };
  return { rpc, asked };
}
function wakeSource() {
  const listeners = new Set<() => void>();
  return { wake: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, fire: () => { for (const l of listeners) l(); }, get count() { return listeners.size; } };
}

test('starts at the head, then dispatches each event to the subscribers whose kinds meet it', async () => {
  const { rpc, asked } = engine([{ cursor: 'head', events: [], more: false },
    { cursor: 'c2', events: [ev('e1', 'action.prepared', ['activity', 'actions', 'approvals']), ev('e2', 'import.done', ['activity', 'sources', 'books'])], more: false }]);
  const source = wakeSource(), live = createLiveEvents(rpc, source.wake);
  const books: LiveEvent[] = [], work: LiveEvent[] = [];
  const offBooks = live.subscribe(['books'], event => books.push(event));
  live.subscribe(['approvals', 'jobs'], event => work.push(event));
  live.subscribe(['trust'], () => { throw new Error('a broken screen never stops the others'); });
  await settle();
  assert.deepEqual(asked, [{}]); assert.equal(source.count, 1);
  source.fire(); await settle();
  assert.deepEqual(asked, [{}, { after: 'head' }]);
  assert.deepEqual(books.map(e => e.id), ['e2']); assert.deepEqual(work.map(e => e.id), ['e1']);
  assert.equal(Object.isFrozen(books[0]), true);
  offBooks(); source.fire(); await settle();
  assert.deepEqual(asked.at(-1), { after: 'c2' });
  live.dispose(); assert.equal(source.count, 0);
  source.fire(); await settle(); assert.equal(asked.length, 3);
});

test('one request at a time, a truncated reply is followed, and an invalid reply is dropped whole', async () => {
  let release!: () => void;
  const gate = new Promise<void>(accept => { release = accept; });
  const asked: unknown[] = [];
  const queue: unknown[] = [{ cursor: 'head', events: [], more: false },
    { cursor: 'p1', events: [ev('e1', 'job.step', ['activity', 'jobs', 'approvals'])], more: true },
    { cursor: 'p2', events: [ev('e2', 'job.step', ['activity', 'jobs', 'approvals'])], more: false },
    { cursor: 'bad', events: [ev('e3', 'job.step', ['activity', 'jobs']), { ...ev('e4', 'job.step', ['activity']), values: { amount: '1' } }], more: false },
    { cursor: 'p3', events: [ev('e5', 'Job Step', ['activity'])], more: false },
    { cursor: 'p3', events: [], more: false }];
  const rpc: PlaceRpc = { request: async (_method, payload) => { asked.push(payload); if (asked.length === 2) await gate; return queue.shift(); } };
  const source = wakeSource(), live = createLiveEvents(rpc, source.wake), heard: string[] = [];
  live.subscribe(['jobs'], event => heard.push(event.id));
  await settle(); source.fire(); source.fire(); source.fire(); await settle();
  assert.equal(asked.length, 2, 'wakes during a request wait for it');
  release(); await settle(); await settle(); await settle();
  assert.deepEqual(heard, ['e1', 'e2']);
  assert.deepEqual(asked, [{}, { after: 'head' }, { after: 'p1' }, { after: 'p2' }], 'the waiting wake runs once more after the follow-up; its reply has an unknown field and is dropped whole');
  source.fire(); await settle();
  assert.deepEqual(heard, ['e1', 'e2'], 'a reply with an unsafe type code is dropped whole');
  assert.deepEqual(asked.at(-1), { after: 'p2' });
  source.fire(); await settle();
  assert.deepEqual(asked.at(-1), { after: 'p2' }, 'the cursor did not move past a dropped reply');
  assert.equal(liveEventsReply({ cursor: 'x', events: [], more: false, extra: 1 }), null);
  assert.equal(liveEventsReply({ cursor: 'not base64!', events: [], more: false }), null);
  assert.equal(liveEventsReply({ cursor: 'x', events: [ev('e', 'a.b', ['books'])], more: false }), null, 'every event is activity');
  live.dispose();
});

test('an engine without the method stops quietly; a lock or a stale cursor starts again from the head', async () => {
  for (const code of ['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']) {
    const { rpc, asked } = engine([refusal(code)]);
    const source = wakeSource(), live = createLiveEvents(rpc, source.wake);
    live.subscribe(['activity'], () => assert.fail('nothing to hear'));
    await settle(); source.fire(); source.fire(); await settle();
    assert.equal(asked.length, 1, code); assert.equal(source.count, 0);
  }
  for (const code of ['VAULT_LOCKED', 'READ_INVALIDATED', 'INVALID_EVENTS_REQUEST']) {
    const { rpc, asked } = engine([{ cursor: 'head', events: [], more: false }, refusal(code), { cursor: 'head2', events: [], more: false }]);
    const source = wakeSource(), live = createLiveEvents(rpc, source.wake);
    live.subscribe(['activity'], () => {});
    await settle(); source.fire(); await settle(); source.fire(); await settle(); source.fire(); await settle();
    assert.deepEqual(asked, [{}, { after: 'head' }, {}, { after: 'head2' }], code);
    live.dispose();
  }
});

test('without a wake source it polls while the page is visible, and stops with its last subscriber', async () => {
  let hidden = true;
  const { rpc, asked } = engine([{ cursor: 'head', events: [], more: false }]);
  const live = createLiveEvents(rpc, undefined, { pollMs: 5, hidden: () => hidden });
  const off = live.subscribe(['activity'], () => {});
  await new Promise(accept => setTimeout(accept, 30));
  assert.deepEqual(asked, [{}], 'hidden: no polling');
  hidden = false; await new Promise(accept => setTimeout(accept, 30));
  assert.ok(asked.length >= 2); assert.deepEqual(asked[1], { after: 'head' });
  off(); const count = asked.length; await new Promise(accept => setTimeout(accept, 30));
  assert.equal(asked.length, count);
  assert.equal(live.subscribe([], () => {})(), undefined, 'no kinds, no subscription');
});

test('the desktop wake source reads only onEngineEvent from the preload', () => {
  const holder = globalThis as { window?: unknown };
  const saved = holder.window;
  try {
    holder.window = {}; assert.equal(desktopWake(), undefined);
    let callback: ((value: unknown) => void) | undefined; let removed = 0;
    holder.window = { chausar: { onEngineEvent: (cb: (value: unknown) => void) => { callback = cb; return () => { removed++; }; } } };
    const wake = desktopWake(); assert.ok(wake);
    let woke = 0; const off = wake!(() => { woke++; });
    callback!({ seq: 3 }); assert.equal(woke, 1); off(); assert.equal(removed, 1);
  } finally { holder.window = saved; }
});
