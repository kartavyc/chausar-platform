import { expect, it } from 'vitest';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as viteServer } from 'vite';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

it('engine mode forwards only same-origin loopback API calls and preserves authorization', async () => {
  const calls: { host?: string; origin?: string; authorization?: string }[] = [];
  const upstream = httpServer((req, res) => {
    calls.push({ host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => { upstream.once('error', reject); upstream.listen(4317, '127.0.0.1', resolve); });
  let vite: Awaited<ReturnType<typeof viteServer>> | undefined;
  try {
    vite = await viteServer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), mode: 'engine', logLevel: 'silent' });
    expect(vite.config.server.host).toBe('127.0.0.1');
    expect(Object.keys(vite.config.server.proxy ?? {}).sort()).toEqual(['/api/events', '/api/health', '/api/rpc', '/api/session']);
    await vite.listen();
    const address = vite.httpServer!.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer sample-browser-session', 'Content-Type': 'application/json' }, body: '{}' });
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', authorization: 'Bearer sample-browser-session' }]);
    // Fetch owns its Host header; a raw HTTP client proves the actual invalid-host request on the wire.
    const post = (path: string, headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${origin}${path}`, { method: 'POST', headers }, response => { response.resume(); resolve(response.statusCode!); });
      request.on('error', reject); request.end('{}');
    });
    const foreign: Record<string, string>[] = [{ Origin: 'https://outside.invalid' }, { Host: 'outside.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of foreign) {
      expect(await post('/api/rpc', headers), JSON.stringify(headers)).toBe(403);
      expect(calls).toHaveLength(1);
    }
    expect(await post('/api/rpc/extra', { Origin: 'https://outside.invalid' })).toBe(403);
    expect(calls).toHaveLength(1);
  } finally {
    await vite?.close();
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
