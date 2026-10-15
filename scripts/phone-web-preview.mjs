import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
// Every browser module is deliberately named. No request is ever interpreted as
// a filesystem path, and no workspace files, secrets, or engine API are exposed.
const routes = new Map([
  ['/', ['app/companion/web/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['app/companion/web/index.html', 'text/html; charset=utf-8']],
  ['/app/companion/web/styles.css', ['app/companion/web/styles.css', 'text/css; charset=utf-8']],
  ['/app/companion/web/app.mjs', ['app/companion/web/app.mjs', 'application/javascript; charset=utf-8']],
  ['/app/companion/web/phone-page.mjs', ['app/companion/web/phone-page.mjs', 'application/javascript; charset=utf-8']],
  ...['view-contracts', 'controller', 'preview', 'web-runtime', 'adapters', 'phone-page'].map(name => [`/app/companion/shared/${name}.ts`, [`app/companion/shared/${name}.ts`, 'application/javascript; charset=utf-8']]),
  ...['client', 'contracts', 'cache'].map(name => [`/platform/runtime/phone/${name}.ts`, [`platform/runtime/phone/${name}.ts`, 'application/javascript; charset=utf-8']]),
]);
const headers = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const experimentMeta = '<meta name="chausar-experiment" content="phone-page">';
/**
 * Static, loopback-only developer preview. Does not start the desktop engine.
 * `phonePage: true` switches on the experimental PH-04 page (off by default).
 */
export function createPhoneWebPreviewServer(options = {}) {
  const phonePage = options.phonePage === true;
  return createServer(async (request, response) => {
    const reply = (status, text) => { response.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); response.end(text); };
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); reply(405, 'Method not allowed.'); return; }
    // Use the exact request target before URL normalization. Encoded or relative
    // paths and query strings have no preview purpose and are never accepted.
    const target = request.url || '';
    if (!target.startsWith('/') || /[?%\\\x00-\x20]/.test(target) || target.split('/').some(segment => segment === '..' || segment === '.')) { reply(400, 'Invalid preview route.'); return; }
    const route = routes.get(target);
    if (!route) { reply(404, 'Preview route not found.'); return; }
    try {
      let body = await readFile(new URL(route[0], root), 'utf8');
      if (route[0].endsWith('.ts')) body = stripTypeScriptTypes(body, { mode: 'strip', sourceUrl: route[0] });
      if (phonePage && route[0].endsWith('index.html')) body = body.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n    ${experimentMeta}`);
      response.writeHead(200, { ...headers, 'Content-Type': route[1] }); response.end(body);
    } catch { reply(404, 'Preview asset unavailable.'); }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/phone-web-preview.mjs [--port 4368] [--phone-page]\nStarts a temporary synthetic companion preview on http://127.0.0.1. Stop with Ctrl+C.\n--phone-page also shows the experimental phone page (PH-04), which is off by default.'); return;
  }
  const phonePage = args.includes('--phone-page'); const rest = args.filter(arg => arg !== '--phone-page');
  if (args.filter(arg => arg === '--phone-page').length > 1 || (rest.length && (rest.length !== 2 || rest[0] !== '--port' || !/^\d{1,5}$/.test(rest[1])))) { console.error('Use --help for preview options.'); process.exitCode = 1; return; }
  const port = rest.length ? Number(rest[1]) : 4368;
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('Preview port must be between 0 and 65535.'); process.exitCode = 1; return; }
  const server = createPhoneWebPreviewServer({ phonePage });
  server.once('error', () => { console.error('The loopback preview could not start. Choose a free port.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    console.log(`Synthetic phone companion preview: http://127.0.0.1:${address.port}\nLive pairing is not connected.${phonePage ? ' Experimental phone page is on.' : ''} Stop with Ctrl+C.`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
