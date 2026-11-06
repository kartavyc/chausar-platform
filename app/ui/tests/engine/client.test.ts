import { describe, expect, it, vi } from 'vitest';
import { createEngineClient, type ChausarBridge } from '../../src/engine/client';
import { EngineError, type EngineStatus } from '../../src/engine/types';

const TOKEN = 'a'.repeat(64);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('desktop transport', () => {
  it('sends requests through the preload bridge and keeps the engine code on refusals', async () => {
    const bridge: ChausarBridge = {
      request: vi.fn(async (method: string) => {
        if (method === 'venture.team.gate') throw Object.assign(new Error('This step always asks you.'), { code: 'GATE_FLOOR' });
        return { rows: [], summary: 'Nothing needs you.', needsYou: 0, businesses: 1 };
      }),
    };
    const client = createEngineClient({ bridge });
    expect(client.transport).toBe('desktop');
    await expect(client.request('venture.queue.list', { scope: 'all' })).resolves.toMatchObject({ needsYou: 0 });
    expect(bridge.request).toHaveBeenCalledWith('venture.queue.list', { scope: 'all' });
    const refusal = await client.request('venture.team.gate', { agentId: 'a', stepId: 's', gate: 'auto' }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(EngineError);
    expect((refusal as EngineError).code).toBe('GATE_FLOOR');
    expect(client.status()).toEqual({ state: 'ok' });
  });

  it('follows the engine status pushed by the desktop host', () => {
    let push: ((s: { healthy: boolean; state: string }) => void) | undefined;
    const bridge: ChausarBridge = { request: vi.fn(), onEngineStatus: (cb) => { push = cb; return () => {}; } };
    const client = createEngineClient({ bridge });
    const seen: EngineStatus[] = [];
    client.onStatus((s) => seen.push(s));
    push!({ healthy: false, state: 'starting' });
    push!({ healthy: false, state: 'failed' });
    push!({ healthy: true, state: 'ready' });
    expect(seen).toEqual([{ state: 'starting' }, { state: 'offline' }, { state: 'ok' }]);
  });
});

describe('web transport', () => {
  it('takes the pairing token from the launch link, removes it from the address and posts to /api/rpc', async () => {
    const fetch = vi.fn(async () => json(200, { result: { agents: [] } }));
    const replaceUrl = vi.fn();
    const client = createEngineClient({ fetch, location: { hash: `#token=${TOKEN}`, pathname: '/', search: '' }, replaceUrl });
    expect(client.transport).toBe('web');
    expect(replaceUrl).toHaveBeenCalledWith('/#/today');
    await expect(client.request('venture.team.list', {})).resolves.toEqual({ agents: [] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rpc');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ method: 'venture.team.list', payload: {} });
  });

  it('without a token it asks for pairing and sends nothing', async () => {
    const fetch = vi.fn();
    const client = createEngineClient({ fetch, location: { hash: '#/today', pathname: '/', search: '' }, replaceUrl: vi.fn() });
    const error = await client.request('venture.get', {}).catch((e: unknown) => e);
    expect((error as EngineError).code).toBe('UNAUTHENTICATED');
    expect(fetch).not.toHaveBeenCalled();
    expect(client.status()).toEqual({ state: 'unpaired' });
  });

  it('a refused session ends it; a dropped connection is offline until the next answer', async () => {
    const replies: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(json(200, { result: null })),
      () => Promise.resolve(json(401, { error: { code: 'UNAUTHENTICATED', message: 'This workspace session expired or was revoked.' } })),
    ];
    const fetch = vi.fn(() => replies.shift()!());
    const client = createEngineClient({ fetch, location: { hash: `#token=${TOKEN}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    await expect(client.request('venture.get', {})).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(client.status()).toEqual({ state: 'offline' });
    await client.request('venture.get', {});
    expect(client.status()).toEqual({ state: 'ok' });
    await expect(client.request('venture.get', {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(client.status()).toEqual({ state: 'session-ended' });
  });

  it('an engine refusal stays with the request and leaves the status alone', async () => {
    const fetch = vi.fn(async () => json(400, { error: { code: 'GATE_FLOOR', message: 'This step always asks you.' } }));
    const client = createEngineClient({ fetch, location: { hash: `#token=${TOKEN}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    await expect(client.request('venture.team.gate', { agentId: 'a', stepId: 's', gate: 'auto' })).rejects.toMatchObject({ code: 'GATE_FLOOR', message: 'This step always asks you.' });
    expect(client.status()).toEqual({ state: 'ok' });
  });

  it('hosted pages get their bearer from the hosted session, never from the address', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return url === '/api/hosted/session' ? json(200, { token: 'b'.repeat(43) }) : json(200, { result: { agents: [] } });
    });
    const client = createEngineClient({ fetch, hosted: true, location: { hash: `#token=${TOKEN}`, pathname: '/app/', search: '' }, replaceUrl: vi.fn() });
    expect(client.transport).toBe('hosted');
    await client.request('venture.team.list', {});
    expect(calls).toEqual(['/api/hosted/session', '/api/rpc']);
    const init = (fetch.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'b'.repeat(43)}`);
  });

  it('W4 4J21: hosted pages read the server `me` with the session: the trials switch and the temporary business', async () => {
    const trial = { temporary: true, line: 'This business is temporary until you add your email.', expiresAt: '2026-11-02T10:00:00.000Z', endsSoon: false, warning: null };
    let calls = 0;
    const fetch = vi.fn(async (url: string) => {
      calls += 1;
      return url === '/api/hosted/session' ? json(200, { token: 'b'.repeat(43), me: { user: { id: 'u1' }, trials: true, trial, method: 'trial' } }) : json(200, { result: {} });
    });
    const client = createEngineClient({ fetch, hosted: true, location: { hash: '', pathname: '/app/', search: '' }, replaceUrl: vi.fn() });
    await expect(client.hostedMe!()).resolves.toEqual({ trials: true, trial });
    // Read again on each call, so a kept business stops being temporary on the page.
    await client.hostedMe!();
    expect(calls).toBe(2);
    // A session view with no `me`, or a broken one, is null; nothing is guessed.
    const bare = createEngineClient({ fetch: vi.fn(async () => json(200, { token: 'b'.repeat(43) })), hosted: true, location: { hash: '', pathname: '/app/', search: '' }, replaceUrl: vi.fn() });
    await expect(bare.hostedMe!()).resolves.toBeNull();
    const off = createEngineClient({ fetch: vi.fn(async () => json(200, { token: 'b'.repeat(43), me: { trials: false, trial: null } })), hosted: true, location: { hash: '', pathname: '/app/', search: '' }, replaceUrl: vi.fn() });
    await expect(off.hostedMe!()).resolves.toEqual({ trials: false, trial: null });
  });

  it('W4 4J21: only the hosted page has hostedMe', () => {
    expect(createEngineClient({ bridge: { request: vi.fn() } }).hostedMe).toBeUndefined();
    expect(createEngineClient({ fetch: vi.fn(), location: { hash: '', pathname: '/', search: '' }, replaceUrl: vi.fn() }).hostedMe).toBeUndefined();
  });
});
