import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// The fake's venture.phone.access answers as the engine's does (platform/runtime/venture/notify/phone.ts over
// phone-access.ts; platform/tests/phone-access-close-w6.test.ts): the same fields in the same order, the same words,
// and a listener that is on only while an unused pairing link is in time, then off by itself.
const KEYS = ['on', 'addresses', 'phones', 'waiting', 'closesAt', 'link', 'expiresAt', 'line', 'qr'];
const OFF = 'Phone access is off. Make a pairing link to open Chausar on your phone.';
const WAITING = 'Phone access is on: a pairing link is waiting and no phone is paired. It turns off by itself when the link runs out.';
const T0 = '2026-11-16T14:53:00.000Z';
const plus = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

describe('the fake phone listener', () => {
  it('is off, then on while a link waits, then off by itself when the link runs out unused', async () => {
    let now = T0;
    const client = createFakeClient(new FakeEngine({ now: () => now }));
    const off = await client.request('venture.phone.access', {});
    expect(Object.keys(off)).toEqual(KEYS);
    expect(off).toEqual({ on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 0, closesAt: null, link: null, expiresAt: null, line: OFF, qr: null });

    const made = await client.request('venture.phone.access', { action: 'link', via: 'wifi' });
    expect(Object.keys(made)).toEqual(KEYS);
    expect([made.on, made.phones, made.waiting, made.closesAt, made.expiresAt, made.line]).toEqual([true, 0, 1, plus(10), plus(10), 'Open this link on your phone within 10 minutes. It works once.']);
    expect(made.link).toMatch(/^http:\/\/192\.168\.1\.20:\d+\/#pair=/);

    // Read again: the link is never shown twice, and the words say it is on and when it ends.
    now = plus(6);
    expect(await client.request('venture.phone.access', {})).toEqual({ on: true, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, waiting: 1, closesAt: plus(10), link: null, expiresAt: null, line: WAITING, qr: null });
    // A second link keeps it on until the later one runs out.
    const second = await client.request('venture.phone.access', { action: 'link' });
    expect([second.waiting, second.closesAt]).toEqual([2, plus(16)]);
    now = plus(10);
    expect((await client.request('venture.phone.access', {})).waiting).toBe(1);
    now = plus(16);
    expect(await client.request('venture.phone.access', {})).toEqual(off);
  });

  it('stop turns it off at once', async () => {
    const client = createFakeClient(new FakeEngine({ now: () => T0 }));
    await client.request('venture.phone.access', { action: 'link' });
    expect((await client.request('venture.phone.access', {})).on).toBe(true);
    const stopped = await client.request('venture.phone.access', { action: 'stop' });
    expect([stopped.on, stopped.waiting, stopped.closesAt, stopped.line]).toEqual([false, 0, null, OFF]);
    expect((await client.request('venture.phone.access', {})).on).toBe(false);
  });
});
