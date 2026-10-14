import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { FakeOidcProvider } from './fake-oidc-provider.ts';

// TEST ONLY. The in-process fake provider served over HTTPS as its own process, for the compose smoke run
// (enterprise/server/testing/compose-smoke.ts). `/authorize` approves at once as one synthetic person and
// redirects back with a one-time code. Never part of the server image.
//
// Environment: FAKE_OIDC_ISSUER (https://host:port as the server sees it), FAKE_OIDC_CERT, FAKE_OIDC_KEY,
// FAKE_OIDC_CLIENT_ID, FAKE_OIDC_CLIENT_SECRET_FILE, FAKE_OIDC_PORT, FAKE_OIDC_SUB, FAKE_OIDC_GROUPS (comma list).

const env = process.env;
const issuer = env.FAKE_OIDC_ISSUER ?? 'https://idp:9443';
const provider = new FakeOidcProvider(env.FAKE_OIDC_CLIENT_ID ?? 'chausar', readFileSync(env.FAKE_OIDC_CLIENT_SECRET_FILE ?? '/run/secrets/oidc_client_secret', 'utf8').trim());
provider.issuer = issuer;
const person = { sub: env.FAKE_OIDC_SUB ?? 'smoke-owner', groups: (env.FAKE_OIDC_GROUPS ?? 'chausar-owners').split(','), email: 'smoke-owner@example.com', email_verified: true, name: 'Synthetic smoke owner' };

const server = createServer({ cert: readFileSync(env.FAKE_OIDC_CERT ?? '/etc/fake-oidc/cert.pem'), key: readFileSync(env.FAKE_OIDC_KEY ?? '/etc/fake-oidc/key.pem') }, (req, res) => {
  const url = new URL(req.url ?? '/', issuer);
  if (url.pathname === '/authorize' && req.method === 'GET') {
    try {
      const { code, state } = provider.authorize(url.toString(), person);
      const back = new URL(url.searchParams.get('redirect_uri') ?? ''); back.searchParams.set('code', code); back.searchParams.set('state', state);
      res.writeHead(302, { location: back.toString() }); res.end();
    } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"invalid_request"}'); }
    return;
  }
  provider.server.emit('request', req, res);
});
server.listen(Number(env.FAKE_OIDC_PORT ?? 9443), '0.0.0.0', () => console.log(`Fake OIDC provider (test only) for ${issuer}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
