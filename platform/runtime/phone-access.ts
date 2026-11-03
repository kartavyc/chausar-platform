// Wave 6 package 6F7 (D35): phone access from the owner's computer. The owner presses "Make a pairing link" in the
// app; this starts a phone listener (the owner's own local server, server.ts, in phone mode) on the home network, and
// gives a link like http://192.168.1.20:43117/#pair=<one-time code>. The code is in the fragment, so it never reaches a
// server log; it works once, for 10 minutes. Opening it on the phone exchanges the code for a member session of the
// owner (auth.session, 12 hours unless the owner chooses, 24 at most), which only this listener accepts and which gives
// every request the channel 'phone'. Away from home the same works over Tailscale's private addresses. Stop closes the
// listener and revokes every phone session. Plain http on the home network: Tailscale encrypts its own traffic, home
// Wi-Fi relies on the network's own password (the phone access guide says so).
import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { check } from './contracts.ts';
import type { Engine } from './engine.ts';
import { createLocalServer, type InkBuild, type PhoneListener } from './server.ts';
import type { PhoneAccessPort } from './venture/contracts.ts';

export type PhoneAddress = { via: 'wifi' | 'tailscale'; address: string };
/** Wrong codes in a row that end every open link (a guessing phone on the network). */
export const MAX_PAIR_FAILURES = 10;

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
};

/** The host's phone listener (VentureDeps.phoneAccess), plus close() for the host's own shutdown. */
export function createPhoneAccess(engine: () => Engine, options: PhoneAccessOptions = {}): PhoneAccessPort & { close(): Promise<void> } {
  const addresses = options.addresses ?? (() => phoneAddresses());
  const now = options.clock ?? (() => Date.now());
  const codes = new Map<string, { expiresAt: number; hours: number }>();
  const sessions = new Map<string, { sessionId: string; expiresAt: number }>();
  let failures = 0;
  let running: { app: ReturnType<typeof createLocalServer>; port: number } | null = null;
  let starting: Promise<{ app: ReturnType<typeof createLocalServer>; port: number }> | null = null;

  const live = () => { for (const [key, item] of sessions) if (item.expiresAt <= now()) sessions.delete(key); return sessions.size; };
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
        throw refused();
      }
      codes.delete(key);
      const host = engine();
      const issued = await host.requestAs(host.bootstrapContext(), 'auth.session', { ttlMs: found.hours * 3_600_000 }) as { token: string; sessionId: string; expiresAt: string };
      sessions.set(digest(issued.token), { sessionId: issued.sessionId, expiresAt: Date.parse(issued.expiresAt) });
      return { token: issued.token, expiresAt: issued.expiresAt };
    },
  };

  async function start() {
    if (running) return running;
    starting ??= (async () => {
      const ink = typeof options.ink === 'function' ? await options.ink() : options.ink;
      const app = createLocalServer(engine(), { phone: listener, ...(ink ? { ink } : {}), ...(options.port !== undefined ? { port: options.port } : {}) });
      const { origin } = await app.listen();
      running = { app, port: Number(new URL(origin).port) };
      return running;
    })().finally(() => { starting = null; });
    return starting;
  }

  async function stop() {
    codes.clear(); failures = 0;
    const host = engine();
    for (const item of sessions.values()) {
      try { await host.requestAs(host.bootstrapContext(), 'auth.revoke', { sessionId: item.sessionId }); } catch { /* an expired or already revoked session */ }
    }
    sessions.clear();
    const current = running; running = null;
    if (current) await current.app.stopListening();
  }

  return {
    status: () => ({ on: running !== null, addresses: addresses(), phones: live() }),
    async link({ via, hours, minutes }) {
      const target = addresses().find(item => item.via === via);
      check(target, 'PHONE_NO_NETWORK', via === 'wifi' ? 'This computer is not on a home network Chausar can use.' : 'Tailscale is not running on this computer.');
      check(Number.isInteger(hours) && hours >= 1 && hours <= 24 && Number.isInteger(minutes) && minutes >= 1 && minutes <= 15, 'INVALID_VENTURE_REQUEST', 'Choose 1 to 24 hours.');
      const { port } = await start();
      const code = randomBytes(32).toString('base64url');
      const expiresAt = now() + minutes * 60_000;
      codes.set(digest(code), { expiresAt, hours });
      return { link: `http://${target!.address}:${port}/#pair=${code}`, expiresAt: new Date(expiresAt).toISOString() };
    },
    stop,
    close: stop,
  };
}
