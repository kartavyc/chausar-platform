/**
 * A minimal X11 client spoken directly over the local Unix socket (no xdotool, no libX11).
 * Little-endian ('l') byte order, MIT-MAGIC-COOKIE-1 auth from $XAUTHORITY or ~/.Xauthority,
 * request/reply/error/event demultiplexing by sequence number, XTEST for input and XInput 2 raw
 * events for watching. Errors carry fixed codes (DRIVER_UNAVAILABLE, DRIVER_FAILED, DRIVER_TIMEOUT)
 * and never echo outside text.
 */
import { connect, type Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { ChausarError } from '../../contracts.ts';
import { refuse } from '../driver.ts';

/** An X protocol error: DRIVER_FAILED with the X error number kept for callers (BadWindow = 3). */
export class XError extends ChausarError {
  readonly xcode: number; readonly major: number;
  constructor(xcode: number, major: number) { super('DRIVER_FAILED', 'The display refused a request.'); this.xcode = xcode; this.major = major; }
}
export const BAD_WINDOW = 3, BAD_MATCH = 8, BAD_DRAWABLE = 9, BAD_ACCESS = 10;
export const isGone = (error: unknown) => error instanceof XError && (error.xcode === BAD_WINDOW || error.xcode === BAD_DRAWABLE);

export type Visual = { id: number; cls: number; red: number; green: number; blue: number };
export type Setup = {
  idBase: number; idMask: number; root: number; rootDepth: number; rootVisual: number; width: number; height: number;
  minKeycode: number; maxKeycode: number; imageByteOrder: number; formats: { depth: number; bpp: number; pad: number }[]; visuals: Map<number, Visual>;
};
export type XEvent = { type: number; sent: boolean; data: Buffer };
export type KeyEvent = { keycode: number; time: number; root: number; window: number; child: number; state: number };
export type RawEvent = { evtype: number; deviceid: number; time: number; detail: number; sourceid: number };
export type XIDevice = { id: number; use: number; attachment: number; enabled: boolean; name: string };

const pad4 = (n: number) => (4 - (n % 4)) % 4;

/** Parse DISPLAY into the local socket path and display number. Any TCP host is refused. */
export function displaySocket(display: string | undefined): { path: string; number: string } {
  const m = /^(?:unix)?:(\d{1,4})(?:\.\d{1,3})?$/.exec(display ?? '');
  if (!m) refuse('DRIVER_UNAVAILABLE', "This computer's display cannot be reached.");
  return { path: `/tmp/.X11-unix/X${m[1]}`, number: m[1] };
}

/** MIT-MAGIC-COOKIE-1 for this display from the Xauthority file, or null for no auth. */
export function readCookie(number: string, env: Record<string, string | undefined>): Buffer | null {
  let file: Buffer;
  try { file = readFileSync(env.XAUTHORITY || join(env.HOME || homedir(), '.Xauthority')); } catch { return null; }
  const host = hostname(); let best: Buffer | null = null; let rank = 0; let at = 0;
  const field = () => { const n = file.readUInt16BE(at); const v = file.subarray(at + 2, at + 2 + n); at += 2 + n; return v; };
  try {
    while (at + 2 <= file.length) {
      const family = file.readUInt16BE(at); at += 2;
      const address = field().toString('latin1'), num = field().toString('latin1'), name = field().toString('latin1'), data = field();
      if (name !== 'MIT-MAGIC-COOKIE-1' || (num !== '' && num !== number)) continue;
      const r = family === 256 && address === host ? 3 : family === 256 ? 2 : family === 65535 ? 1 : 0;
      if (r > rank) { rank = r; best = Buffer.from(data); }
    }
  } catch { /* a cut file: use what was read */ }
  return best;
}

type Pending = { resolve(b: Buffer): void; reject(e: Error): void; timer: NodeJS.Timeout };

export class X11Client {
  setup!: Setup;
  onEvent: (event: XEvent) => void = () => {};
  readonly #timeoutMs: number;
  #socket: Socket | null = null; #buf: Buffer = Buffer.alloc(0); #seq = 0; #nextId = 0; #closed = false;
  #pending = new Map<number, Pending>(); #errors = new Map<number, XError | null>();
  #atoms = new Map<string, number>(); #ext = new Map<string, { major: number; firstEvent: number } | null>();
  #setupDone: ((b: Buffer | Error) => void) | null = null;

  constructor(timeoutMs = 5000) { this.#timeoutMs = timeoutMs; }

  static async open(display: string | undefined, env: Record<string, string | undefined> = process.env, timeoutMs = 5000): Promise<X11Client> {
    const { path, number } = displaySocket(display);
    const client = new X11Client(timeoutMs);
    await client.#connect(path, readCookie(number, env));
    return client;
  }

  #connect(path: string, cookie: Buffer | null): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const fail = (e: Error) => { clearTimeout(timer); this.close(); reject(e); };
      const timer = setTimeout(() => fail(new ChausarError('DRIVER_TIMEOUT', "This computer's display did not answer in time.")), this.#timeoutMs);
      const socket = connect(path);
      this.#socket = socket;
      socket.on('error', () => this.#shutdown(new ChausarError('DRIVER_UNAVAILABLE', "This computer's display cannot be reached.")));
      socket.on('close', () => this.#shutdown(new ChausarError('DRIVER_FAILED', 'The display connection closed.')));
      socket.on('data', chunk => this.#data(chunk));
      this.#setupDone = result => {
        clearTimeout(timer); this.#setupDone = null;
        if (result instanceof Error) return fail(result);
        try { this.#parseSetup(result); resolve(); } catch (e) { fail(e as Error); }
      };
      const name = cookie ? Buffer.from('MIT-MAGIC-COOKIE-1') : Buffer.alloc(0), data = cookie ?? Buffer.alloc(0);
      const head = Buffer.alloc(12); head.write('l', 0); head.writeUInt16LE(11, 2); head.writeUInt16LE(0, 4);
      head.writeUInt16LE(name.length, 6); head.writeUInt16LE(data.length, 8);
      socket.write(Buffer.concat([head, name, Buffer.alloc(pad4(name.length)), data, Buffer.alloc(pad4(data.length))]));
    });
  }

  #parseSetup(b: Buffer) {
    const vendorLen = b.readUInt16LE(24), nScreens = b.readUInt8(28), nFormats = b.readUInt8(29);
    let at = 40 + vendorLen + pad4(vendorLen);
    const formats = [];
    for (let i = 0; i < nFormats; i++, at += 8) formats.push({ depth: b[at], bpp: b[at + 1], pad: b[at + 2] });
    if (nScreens < 1) refuse('DRIVER_UNAVAILABLE', "This computer's display cannot be reached.");
    const visuals = new Map<number, Visual>();
    const root = b.readUInt32LE(at), width = b.readUInt16LE(at + 20), height = b.readUInt16LE(at + 22);
    const rootVisual = b.readUInt32LE(at + 32), rootDepth = b[at + 38], nDepths = b[at + 39];
    at += 40;
    for (let d = 0; d < nDepths; d++) {
      const nVis = b.readUInt16LE(at + 2); at += 8;
      for (let v = 0; v < nVis; v++, at += 24) visuals.set(b.readUInt32LE(at), { id: b.readUInt32LE(at), cls: b[at + 4], red: b.readUInt32LE(at + 8), green: b.readUInt32LE(at + 12), blue: b.readUInt32LE(at + 16) });
    }
    this.setup = { idBase: b.readUInt32LE(12), idMask: b.readUInt32LE(16), root, rootDepth, rootVisual, width, height,
      minKeycode: b[34], maxKeycode: b[35], imageByteOrder: b[30], formats, visuals };
  }

  #data(chunk: Buffer) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    for (;;) {
      const b = this.#buf;
      if (this.#setupDone) {
        if (b.length < 8) return;
        const total = 8 + b.readUInt16LE(6) * 4;
        if (b.length < total) return;
        this.#buf = b.subarray(total);
        this.#setupDone(b[0] === 1 ? b.subarray(0, total) : new ChausarError('DRIVER_UNAVAILABLE', "This computer's display refused the connection."));
        continue;
      }
      if (b.length < 32) return;
      const kind = b[0] & 0x7f;
      const total = b[0] === 1 || kind === 35 ? 32 + b.readUInt32LE(4) * 4 : 32;
      if (b.length < total) return;
      const packet = Buffer.from(b.subarray(0, total)); this.#buf = b.subarray(total);
      const seq = packet.readUInt16LE(2);
      if (packet[0] === 0) {
        const error = new XError(packet[1], packet[10]);
        const p = this.#pending.get(seq);
        if (p) { this.#pending.delete(seq); clearTimeout(p.timer); p.reject(error); } else if (this.#errors.has(seq)) this.#errors.set(seq, error);
      } else if (packet[0] === 1) {
        const p = this.#pending.get(seq);
        if (p) { this.#pending.delete(seq); clearTimeout(p.timer); p.resolve(packet); }
      } else {
        try { this.onEvent({ type: kind, sent: (packet[0] & 0x80) !== 0, data: packet }); } catch { /* a listener's fault stays there */ }
      }
    }
  }

  #shutdown(error: Error) {
    if (this.#closed) return; this.#closed = true;
    this.#setupDone?.(error);
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.#pending.clear();
    this.#socket?.destroy();
  }
  get closed() { return this.#closed; }
  close() { this.#shutdown(new ChausarError('DRIVER_FAILED', 'The display connection closed.')); }

  /** Send one request; returns its 16-bit sequence number. */
  #send(opcode: number, data: number, body: Buffer): number {
    if (this.#closed) throw new ChausarError('DRIVER_FAILED', 'The display connection closed.');
    const len = 4 + body.length + pad4(body.length);
    const head = Buffer.alloc(4); head[0] = opcode; head[1] = data; head.writeUInt16LE(len / 4, 2);
    this.#socket!.write(Buffer.concat([head, body, Buffer.alloc(pad4(body.length))]));
    this.#seq = (this.#seq + 1) & 0xffff;
    return this.#seq;
  }
  /** A request with a reply. */
  request(opcode: number, data: number, body: Buffer, timeoutMs = this.#timeoutMs): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      let seq: number;
      try { seq = this.#send(opcode, data, body); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { this.#pending.delete(seq); reject(new ChausarError('DRIVER_TIMEOUT', "This computer's display did not answer in time.")); }, timeoutMs);
      this.#pending.set(seq, { resolve, reject, timer });
    });
  }
  /** A request without a reply, fire and forget. */
  send(opcode: number, data: number, body: Buffer) { this.#send(opcode, data, body); }
  /** A request without a reply, confirmed by a round trip; throws the X error it caused. */
  async checked(opcode: number, data: number, body: Buffer): Promise<void> {
    const seq = this.#send(opcode, data, body);
    this.#errors.set(seq, null);
    try { await this.getInputFocus(); } finally {
      const error = this.#errors.get(seq); this.#errors.delete(seq);
      if (error) throw error;
    }
  }
  newId(): number {
    const { idBase, idMask } = this.setup, shift = 31 - Math.clz32(idMask & -idMask);
    return (idBase | ((++this.#nextId << shift) & idMask)) >>> 0;
  }

  // ---- core requests ----
  async internAtom(name: string, onlyIfExists = false): Promise<number> {
    const known = this.#atoms.get(name); if (known) return known;
    const n = Buffer.from(name, 'latin1'); const body = Buffer.alloc(4); body.writeUInt16LE(n.length, 0);
    const atom = (await this.request(16, onlyIfExists ? 1 : 0, Buffer.concat([body, n]))).readUInt32LE(8);
    if (atom) this.#atoms.set(name, atom);
    return atom;
  }
  async getProperty(window: number, property: number, type = 0, longLength = 0x10000): Promise<{ type: number; format: number; value: Buffer } | null> {
    const body = Buffer.alloc(20); body.writeUInt32LE(window, 0); body.writeUInt32LE(property, 4); body.writeUInt32LE(type, 8); body.writeUInt32LE(0, 12); body.writeUInt32LE(longLength, 16);
    const r = await this.request(20, 0, body);
    const ptype = r.readUInt32LE(8), format = r[1], n = r.readUInt32LE(16);
    if (!ptype) return null;
    return { type: ptype, format, value: Buffer.from(r.subarray(32, 32 + n * (format / 8))) };
  }
  async changeProperty(window: number, property: number, type: number, format: 8 | 16 | 32, value: Buffer, mode = 0) {
    const body = Buffer.alloc(20); body.writeUInt32LE(window, 0); body.writeUInt32LE(property, 4); body.writeUInt32LE(type, 8); body[12] = format;
    body.writeUInt32LE(value.length / (format / 8), 16);
    await this.checked(18, mode, Buffer.concat([body, value]));
  }
  async queryTree(window: number): Promise<{ root: number; parent: number; children: number[] }> {
    const r = await this.request(15, 0, u32(window)); const n = r.readUInt16LE(16);
    return { root: r.readUInt32LE(8), parent: r.readUInt32LE(12), children: Array.from({ length: n }, (_, i) => r.readUInt32LE(32 + i * 4)) };
  }
  async getWindowAttributes(window: number): Promise<{ visual: number; cls: number; mapState: number; overrideRedirect: boolean }> {
    const r = await this.request(3, 0, u32(window));
    return { visual: r.readUInt32LE(8), cls: r.readUInt16LE(12), mapState: r[26], overrideRedirect: r[27] === 1 };
  }
  async getGeometry(drawable: number): Promise<{ depth: number; root: number; x: number; y: number; width: number; height: number; border: number }> {
    const r = await this.request(14, 0, u32(drawable));
    return { depth: r[1], root: r.readUInt32LE(8), x: r.readInt16LE(12), y: r.readInt16LE(14), width: r.readUInt16LE(16), height: r.readUInt16LE(18), border: r.readUInt16LE(20) };
  }
  async translateCoordinates(src: number, dst: number, x = 0, y = 0): Promise<{ child: number; x: number; y: number }> {
    const body = Buffer.alloc(12); body.writeUInt32LE(src, 0); body.writeUInt32LE(dst, 4); body.writeInt16LE(x, 8); body.writeInt16LE(y, 10);
    const r = await this.request(40, 0, body);
    return { child: r.readUInt32LE(8), x: r.readInt16LE(12), y: r.readInt16LE(14) };
  }
  async queryPointer(window: number): Promise<{ root: number; child: number; x: number; y: number; mask: number }> {
    const r = await this.request(38, 0, u32(window));
    return { root: r.readUInt32LE(8), child: r.readUInt32LE(12), x: r.readInt16LE(16), y: r.readInt16LE(18), mask: r.readUInt16LE(24) };
  }
  async getInputFocus(): Promise<{ focus: number; revertTo: number }> {
    const r = await this.request(43, 0, Buffer.alloc(0));
    return { focus: r.readUInt32LE(8), revertTo: r[1] };
  }
  /** RevertToParent = 2; time 0 = CurrentTime. */
  setInputFocus(window: number, revertTo = 2) { const b = Buffer.alloc(8); b.writeUInt32LE(window, 0); return this.checked(42, revertTo, b); }
  raise(window: number) { const b = Buffer.alloc(12); b.writeUInt32LE(window, 0); b.writeUInt16LE(0x40, 4); b.writeUInt32LE(0, 8); return this.checked(12, 0, b); }
  /** SendEvent of a 32-bit ClientMessage (as for _NET_ACTIVE_WINDOW). */
  sendClientMessage(destination: number, window: number, type: number, data: number[], mask = 0x180000) {
    const ev = Buffer.alloc(32); ev[0] = 33; ev[1] = 32; ev.writeUInt32LE(window, 4); ev.writeUInt32LE(type, 8);
    data.slice(0, 5).forEach((v, i) => ev.writeUInt32LE(v >>> 0, 12 + i * 4));
    const body = Buffer.alloc(8); body.writeUInt32LE(destination, 0); body.writeUInt32LE(mask, 4);
    return this.checked(25, 0, Buffer.concat([body, ev]));
  }
  async getKeyboardMapping(): Promise<{ min: number; perKeycode: number; keysyms: number[] }> {
    const { minKeycode: min, maxKeycode: max } = this.setup; const count = max - min + 1;
    const body = Buffer.alloc(4); body[0] = min; body[1] = count;
    const r = await this.request(101, 0, body); const per = r[1];
    return { min, perKeycode: per, keysyms: Array.from({ length: count * per }, (_, i) => r.readUInt32LE(32 + i * 4)) };
  }
  async queryKeymap(): Promise<Buffer> { return Buffer.from((await this.request(44, 0, Buffer.alloc(0))).subarray(8, 40)); }
  /** Passive key grab; pointer and keyboard stay asynchronous. */
  grabKey(window: number, keycode: number, modifiers: number) {
    const b = Buffer.alloc(12); b.writeUInt32LE(window, 0); b.writeUInt16LE(modifiers, 4); b[6] = keycode; b[7] = 1; b[8] = 1;
    return this.checked(33, 1, b);
  }
  ungrabKey(window: number, keycode: number, modifiers: number) {
    const b = Buffer.alloc(8); b.writeUInt32LE(window, 0); b.writeUInt16LE(modifiers, 4); return this.checked(34, keycode, b);
  }
  async getImage(drawable: number, x: number, y: number, width: number, height: number): Promise<{ depth: number; visual: number; data: Buffer }> {
    const b = Buffer.alloc(16); b.writeUInt32LE(drawable, 0); b.writeInt16LE(x, 4); b.writeInt16LE(y, 6); b.writeUInt16LE(width, 8); b.writeUInt16LE(height, 10); b.writeUInt32LE(0xffffffff, 12);
    const r = await this.request(73, 2, b, Math.max(this.#timeoutMs, 15000));
    return { depth: r[1], visual: r.readUInt32LE(8), data: r.subarray(32) };
  }
  /** CreateWindow with values in bit order: back-pixel 0x2, override-redirect 0x200, event-mask 0x800. */
  async createWindow(parent: number, x: number, y: number, width: number, height: number, values: { backPixel?: number; overrideRedirect?: boolean; eventMask?: number } = {}): Promise<number> {
    const id = this.newId();
    const b = Buffer.alloc(28); b.writeUInt32LE(id, 0); b.writeUInt32LE(parent, 4); b.writeInt16LE(x, 8); b.writeInt16LE(y, 10);
    b.writeUInt16LE(width, 12); b.writeUInt16LE(height, 14); b.writeUInt16LE(0, 16); b.writeUInt16LE(1, 18); b.writeUInt32LE(0, 20);
    const [mask, list] = windowValues(values); b.writeUInt32LE(mask, 24);
    await this.checked(1, 0, Buffer.concat([b, list]));
    return id;
  }
  changeWindowAttributes(window: number, values: { backPixel?: number; overrideRedirect?: boolean; eventMask?: number }) {
    const [mask, list] = windowValues(values); const b = Buffer.alloc(8); b.writeUInt32LE(window, 0); b.writeUInt32LE(mask, 4);
    return this.checked(2, 0, Buffer.concat([b, list]));
  }
  mapWindow(window: number) { return this.checked(8, 0, u32(window)); }
  destroyWindow(window: number) { return this.checked(4, 0, u32(window)); }
  async queryExtension(name: string): Promise<{ major: number; firstEvent: number } | null> {
    if (this.#ext.has(name)) return this.#ext.get(name)!;
    const n = Buffer.from(name, 'latin1'); const b = Buffer.alloc(4); b.writeUInt16LE(n.length, 0);
    const r = await this.request(98, 0, Buffer.concat([b, n]));
    const found = r[8] ? { major: r[9], firstEvent: r[10] } : null;
    this.#ext.set(name, found);
    return found;
  }

  // ---- XTEST ----
  async xtestVersion(): Promise<{ major: number; minor: number } | null> {
    const ext = await this.queryExtension('XTEST'); if (!ext) return null;
    const b = Buffer.alloc(4); b[0] = 2; b.writeUInt16LE(2, 2);
    const r = await this.request(ext.major, 0, b);
    return { major: r[1], minor: r.readUInt16LE(8) };
  }
  /** XTEST FakeInput: type 2 KeyPress, 3 KeyRelease, 4 ButtonPress, 5 ButtonRelease, 6 MotionNotify (absolute). */
  async fakeInput(type: number, detail: number, x = 0, y = 0) {
    const ext = await this.queryExtension('XTEST'); if (!ext) refuse('DRIVER_UNAVAILABLE', 'This display does not accept input from Chausar.');
    const b = Buffer.alloc(32); b[0] = type; b[1] = detail; b.writeUInt32LE(type === 6 ? this.setup.root : 0, 8); b.writeInt16LE(x, 20); b.writeInt16LE(y, 22);
    this.send(ext.major, 2, b);
  }

  // ---- XInput 2 ----
  async xiQueryVersion(major = 2, minor = 2): Promise<{ major: number; minor: number } | null> {
    const ext = await this.queryExtension('XInputExtension'); if (!ext) return null;
    const b = Buffer.alloc(4); b.writeUInt16LE(major, 0); b.writeUInt16LE(minor, 2);
    try { const r = await this.request(ext.major, 47, b); return { major: r.readUInt16LE(8), minor: r.readUInt16LE(10) }; } catch (e) { if (e instanceof XError) return null; throw e; }
  }
  /** XISelectEvents for one device (0 all, 1 all master) with a bit mask of event types. */
  async xiSelectEvents(window: number, deviceid: number, evtypes: number[]) {
    const ext = await this.queryExtension('XInputExtension'); if (!ext) refuse('DRIVER_UNAVAILABLE', "This computer's display cannot be watched.");
    const mask = Buffer.alloc(4); for (const t of evtypes) mask[t >> 3] |= 1 << (t & 7);
    const b = Buffer.alloc(12); b.writeUInt32LE(window, 0); b.writeUInt16LE(1, 4); b.writeUInt16LE(deviceid, 8); b.writeUInt16LE(1, 10);
    await this.checked(ext.major, 46, Buffer.concat([b, mask]));
  }
  async xiQueryDevice(deviceid = 0): Promise<XIDevice[]> {
    const ext = await this.queryExtension('XInputExtension'); if (!ext) return [];
    const b = Buffer.alloc(4); b.writeUInt16LE(deviceid, 0);
    const r = await this.request(ext.major, 48, b); const n = r.readUInt16LE(8); const out: XIDevice[] = []; let at = 32;
    for (let i = 0; i < n; i++) {
      const id = r.readUInt16LE(at), use = r.readUInt16LE(at + 2), attachment = r.readUInt16LE(at + 4), nClasses = r.readUInt16LE(at + 6), nameLen = r.readUInt16LE(at + 8), enabled = r[at + 10] === 1;
      const name = r.subarray(at + 12, at + 12 + nameLen).toString('utf8'); at += 12 + nameLen + pad4(nameLen);
      for (let c = 0; c < nClasses; c++) at += r.readUInt16LE(at + 2) * 4;
      out.push({ id, use, attachment, enabled, name });
    }
    return out;
  }
  /** The XI2 raw event in a GenericEvent from this client's XInputExtension, else null. */
  rawEvent(event: XEvent): RawEvent | null {
    const ext = this.#ext.get('XInputExtension');
    if (event.type !== 35 || !ext || event.data[1] !== ext.major) return null;
    const d = event.data;
    return { evtype: d.readUInt16LE(8), deviceid: d.readUInt16LE(10), time: d.readUInt32LE(12), detail: d.readUInt32LE(16), sourceid: d.readUInt16LE(20) };
  }
}

export const XI = { RawKeyPress: 13, RawKeyRelease: 14, RawButtonPress: 15, RawButtonRelease: 16, RawMotion: 17, AllDevices: 0, AllMasterDevices: 1 } as const;
export const EVENT_MASK = { KeyPress: 1, ButtonPress: 4, Exposure: 0x8000, StructureNotify: 0x20000, PropertyChange: 0x400000 } as const;
export const MOD = { Shift: 1, Lock: 2, Control: 4, Mod1: 8, Mod2: 16 } as const;

/** Core KeyPress / KeyRelease (types 2 and 3). */
export function keyEvent(event: XEvent): KeyEvent | null {
  if (event.type !== 2 && event.type !== 3) return null;
  const d = event.data;
  return { keycode: d[1], time: d.readUInt32LE(4), root: d.readUInt32LE(8), window: d.readUInt32LE(12), child: d.readUInt32LE(16), state: d.readUInt16LE(28) };
}

const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
function windowValues(v: { backPixel?: number; overrideRedirect?: boolean; eventMask?: number }): [number, Buffer] {
  let mask = 0; const list: number[] = [];
  if (v.backPixel !== undefined) { mask |= 0x2; list.push(v.backPixel); }
  if (v.overrideRedirect !== undefined) { mask |= 0x200; list.push(v.overrideRedirect ? 1 : 0); }
  if (v.eventMask !== undefined) { mask |= 0x800; list.push(v.eventMask); }
  const b = Buffer.alloc(list.length * 4); list.forEach((x, i) => b.writeUInt32LE(x >>> 0, i * 4));
  return [mask, b];
}

/** ZPixmap bytes to tightly packed RGB, using the visual's channel masks. */
export function zpixmapToRgb(setup: Setup, depth: number, visualId: number, data: Buffer, width: number, height: number): Buffer {
  const format = setup.formats.find(f => f.depth === depth);
  if (!format || ![16, 24, 32].includes(format.bpp)) refuse('DRIVER_FAILED', 'This window uses a picture format Chausar cannot read.');
  const visual = setup.visuals.get(visualId) ?? setup.visuals.get(setup.rootVisual);
  if (!visual || visual.cls < 4) refuse('DRIVER_FAILED', 'This window uses a picture format Chausar cannot read.');
  const stride = Math.ceil((width * format.bpp) / format.pad) * (format.pad / 8), bytes = format.bpp / 8, le = setup.imageByteOrder === 0;
  if (data.length < stride * height) refuse('DRIVER_FAILED', 'The window picture was incomplete.');
  const chan = (mask: number) => { const shift = mask ? 31 - Math.clz32(mask & -mask) : 0; const max = mask >>> shift; return (p: number) => max ? Math.round((((p & mask) >>> shift) * 255) / max) : 0; };
  const r = chan(visual.red), g = chan(visual.green), b = chan(visual.blue);
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0, at = y * stride; x < width; x++, at += bytes) {
      const p = bytes === 4 ? (le ? data.readUInt32LE(at) : data.readUInt32BE(at)) : bytes === 3 ? (le ? data.readUIntLE(at, 3) : data.readUIntBE(at, 3)) : (le ? data.readUInt16LE(at) : data.readUInt16BE(at));
      out[o++] = r(p); out[o++] = g(p); out[o++] = b(p);
    }
  }
  return out;
}

/** A tiny PNG encoder: 8-bit RGB, no filtering, one IDAT. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
