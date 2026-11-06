import type { Plugin, ProxyOptions, ServerOptions } from 'vite';

export const ENGINE_ORIGIN = 'http://127.0.0.1:4317';
export const UI_ORIGIN = 'http://127.0.0.1:5178';
const API = ['/api/rpc', '/api/events', '/api/session', '/api/health'];

/** Dev only. The browser must reach this exact local UI before any proxy rewrites its Origin. */
export function engineOriginGuard(): Plugin {
  return {
    name: 'chausar-engine-origin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split('?')[0]!;
        if (!API.includes(path)) { next(); return; }
        if (req.headers.host !== new URL(UI_ORIGIN).host || (req.headers.origin && req.headers.origin !== UI_ORIGIN) || req.headers['sec-fetch-site'] === 'cross-site') {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'INVALID_ORIGIN', message: 'Open the local sample UI at its own address.' } }));
          return;
        }
        next();
      });
    },
  };
}

export function engineDevServer(): ServerOptions {
  const proxy: Record<string, ProxyOptions> = {};
  for (const path of API) proxy[path] = { target: ENGINE_ORIGIN, changeOrigin: true, headers: { Origin: ENGINE_ORIGIN } };
  return { host: '127.0.0.1', port: 5178, strictPort: true, proxy };
}
