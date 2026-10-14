// A loopback static server for the built preview. Read-only, no directory listing, no network beyond 127.0.0.1.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export function serveStatic(root, { port = 0 } = {}) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
      if (file !== base && !file.startsWith(base + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      done({ url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`, close: () => new Promise(closed => server.close(() => closed())) });
    });
  });
}
