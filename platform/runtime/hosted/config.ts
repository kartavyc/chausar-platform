// Chausar hosted tier: reads the environment into a checked config. Hosted mode is off unless CHAUSAR_HOSTED=1 or the
// --hosted argument says otherwise.
// Anything this build can't do safely is refused with a plain reason instead of being half done: a plain-http origin
// outside development, a missing custody key, the Rivet runtime, a database off this computer, a real mail sender.
import { resolve } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import { loopbackPostgresUrl, type LoopbackPostgres } from '../postgres.ts';
import { parseMasterKey } from './custody.ts';
import { DEFAULT_LIMITS, type HostedLimits } from './limits.ts';
import type { RelyingParty } from './webauthn.ts';

export type HostedConfig = {
  dev: boolean;
  origin: string;
  rp: RelyingParty;
  listen: { host: string; port: number };
  dataDirectory: string;
  custody: { kind: 'env'; key: string } | { kind: 'dev-file' };
  tls: { kind: 'none' } | { kind: 'files'; cert: string; key: string } | { kind: 'proxy' };
  trustProxy: boolean;
  mailer: 'dev-outbox' | 'not-configured';
  replay: { model: string | null; github: string | null } | null;
  /** Both are experimental until a real deploy has been tested. */
  storage: 'experimental-file' | 'postgres';
  /** With storage 'postgres': a server on this computer's loopback. A managed database is reached through a local TLS proxy. */
  postgres: LoopbackPostgres | null;
  runtime: 'local';
  limits: HostedLimits;
};

const refuse = (message: string): never => { throw new ChausarError('HOSTED_CONFIG_INVALID', message); };

export function hostedConfig(env: NodeJS.ProcessEnv, args: readonly string[] = []): HostedConfig {
  check(env.CHAUSAR_HOSTED === '1' || args.includes('--hosted'), 'HOSTED_OFF', 'Hosted mode is off. Set CHAUSAR_HOSTED=1 or pass --hosted to start the experimental hosted server.');
  const dev = args.includes('--dev');

  const originText = env.CHAUSAR_HOSTED_ORIGIN ?? (dev ? 'http://localhost:4320' : refuse('Set CHAUSAR_HOSTED_ORIGIN to the public https address, like https://app.example.com.'));
  let url: URL;
  try { url = new URL(originText); } catch { return refuse('CHAUSAR_HOSTED_ORIGIN must be an address like https://app.example.com.'); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) refuse('CHAUSAR_HOSTED_ORIGIN must be an origin only: no path, query or credentials.');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') refuse('CHAUSAR_HOSTED_ORIGIN must use https.');
  if (url.protocol === 'http:' && !(dev && url.hostname === 'localhost')) refuse('Plain http is allowed only for http://localhost with --dev. Use https.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(':')) refuse('Passkeys need a domain name, not an IP address. Use localhost for development.');

  const portText = env.CHAUSAR_HOSTED_PORT ?? (url.port || (dev ? '4320' : '8443'));
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) refuse('CHAUSAR_HOSTED_PORT must be a port number.');
  const listenHost = env.CHAUSAR_HOSTED_LISTEN ?? '127.0.0.1';

  let custody: HostedConfig['custody'];
  if (env.CHAUSAR_HOSTED_CUSTODY_KEY) { parseMasterKey(env.CHAUSAR_HOSTED_CUSTODY_KEY); custody = { kind: 'env', key: env.CHAUSAR_HOSTED_CUSTODY_KEY }; }
  else if (dev) custody = { kind: 'dev-file' };
  else custody = refuse('Set CHAUSAR_HOSTED_CUSTODY_KEY to 32 random bytes as base64url. It opens every vault on this server; keep it in a secret store.');

  let tls: HostedConfig['tls'];
  if (env.CHAUSAR_HOSTED_TLS_CERT || env.CHAUSAR_HOSTED_TLS_KEY) {
    if (!env.CHAUSAR_HOSTED_TLS_CERT || !env.CHAUSAR_HOSTED_TLS_KEY) refuse('Set both CHAUSAR_HOSTED_TLS_CERT and CHAUSAR_HOSTED_TLS_KEY.');
    if (url.protocol !== 'https:') refuse('A TLS certificate needs an https origin.');
    tls = { kind: 'files', cert: resolve(env.CHAUSAR_HOSTED_TLS_CERT as string), key: resolve(env.CHAUSAR_HOSTED_TLS_KEY as string) };
  } else if (url.protocol === 'https:') {
    if (env.CHAUSAR_HOSTED_TLS_PROXY !== '1') refuse('An https origin needs a certificate (CHAUSAR_HOSTED_TLS_CERT and _KEY) or a TLS proxy in front (CHAUSAR_HOSTED_TLS_PROXY=1).');
    tls = { kind: 'proxy' };
  } else tls = { kind: 'none' };

  const mailerName = env.CHAUSAR_HOSTED_MAILER ?? (dev ? 'dev-outbox' : 'none');
  if (mailerName === 'dev-outbox' && !dev) refuse('The development outbox prints sign-in links on the console. It runs only with --dev.');
  if (mailerName !== 'dev-outbox' && mailerName !== 'none') refuse(`The ${mailerName} mail sender is planned, not built. Use none and sign in with passkeys, or --dev.`);

  const runtimeName = env.CHAUSAR_VENTURE_RUNTIME ?? 'local';
  if (runtimeName === 'rivet') refuse('The Rivet Actors adapter is planned: it is mapped and checked against an in-memory stand-in only. Use the local runtime.');
  if (runtimeName !== 'local') refuse('CHAUSAR_VENTURE_RUNTIME must be local.');
  const storageName = env.CHAUSAR_HOSTED_STORAGE ?? 'experimental-file';
  if (storageName !== 'experimental-file' && storageName !== 'postgres') refuse('CHAUSAR_HOSTED_STORAGE must be experimental-file or postgres.');
  const storage: HostedConfig['storage'] = storageName === 'postgres' ? 'postgres' : 'experimental-file';
  let postgres: LoopbackPostgres | null = null;
  if (storage === 'postgres') {
    const text = env.CHAUSAR_HOSTED_POSTGRES_URL ?? refuse('Set CHAUSAR_HOSTED_POSTGRES_URL, like postgres://chausar:password@127.0.0.1:5432/chausar.');
    try { postgres = { ...loopbackPostgresUrl(text), maxConnections: 10 }; }
    catch { refuse('CHAUSAR_HOSTED_POSTGRES_URL must be postgres://user:password@127.0.0.1:port/database (or [::1]), with no query options. Reach a managed database through a TLS proxy on this computer.'); }
  } else if (env.CHAUSAR_HOSTED_POSTGRES_URL !== undefined) refuse('CHAUSAR_HOSTED_POSTGRES_URL is set but CHAUSAR_HOSTED_STORAGE is not postgres.');

  const replayOn = dev && (env.CHAUSAR_VENTURE_REPLAY === '1' || args.includes('--replay'));
  const replay = replayOn ? { model: env.CHAUSAR_VENTURE_MODEL_REPLAY ?? null, github: env.CHAUSAR_VENTURE_GITHUB_REPLAY ?? null } : null;

  const limits: HostedLimits = { ...DEFAULT_LIMITS };
  if (env.CHAUSAR_HOSTED_AI_CEILING_MICROS !== undefined) {
    if (!/^\d{1,12}$/.test(env.CHAUSAR_HOSTED_AI_CEILING_MICROS)) refuse('CHAUSAR_HOSTED_AI_CEILING_MICROS must be whole micro US dollars, like 20000000 for USD 20.');
    limits.monthlyModelCeilingMicros = env.CHAUSAR_HOSTED_AI_CEILING_MICROS;
  }
  if (env.CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT !== undefined) {
    const value = Number(env.CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT);
    if (!Number.isSafeInteger(value) || value < 1 || value > 50) refuse('CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT must be from 1 to 50.');
    limits.businessesPerAccount = value;
  }

  return {
    dev, origin: url.origin, rp: { id: url.hostname, name: 'Chausar', origin: url.origin },
    listen: { host: listenHost, port }, dataDirectory: resolve(env.CHAUSAR_HOSTED_DATA ?? 'data/hosted'),
    custody, tls, trustProxy: env.CHAUSAR_HOSTED_TRUST_PROXY === '1' && tls.kind === 'proxy',
    mailer: mailerName === 'dev-outbox' ? 'dev-outbox' : 'not-configured', replay, storage, postgres, runtime: 'local', limits,
  };
}
