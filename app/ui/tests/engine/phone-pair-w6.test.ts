import { describe, expect, it, vi } from 'vitest';
import { createEngineClient } from '../../src/engine/client';
import type { EngineError } from '../../src/engine/types';

// Wave 6 package 6F7 (D35): a phone opens the pairing link http://<computer>:<port>/#pair=<one-time code>. The client
// takes the code out of the address at once, trades it once at /api/phone/pair for a phone session, keeps that session
// in memory only (as the desktop pairing token is kept), and then talks to /api/rpc as any paired browser does.
const CODE = 'p'.repeat(43);
const SESSION = 's'.repeat(43);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('phone pairing link', () => {
  it('trades the one-time code once, then sends requests with the phone session', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/phone/pair' ? json(200, { token: SESSION, expiresAt: '2026-11-01T22:00:00.000Z' }) : json(200, { result: { agents: [] } }));
    const replaceUrl = vi.fn();
    const client = createEngineClient({ fetch, location: { hash: `#pair=${CODE}`, pathname: '/', search: '' }, replaceUrl });
    expect(replaceUrl).toHaveBeenCalledWith('/#/today');
    expect(client.status()).toEqual({ state: 'ok' });
    await client.request('venture.team.list', {});
    await client.request('venture.team.list', {});
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(['/api/phone/pair', '/api/rpc', '/api/rpc']);
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ code: CODE });
    expect((calls[1]![1].headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION}`);
  });

  it('requests that start together wait for the one trade', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/phone/pair' ? json(200, { token: SESSION, expiresAt: '2026-11-01T22:00:00.000Z' }) : json(200, { result: {} }));
    const client = createEngineClient({ fetch, location: { hash: `#pair=${CODE}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    await Promise.all([client.request('venture.get', {}), client.request('venture.team.list', {}), client.request('venture.queue.list', { scope: 'all' })]);
    const urls = (fetch.mock.calls as unknown as [string][]).map(([url]) => url);
    expect(urls.filter((url) => url === '/api/phone/pair')).toHaveLength(1);
    expect(urls.filter((url) => url === '/api/rpc')).toHaveLength(3);
  });

  it('a used or expired code says so in the engine words and asks for a new link', async () => {
    const fetch = vi.fn(async () => json(403, { error: { code: 'PAIRING_FORBIDDEN', message: 'This pairing link was used, expired or is wrong. Make a new one in the Chausar app.' } }));
    const client = createEngineClient({ fetch, location: { hash: `#pair=${CODE}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    const error = await client.request('venture.get', {}).catch((e: unknown) => e) as EngineError;
    expect(error.code).toBe('PAIRING_FORBIDDEN');
    expect(error.message).toMatch(/Make a new one/);
    expect(client.status()).toEqual({ state: 'unpaired' });
    await client.request('venture.get', {}).catch(() => undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
