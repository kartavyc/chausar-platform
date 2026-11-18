// Found on the real Windows app, 16 November 2026: a pairing link nobody used left the phone listener open on the home
// network for as long as Chausar ran, and the page had stopped offering "Stop phone access". The listener now closes by
// itself: when the last unused pairing link runs out with no phone paired, and when the last paired phone's time ends.
// No real socket is opened here (phone-wifi-w6.test.ts, which does, hangs on macOS): the server and the engine are
// stand-ins, and the clock and the timer are the test's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Engine } from '../runtime/engine.ts';
import type { PhoneListener } from '../runtime/server.ts';
import { createPhoneAccess, PHONE_SWEEP_MS } from '../runtime/phone-access.ts';
import { phoneAccessHandler } from '../runtime/venture/notify/phone.ts';
import type { PhoneAccessPort, VentureDeps } from '../runtime/venture/contracts.ts';
import { code, owner, phone, setup } from './venture-views-env.ts';

const T0 = Date.parse('2026-11-16T14:53:00.000Z');
const MINUTE = 60_000, HOUR = 3_600_000;

function fixture() {
  let now = T0;
  const servers: { listening: boolean; stops: number; phone: PhoneListener }[] = [];
  const timers = new Map<number, { run: () => void; at: number }>();
  let nextTimer = 0;
  const issued: { ttlMs: number; sessionId: string }[] = [], revoked: string[] = [];
  const engine = {
    bootstrapContext: () => ({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }),
    async requestAs(_ctx: unknown, method: string, payload: { ttlMs?: number; sessionId?: string }) {
      if (method === 'auth.session') {
        const sessionId = `session-${issued.length + 1}`;
        issued.push({ ttlMs: payload.ttlMs!, sessionId });
        return { token: `${sessionId}-token`.padEnd(43, 'x'), sessionId, expiresAt: new Date(now + payload.ttlMs!).toISOString() };
      }
      if (method === 'auth.revoke') { revoked.push(payload.sessionId!); return {}; }
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as Engine;
  const access = createPhoneAccess(() => engine, {
    addresses: () => [{ via: 'wifi', address: '192.168.1.20' }],
    clock: () => now,
    serve: (_engine, options) => {
      const server = { listening: false, stops: 0, phone: options.phone };
      servers.push(server);
      return {
        async listen() { server.listening = true; return { origin: `http://0.0.0.0:${43117 + servers.length - 1}` }; },
        async stopListening() { server.listening = false; server.stops += 1; },
      };
    },
    timer: (run, ms) => { const id = nextTimer += 1; timers.set(id, { run, at: now + ms }); return () => { timers.delete(id); }; },
  });
  /** Moves the clock, running every timer that comes due on the way, in order. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
    }
    now = end;
  };
  const pairCode = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get('pair')!;
  return { access, servers, timers, issued, revoked, advance, pairCode, jump: (ms: number) => { now += ms; } };
}

test('a pairing link nobody used closes the listener when it runs out, by the timer alone', async () => {
  const { access, servers, timers, advance } = fixture();
  assert.deepEqual(access.status(), { on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 0, closesAt: null });
  const made = await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  assert.equal(made.expiresAt, new Date(T0 + 10 * MINUTE).toISOString());
  assert.equal(servers.length, 1);
  assert.equal(servers[0]!.listening, true);
  assert.deepEqual(access.status(), { on: true, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 1, closesAt: made.expiresAt });
  assert.equal(timers.size, 1, 'one timer waits for the link to run out');

  advance(9 * MINUTE + 59_000);
  assert.equal(servers[0]!.listening, true, 'still open one second before the link runs out');
  // Nobody reads the state: the timer alone closes it.
  advance(1000);
  assert.equal(servers[0]!.listening, false, 'the listener closed when the unused link ran out');
  assert.equal(servers[0]!.stops, 1);
  assert.equal(timers.size, 0, 'nothing is left waiting once it is closed');
  assert.deepEqual(access.status(), { on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 0, closesAt: null });
});

test('reading the state closes a listener whose link ran out while the timer slept (the computer was asleep)', async () => {
  const { access, servers, jump } = fixture();
  await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  // The clock moves with no timer firing, as after sleep.
  jump(45 * MINUTE);
  assert.equal(access.status().on, false, 'the state never says on for a listener nobody can pair with');
  assert.equal(servers[0]!.listening, false);
});

test('the timer never waits longer than its sweep, so a late clock is caught within a minute', async () => {
  const { access, timers } = fixture();
  await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  const waits = [...timers.values()].map(item => item.at - T0);
  assert.deepEqual(waits, [PHONE_SWEEP_MS]);
  assert.ok(PHONE_SWEEP_MS <= MINUTE);
});

test('a second link keeps the listener until the later one runs out', async () => {
  const { access, servers, advance } = fixture();
  await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  advance(6 * MINUTE);
  const second = await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  assert.equal(servers.length, 1, 'the same listener');
  assert.equal(access.status().waiting, 2);
  advance(5 * MINUTE);
  assert.deepEqual([access.status().on, access.status().waiting, access.status().closesAt], [true, 1, second.expiresAt]);
  advance(5 * MINUTE);
  assert.equal(servers[0]!.listening, false);
  assert.equal(access.status().on, false);
});

test('a paired phone keeps the listener for its own time and no longer', async () => {
  const { access, servers, issued, advance, pairCode } = fixture();
  const made = await access.link({ via: 'wifi', hours: 2, minutes: 10 });
  advance(3 * MINUTE);
  const paired = await servers[0]!.phone.pair(pairCode(made.link));
  assert.deepEqual(issued, [{ ttlMs: 2 * HOUR, sessionId: 'session-1' }]);
  assert.equal(paired.expiresAt, new Date(T0 + 3 * MINUTE + 2 * HOUR).toISOString());
  assert.deepEqual(access.status(), { on: true, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 1, waiting: 0, closesAt: paired.expiresAt });

  advance(30 * MINUTE);
  assert.equal(servers[0]!.listening, true, 'the link ran out long ago, but a phone is paired');
  assert.equal(servers[0]!.phone.accepts(paired.token), true);
  advance(90 * MINUTE);
  assert.equal(servers[0]!.listening, false, 'closed when the phone session ended');
  assert.equal(servers[0]!.phone.accepts(paired.token), false);
  assert.deepEqual(access.status(), { on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 0, closesAt: null });

  // A new link after that starts a fresh listener.
  await access.link({ via: 'wifi', hours: 1, minutes: 10 });
  assert.equal(servers.length, 2);
  assert.equal(servers[1]!.listening, true);
});

test('a phone pairing at the last moment is not cut off while its session is being made', async () => {
  const { access, servers, advance, pairCode } = fixture();
  const made = await access.link({ via: 'wifi', hours: 1, minutes: 10 });
  advance(9 * MINUTE + 59_000);
  const pairing = servers[0]!.phone.pair(pairCode(made.link));
  // The code is used and no session exists yet: the state is read in that gap.
  assert.equal(access.status().on, true);
  await pairing;
  advance(5 * MINUTE);
  assert.equal(servers[0]!.listening, true);
  assert.equal(access.status().phones, 1);
});

test('ten wrong codes end every open link, and with no phone paired the listener closes', async () => {
  const { access, servers } = fixture();
  await access.link({ via: 'wifi', hours: 1, minutes: 10 });
  for (let i = 0; i < 10; i += 1) await assert.rejects(servers[0]!.phone.pair('x'.repeat(43)), code('PAIRING_FORBIDDEN'));
  assert.equal(access.status().on, false);
  assert.equal(servers[0]!.listening, false);
});

test('stop closes the listener, ends every phone session and leaves no timer', async () => {
  const { access, servers, timers, revoked, pairCode } = fixture();
  const made = await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  await servers[0]!.phone.pair(pairCode(made.link));
  await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  await access.stop();
  assert.equal(servers[0]!.listening, false);
  assert.deepEqual(revoked, ['session-1']);
  assert.equal(timers.size, 0);
  assert.deepEqual(access.status(), { on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 0, closesAt: null });
});

type PortState = { on: boolean; phones: number; waiting: number; closesAt: string | null };
function fakePort(state: PortState): PhoneAccessPort & { links: unknown[]; stopped: number; state: PortState } {
  const port = {
    links: [] as unknown[], stopped: 0, state,
    status: () => ({ ...port.state, addresses: [{ via: 'wifi' as const, address: '192.168.1.20' }] }),
    link: async (input: unknown) => { port.links.push(input); port.state = { on: true, phones: port.state.phones, waiting: port.state.waiting + 1, closesAt: '2026-10-15T10:10:00.000Z' }; return { link: 'http://192.168.1.20:43117/#pair=' + 'a'.repeat(43), expiresAt: '2026-10-15T10:10:00.000Z' }; },
    stop: async () => { port.stopped += 1; port.state = { on: false, phones: 0, waiting: 0, closesAt: null }; },
  };
  return port;
}

test('venture.phone.access says what the listener is doing: off, a link waiting, a phone paired, and when it closes by itself', async () => {
  const env = await setup();
  const port = fakePort({ on: false, phones: 0, waiting: 0, closesAt: null });
  const deps: VentureDeps = { ...env.deps, host: 'desktop', phoneAccess: port };
  const call = (payload: unknown, ctx = owner) => phoneAccessHandler(deps, ctx, payload);
  await assert.rejects(call({ action: 'link' }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.deepEqual(await call({}), {
    on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 0, closesAt: null, link: null, expiresAt: null,
    line: 'Phone access is off. Make a pairing link to open Chausar on your phone.', qr: null,
  });
  const made = await call({ action: 'link' });
  assert.deepEqual(port.links, [{ via: 'wifi', hours: 12, minutes: 10 }]);
  assert.equal(made.line, 'Open this link on your phone within 10 minutes. It works once.');
  assert.deepEqual([made.on, made.waiting, made.closesAt, made.expiresAt], [true, 1, '2026-10-15T10:10:00.000Z', '2026-10-15T10:10:00.000Z']);
  assert.match(made.link!, /#pair=/);
  assert.ok(made.qr && made.qr.rows.length === made.qr.size && made.qr.size >= 21, 'the link as a QR code for the phone camera');

  // Read again (the page opened later): the link itself is never shown twice, but the page still says it is on.
  const later = await call({});
  assert.deepEqual([later.on, later.link, later.qr, later.waiting, later.closesAt], [true, null, null, 1, '2026-10-15T10:10:00.000Z']);
  assert.equal(later.line, 'Phone access is on: a pairing link is waiting and no phone is paired. It turns off by itself when the link runs out.');

  port.state = { on: true, phones: 1, waiting: 0, closesAt: '2026-10-15T22:03:00.000Z' };
  assert.equal((await call({})).line, 'Phone access is on. 1 phone is paired. It turns off by itself when the pairing ends. Some approvals still need this computer.');
  port.state = { on: true, phones: 2, waiting: 1, closesAt: '2026-10-15T22:03:00.000Z' };
  assert.equal((await call({})).line, 'Phone access is on. 2 phones are paired. It turns off by itself when the pairing ends. Some approvals still need this computer.');

  const stopped = await call({ action: 'stop' });
  assert.equal(port.stopped, 1);
  assert.deepEqual([stopped.on, stopped.waiting, stopped.closesAt, stopped.line], [false, 0, null, 'Phone access is off. Make a pairing link to open Chausar on your phone.']);
});
