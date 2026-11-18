// Wave 6 package 6F7 (D35): phone access from the owner's computer. The owner presses "Make a pairing link" in the
// app; this starts a phone listener (the owner's own local server, server.ts, in phone mode) on the home network, and
// gives a link like http://192.168.1.20:43117/#pair=<one-time code>. The code is in the fragment, so it never reaches a
// server log; it works once, for 10 minutes. Opening it on the phone exchanges the code for a member session of the
// owner (auth.session, 12 hours unless the owner chooses, 24 at most), which only this listener accepts and which gives
// every request the channel 'phone'. Away from home the same works over Tailscale's private addresses. Stop closes the
// listener and revokes every phone session. Plain http on the home network: Tailscale encrypts its own traffic, home
// Wi-Fi relies on the network's own password (the phone access guide says so).
// The listener is open only while something can use it (found on the real app, 16 November 2026: an unused link left
// the port open until Chausar quit). It closes by itself when no unused link is left in time and no phone is paired:
// when the last link runs out unused, when the last paired phone's time ends, and when wrong codes end every link.
import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { check } from './contracts.ts';
import type { Engine } from './engine.ts';
import { createLocalServer, type InkBuild, type PhoneListener } from './server.ts';
import type { PhoneAccessPort } from './venture/contracts.ts';

export type PhoneAddress = { via: 'wifi' | 'tailscale'; address: string };
/** Wrong codes in a row that end every open link (a guessing phone on the network). */
export const MAX_PAIR_FAILURES = 10;
/**
 * The longest the listener's own timer waits before it looks again. A timer does not count the time a computer sleeps,
 * so one long wait could leave the listener open well past its time after waking; a short one catches it.
 */
export const PHONE_SWEEP_MS = 30_000;

function ipv4(address: string | undefined): number[] | null {
  if (typeof address !== 'string') return null;
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(plain)) return null;
  const parts = plain.split('.').map(Number);
  return parts.every(part => part <= 255) ? parts : null;
}
const homeNetwork = ([a, b]: number[]) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
const tailscale = ([a, b]: number[]) => a === 100 && b >= 64 && b <= 127;

/** Where this computer can be reached by a phone: home network addresses as Wi-Fi, 100.64.0.0/10 as Tailscale. IPv4 only. */
export function phoneAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): PhoneAddress[] {
  const found: PhoneAddress[] = [];
  for (const list of Object.values(interfaces)) for (const item of list ?? []) {
    if (item.internal || item.family !== 'IPv4') continue;
    const parts = ipv4(item.address);
    if (!parts) continue;
    if (homeNetwork(parts)) found.push({ via: 'wifi', address: item.address });
    else if (tailscale(parts)) found.push({ via: 'tailscale', address: item.address });
  }
  return [...found.filter(item => item.via === 'wifi'), ...found.filter(item => item.via === 'tailscale')];
}

/** Whether a peer is on this computer, its home network or Tailscale; anything else is refused before it is read. */
export function privatePeer(address: string | undefined): boolean {
  if (address === '::1') return true;
  const parts = ipv4(address);
  return !!parts && (parts[0] === 127 || homeNetwork(parts) || tailscale(parts));
}

const digest = (value: string) => createHash('sha256').update(`chausar-phone-access-v1\n${value}`, 'utf8').digest('hex');
const refused = () => Object.assign(new Error('This pairing link was used, expired or is wrong. Make a new one in the Chausar app.'), { code: 'PAIRING_FORBIDDEN' });

export type PhoneAccessOptions = {
  /** The address the listener binds; every interface by default, with peers and host names checked on each request. */
  bind?: string;
  port?: number;
  /** Tests stand in for this computer's network. */
  addresses?: () => PhoneAddress[];
  /** The built Ink app, or how to list it when the listener first starts. */
  ink?: InkBuild | (() => Promise<InkBuild>);
  clock?: () => number;
  /** Tests stand in for the listener's server, so none opens a real socket. */
  serve?: (engine: Engine, options: { phone: PhoneListener; ink?: InkBuild; port?: number }) => PhoneServer;
  /** Tests stand in for the timer that closes the listener. Answers how to cancel it. */
  timer?: (run: () => void, ms: number) => () => void;
};
/** What the listener needs of its server (createLocalServer in phone mode). */
export type PhoneServer = { listen(): Promise<{ origin: string }>; stopListening(): Promise<void> };

/** The host's phone listener (VentureDeps.phoneAccess), plus close() for the host's own shutdown. */
export function createPhoneAccess(engine: () => Engine, options: PhoneAccessOptions = {}): PhoneAccessPort & { close(): Promise<void> } {
  const addresses = options.addresses ?? (() => phoneAddresses());
  const now = options.clock ?? (() => Date.now());
  const serve = options.serve ?? ((host, serverOptions) => createLocalServer(host, serverOptions));
  const timer = options.timer ?? ((run, ms) => { const handle = setTimeout(run, ms); handle.unref(); return () => clearTimeout(handle); });
  const codes = new Map<string, { expiresAt: number; hours: number }>();
  const sessions = new Map<string, { sessionId: string; expiresAt: number }>();
  let failures = 0;
  let running: { app: PhoneServer; port: number } | null = null;
  let starting: Promise<{ app: PhoneServer; port: number }> | null = null;
  /** Links being made and phones being paired right now: the listener is in use though no code or session shows it yet. */
  let busy = 0;
  let cancelTimer: (() => void) | null = null;

  /**
   * Drops every link and phone session whose time has passed, and closes the listener when nothing is left that could
   * use it. Runs on the timer, and whenever the state is read, so the answer is never "on" for a listener nobody can use.
   */
  function sweep() {
    const at = now();
    for (const [key, item] of codes) if (item.expiresAt <= at) codes.delete(key);
    for (const [key, item] of sessions) if (item.expiresAt <= at) sessions.delete(key);
    if (running && busy === 0 && codes.size === 0 && sessions.size === 0) {
      const current = running; running = null; failures = 0;
      // A request already on its way finishes; the server closes behind it (server.ts stopListening).
      void current.app.stopListening().catch(() => { /* already closed */ });
    }
    // A link that finished being made after Stop has no listener to open on: it is not a link that waits.
    if (!running && busy === 0) codes.clear();
    arm();
  }
  const expiries = () => [...codes.values(), ...sessions.values()].map(item => item.expiresAt);
  function arm() {
    cancelTimer?.(); cancelTimer = null;
    if (!running) return;
    const times = expiries();
    const wait = times.length ? Math.max(0, Math.min(...times) - now()) : PHONE_SWEEP_MS;
    cancelTimer = timer(() => { cancelTimer = null; sweep(); }, Math.min(wait, PHONE_SWEEP_MS));
  }

  const listener: PhoneListener = {
    bind: options.bind ?? '0.0.0.0',
    hosts: port => addresses().map(item => `${item.address}:${port}`),
    accepts: token => { const item = sessions.get(digest(token)); return !!item && item.expiresAt > now(); },
    async pair(code) {
      check(typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(code), 'INVALID_REQUEST', 'Send the pairing code from the link.');
      const key = digest(code as string), found = codes.get(key);
      if (!found || found.expiresAt <= now()) {
        failures += 1;
        if (failures >= MAX_PAIR_FAILURES) codes.clear();
        sweep();
        throw refused();
      }
      codes.delete(key);
      busy += 1;
      try {
        const host = engine();
        const issued = await host.requestAs(host.bootstrapContext(), 'auth.session', { ttlMs: found.hours * 3_600_000 }) as { token: string; sessionId: string; expiresAt: string };
        sessions.set(digest(issued.token), { sessionId: issued.sessionId, expiresAt: Date.parse(issued.expiresAt) });
        return { token: issued.token, expiresAt: issued.expiresAt };
      } finally { busy -= 1; sweep(); }
    },
  };

  async function start() {
    if (running) return running;
    starting ??= (async () => {
      const ink = typeof options.ink === 'function' ? await options.ink() : options.ink;
      const app = serve(engine(), { phone: listener, ...(ink ? { ink } : {}), ...(options.port !== undefined ? { port: options.port } : {}) });
      const { origin } = await app.listen();
      running = { app, port: Number(new URL(origin).port) };
      return running;
    })().finally(() => { starting = null; });
    return starting;
  }

  async function stop() {
    codes.clear(); failures = 0;
    cancelTimer?.(); cancelTimer = null;
    // Nothing accepts a phone from here on, whatever the revokes below take.
    const ending = [...sessions.values()];
    sessions.clear();
    const current = running; running = null;
    const host = engine();
    for (const item of ending) {
      try { await host.requestAs(host.bootstrapContext(), 'auth.revoke', { sessionId: item.sessionId }); } catch { /* an expired or already revoked session */ }
    }
    if (current) await current.app.stopListening();
  }

  return {
    status: () => {
      sweep();
      const times = expiries();
      return { on: running !== null, addresses: addresses(), phones: sessions.size, waiting: codes.size, closesAt: running && times.length ? new Date(Math.max(...times)).toISOString() : null };
    },
    async link({ via, hours, minutes }) {
      const target = addresses().find(item => item.via === via);
      check(target, 'PHONE_NO_NETWORK', via === 'wifi' ? 'This computer is not on a home network Chausar can use.' : 'Tailscale is not running on this computer.');
      check(Number.isInteger(hours) && hours >= 1 && hours <= 24 && Number.isInteger(minutes) && minutes >= 1 && minutes <= 15, 'INVALID_VENTURE_REQUEST', 'Choose 1 to 24 hours.');
      busy += 1;
      try {
        const { port } = await start();
        const code = randomBytes(32).toString('base64url');
        const expiresAt = now() + minutes * 60_000;
        codes.set(digest(code), { expiresAt, hours });
        return { link: `http://${target!.address}:${port}/#pair=${code}`, expiresAt: new Date(expiresAt).toISOString() };
      } finally { busy -= 1; sweep(); }
    },
    stop,
    close: stop,
  };
}
