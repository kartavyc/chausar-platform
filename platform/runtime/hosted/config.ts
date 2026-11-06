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
  /**
   * How many trusted proxies stand in front (CHAUSAR_HOSTED_TRUST_PROXY=<hops>, 1 for 1 or true): the browser's
   * address is the X-Forwarded-For entry that many from the right. 0 when no proxy is trusted.
   */
  proxyHops: number;
  mailer: 'dev-outbox' | 'not-configured';
  replay: { model: string | null; github: string | null } | null;
  /** Both are experimental until a real deploy has been tested. */
  storage: 'experimental-file' | 'postgres';
  /** With storage 'postgres': a server on this computer's loopback. A managed database is reached through a local TLS proxy. */
  postgres: LoopbackPostgres | null;
  runtime: 'local';
  limits: HostedLimits;
  /**
   * CHAUSAR_PUBLIC_URL: the address clients reach this server at, for client share links (/share/<token>). It must be
   * this server's own origin; null when unset, and then share links are kept but get no address.
   */
  publicUrl: string | null;
  /**
   * Phone alerts by web push (Ink v2 wave 4, 4G3), on unless CHAUSAR_HOSTED_PUSH=0; null when off, and then the app
   * says phone alerts are not set up here. The VAPID key pair needs no setting: it is derived from the custody key
   * (custody.ts pushKey), the same on every server process and never written anywhere. subject: the contact the push
   * services see, CHAUSAR_HOSTED_PUSH_CONTACT (a mailto: or https: address), else this server's https origin, else
   * none (development over http), rather than an invented one.
   */
  push: { subject: string | null } | null;
  /**
   * Ink v2 wave 4 (4J23): whether people may start a business without an account (POST /api/hosted/trial).
   * CHAUSAR_HOSTED_TRIALS=1 or 0; off by default, on by default with --dev.
   */
  trials: boolean;
};

const refuse = (message: string): never => { throw new ChausarError('HOSTED_CONFIG_INVALID', message); };

/** The web push switch and contact (HostedConfig.push, 4G3). */
function pushConfig(env: NodeJS.ProcessEnv, origin: URL): HostedConfig['push'] {
  const switchText = env.CHAUSAR_HOSTED_PUSH ?? '1';
  if (switchText !== '0' && switchText !== '1') refuse('CHAUSAR_HOSTED_PUSH must be 1 (phone alerts on) or 0 (off).');
  if (switchText === '0') return null;
  const contact = env.CHAUSAR_HOSTED_PUSH_CONTACT;
  if (contact === undefined || contact === '') return { subject: origin.protocol === 'https:' ? origin.origin : null };
  const words = 'CHAUSAR_HOSTED_PUSH_CONTACT must be a mailto: address or an https address the push services can reach you at.';
  let given: URL;
  try { given = new URL(contact); } catch { return refuse(words); }
  if (given.protocol === 'mailto:') {
    if (!/^mailto:[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(contact)) refuse(words);
  } else if (given.protocol !== 'https:' || given.username || given.password || given.hash) refuse(words);
  return { subject: contact };
}

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
  const trials = trialSettings(env, dev, limits);

  let publicUrl: string | null = null;
  if (env.CHAUSAR_PUBLIC_URL !== undefined && env.CHAUSAR_PUBLIC_URL !== '') {
    let given: URL;
    try { given = new URL(env.CHAUSAR_PUBLIC_URL); } catch { return refuse('CHAUSAR_PUBLIC_URL must be an address like https://app.example.com.'); }
    if (given.username || given.password || given.search || given.hash || (given.pathname !== '/' && given.pathname !== '')) refuse('CHAUSAR_PUBLIC_URL must be an origin only: no path, query or credentials.');
    if (given.origin !== url.origin) refuse("CHAUSAR_PUBLIC_URL must be this server's own origin (CHAUSAR_HOSTED_ORIGIN): client share links are served here.");
    publicUrl = given.origin;
  }

  const push = pushConfig(env, url);
  // Trusted proxies in front (4J23): 0 or false for none, 1 or true for one, up to 10 for a chain. Only behind TLS proxying.
  const hopsText = env.CHAUSAR_HOSTED_TRUST_PROXY ?? '0';
  const hops = hopsText === 'true' ? 1 : hopsText === 'false' ? 0 : /^\d{1,2}$/.test(hopsText) ? Number(hopsText) : NaN;
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) refuse('CHAUSAR_HOSTED_TRUST_PROXY must be 0 (no proxy), 1 or true (one proxy), or the number of proxies in front, up to 10.');
  const proxyHops = tls.kind === 'proxy' ? hops : 0;

  return {
    dev, origin: url.origin, rp: { id: url.hostname, name: 'Chausar', origin: url.origin }, publicUrl, push,
    listen: { host: listenHost, port }, dataDirectory: resolve(env.CHAUSAR_HOSTED_DATA ?? 'data/hosted'),
    custody, tls, trustProxy: proxyHops > 0, proxyHops,
    mailer: mailerName === 'dev-outbox' ? 'dev-outbox' : 'not-configured', replay, storage, postgres, runtime: 'local', limits, trials,
  };
}

/** A whole number from the environment within a range, or a plain refusal naming the variable; null when unset. */
function wholeSetting(env: NodeJS.ProcessEnv, name: string, min: number, max: number, words: string): number | null {
  const text = env[name];
  if (text === undefined) return null;
  const value = /^\d{1,12}$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) refuse(`${name} must be ${words}.`);
  return value;
}

/**
 * Starting without an account (Ink v2 wave 4, 4J23): the switch, off by default outside --dev, and the trial limits
 * that may be set, each checked like the other limits.
 */
function trialSettings(env: NodeJS.ProcessEnv, dev: boolean, limits: HostedLimits): boolean {
  const switchText = env.CHAUSAR_HOSTED_TRIALS ?? (dev ? '1' : '0');
  if (switchText !== '0' && switchText !== '1') refuse('CHAUSAR_HOSTED_TRIALS must be 1 (people may start without an account) or 0 (off).');
  const live = wholeSetting(env, 'CHAUSAR_HOSTED_TRIALS_LIVE', 1, 100_000, 'a whole number of trials from 1 to 100000');
  if (live !== null) limits.trialsLive = live;
  const days = wholeSetting(env, 'CHAUSAR_HOSTED_TRIAL_IDLE_DAYS', 1, 30, 'whole days from 1 to 30');
  if (days !== null) limits.trialIdleMs = days * 86_400_000;
  const bytes = wholeSetting(env, 'CHAUSAR_HOSTED_TRIAL_VAULT_BYTES', 1_048_576, 268_435_456, 'whole bytes from 1048576 (1 MB) to 268435456 (256 MB)');
  if (bytes !== null) limits.trialVaultBytes = bytes;
  if (env.CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS !== undefined) {
    if (!/^\d{1,12}$/.test(env.CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS)) refuse('CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS must be whole micro US dollars, like 2000000 for USD 2.');
    limits.trialModelCeilingMicros = env.CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS;
  }
  return switchText === '1';
}
