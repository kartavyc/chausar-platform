/**
 * The X11 desktop driver (Linux). Speaks the X protocol directly over the local socket: windows
 * from _NET_CLIENT_LIST or the root's children, keys through XTEST, pictures through GetImage and
 * the person's own input through XInput 2 raw events, with the stop key (Ctrl Alt Pause) grabbed
 * on a separate connection. X11 cannot tell a password field without AT-SPI, so `focused().secret`
 * is always null here and the session treats that as "cannot tell".
 */
import { ChausarError } from '../../contracts.ts';
import { type Activity, type Availability, type Chord, type DesktopDriver, type FocusInfo, type Snapshot, type WindowInfo,
  OwnInput, checkFileName, chordText, parseChord, refuse } from '../driver.ts';
import { BAD_ACCESS, BAD_MATCH, MOD, X11Client, XI, encodePng, isGone, keyEvent, zpixmapToRgb } from './protocol.ts';

export type X11DriverOptions = { display?: string; env?: Record<string, string | undefined>; excludePids?: number[]; timeoutMs?: number };
type Described = WindowInfo & { readonly num: number; readonly transientFor: number; readonly overrideRedirect: boolean; readonly mapState: number };

const KEYSYM: Record<string, number> = {
  enter: 0xff0d, escape: 0xff1b, tab: 0xff09, left: 0xff51, up: 0xff52, right: 0xff53, down: 0xff54, home: 0xff50, end: 0xff57,
  pageup: 0xff55, pagedown: 0xff56, space: 0x20, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, 0xffbe + i])),
};
const MOD_KEYSYM = { ctrl: 0xffe3, alt: 0xffe9, shift: 0xffe1 } as const;
const PAUSE = 0xff13;
/** Ctrl+Alt, also with CapsLock, NumLock and both, so lock keys never break the stop key. */
const STOP_MODS = [MOD.Control | MOD.Mod1].flatMap(m => [m, m | MOD.Lock, m | MOD.Mod2, m | MOD.Lock | MOD.Mod2]);
const LIMIT = 100, TITLE_MAX = 400, SNAP_MAX = 4096;
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, TITLE_MAX);
const hex = (n: number) => `0x${n.toString(16)}`;
const parseId = (id: unknown): number => {
  if (typeof id !== 'string' || !/^0x[0-9a-f]{1,8}$/.test(id)) refuse('WINDOW_NOT_FOUND', 'This window cannot be found.');
  return Number.parseInt(id.slice(2), 16);
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Keycode (and whether Shift is needed) for a keysym, from GetKeyboardMapping. */
async function keycodeFor(c: X11Client, keysym: number): Promise<{ code: number; shift: boolean }> {
  const map = await c.getKeyboardMapping();
  for (const col of [0, 1]) {
    for (let k = 0; k * map.perKeycode < map.keysyms.length; k++) {
      if (map.perKeycode > col && map.keysyms[k * map.perKeycode + col] === keysym) return { code: map.min + k, shift: col === 1 };
    }
  }
  refuse('DRIVER_FAILED', 'This keyboard has no key Chausar needs.');
}

export class X11Driver implements DesktopDriver {
  readonly platform = 'x11' as const;
  readonly #display: string | undefined; readonly #env: Record<string, string | undefined>; readonly #exclude: Set<number>; readonly #timeoutMs: number;
  #client: Promise<X11Client> | null = null;
  readonly #own = new OwnInput();
  readonly #watches = new Set<{ close(): void }>();

  constructor(options: X11DriverOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#display = options.display ?? this.#env.DISPLAY;
    this.#exclude = new Set(options.excludePids ?? []);
    this.#timeoutMs = options.timeoutMs ?? 5000;
  }

  async #open(): Promise<X11Client> {
    const c = await X11Client.open(this.#display, this.#env, this.#timeoutMs);
    try {
      const xtest = await c.xtestVersion();
      if (!xtest || xtest.major < 2) refuse('DRIVER_UNAVAILABLE', 'This display does not accept input from Chausar.');
    } catch (e) { c.close(); throw e; }
    return c;
  }
  #conn(): Promise<X11Client> {
    if (this.#client) {
      const current = this.#client;
      return current.then(c => (c.closed ? ((this.#client = null), this.#conn()) : c));
    }
    const opening = this.#open();
    this.#client = opening;
    opening.catch(() => { if (this.#client === opening) this.#client = null; });
    return opening;
  }

  async available(): Promise<Availability> {
    try { await this.#conn(); return { ok: true }; } catch (e) {
      const known = e instanceof ChausarError && /^DRIVER_UNAVAILABLE$/.test(e.code);
      return { ok: false, code: 'DRIVER_UNAVAILABLE', reason: known ? e.message : "This computer's display cannot be reached." };
    }
  }

  async #text(c: X11Client, win: number, name: string, type: number, utf8: boolean): Promise<string | null> {
    const p = await c.getProperty(win, await c.internAtom(name), type);
    return p && p.format === 8 ? p.value.toString(utf8 ? 'utf8' : 'latin1') : null;
  }
  async #describe(c: X11Client, num: number): Promise<Described | null> {
    try {
      const [attrs, utf8] = await Promise.all([c.getWindowAttributes(num), c.internAtom('UTF8_STRING')]);
      const [netName, wmName, wmClass, pidProp, transient] = await Promise.all([
        this.#text(c, num, '_NET_WM_NAME', utf8, true), this.#text(c, num, 'WM_NAME', 0, false), this.#text(c, num, 'WM_CLASS', 0, false),
        c.internAtom('_NET_WM_PID').then(a => c.getProperty(num, a, 6, 1)), c.getProperty(num, 68, 33, 1),
      ]);
      const app = clean((wmClass ?? '').split('\0')[1] ?? '') || 'unknown';
      const pid = pidProp && pidProp.format === 32 && pidProp.value.length >= 4 ? pidProp.value.readUInt32LE(0) : null;
      return { id: hex(num), num, title: clean(netName || wmName || ''), app, pid, mapState: attrs.mapState, overrideRedirect: attrs.overrideRedirect,
        transientFor: transient && transient.value.length >= 4 ? transient.value.readUInt32LE(0) : 0 };
    } catch (e) { if (isGone(e)) return null; throw e; }
  }
  /** _NET_CLIENT_LIST from the window manager, or null when none is running. */
  async #clientList(c: X11Client): Promise<number[] | null> {
    const p = await c.getProperty(c.setup.root, await c.internAtom('_NET_CLIENT_LIST'), 33);
    if (!p || p.format !== 32) return null;
    return Array.from({ length: p.value.length / 4 }, (_, i) => p.value.readUInt32LE(i * 4));
  }
  /** Top-level windows: the WM's client list, else the root's viewable titled children (one level down for frames). */
  async #candidates(c: X11Client): Promise<Described[]> {
    const listed = await this.#clientList(c);
    if (listed) return (await Promise.all(listed.map(w => this.#describe(c, w)))).filter((d): d is Described => d !== null);
    const { children } = await c.queryTree(c.setup.root);
    const found = await Promise.all(children.map(async w => {
      const d = await this.#describe(c, w);
      if (!d || d.mapState !== 2 || d.overrideRedirect) return null;
      if (d.title) return d;
      try {
        const inner = await Promise.all((await c.queryTree(w)).children.map(k => this.#describe(c, k)));
        return inner.find(k => k && k.mapState === 2 && k.title && !k.overrideRedirect) ?? null;
      } catch (e) { if (isGone(e)) return null; throw e; }
    }));
    return found.filter((d): d is Described => d !== null);
  }
  async #listed(c: X11Client): Promise<Described[]> {
    return (await this.#candidates(c)).filter(d => d.title && !d.overrideRedirect && !(d.pid !== null && this.#exclude.has(d.pid))).slice(0, LIMIT);
  }
  #public = (d: Described): WindowInfo => ({ id: d.id, title: d.title, app: d.app, pid: d.pid });

  async listWindows(): Promise<WindowInfo[]> { return (await this.#listed(await this.#conn())).map(this.#public); }

  async windowInfo(id: string): Promise<WindowInfo | null> {
    const num = parseId(id); const c = await this.#conn();
    const d = await this.#describe(c, num);
    if (!d) return null;
    if (d.mapState === 0 && !((await this.#clientList(c)) ?? []).includes(num)) return null;
    return this.#public(d);
  }

  async related(id: string): Promise<WindowInfo[]> {
    const num = parseId(id); const c = await this.#conn();
    const base = await this.#describe(c, num);
    if (!base) return [];
    return (await this.#listed(c)).filter(d => d.num !== num && (d.transientFor === num || (base.pid !== null && d.pid === base.pid))).map(d => ({ ...this.#public(d), owned: d.transientFor === num }));
  }

  async focus(id: string): Promise<void> {
    const num = parseId(id); const c = await this.#conn();
    const d = await this.#describe(c, num);
    if (!d || d.mapState !== 2 && !((await this.#clientList(c)) ?? []).includes(num)) refuse('WINDOW_NOT_FOUND', 'This window cannot be found.');
    const active = await c.internAtom('_NET_ACTIVE_WINDOW');
    const supported = await c.getProperty(c.setup.root, await c.internAtom('_NET_SUPPORTED'), 4);
    const viaWm = !!supported && supported.format === 32 && Array.from({ length: supported.value.length / 4 }, (_, i) => supported.value.readUInt32LE(i * 4)).includes(active);
    const direct = async () => {
      try { await c.raise(num); await c.setInputFocus(num, 2); } catch (e) {
        if (isGone(e)) refuse('WINDOW_NOT_FOUND', 'This window cannot be found.');
        if (e instanceof Error && 'xcode' in e && e.xcode === BAD_MATCH) refuse('DRIVER_FAILED', 'The window cannot take focus now.');
        throw e;
      }
    };
    if (viaWm) await c.sendClientMessage(c.setup.root, num, active, [2, 0, 0, 0, 0]); else await direct();
    for (let tries = 0; tries < 40; tries++) {
      if ((await this.focused()).windowId === hex(num)) return;
      if (viaWm && tries === 20) await direct().catch(() => {});
      await sleep(25);
    }
    refuse('DRIVER_FAILED', 'The window did not take focus.');
  }

  async focused(): Promise<FocusInfo> {
    const c = await this.#conn();
    const { focus } = await c.getInputFocus();
    if (focus <= 1) return { windowId: null, secret: null };
    try {
      const chain: number[] = [];
      for (let w = focus; w && w !== c.setup.root && chain.length < 64; w = (await c.queryTree(w)).parent) chain.push(w);
      if (!chain.length) return { windowId: null, secret: null };
      const known = new Set((await this.#candidates(c)).map(d => d.num));
      return { windowId: hex(chain.find(w => known.has(w)) ?? chain[chain.length - 1]), secret: null };
    } catch (e) { if (isGone(e)) return { windowId: null, secret: null }; throw e; }
  }

  readonly stopKey = 'Ctrl Alt Pause';
  async press(chord: Chord, live: () => boolean = () => true): Promise<void> {
    const checked = parseChord(chordText(chord));
    const c = await this.#conn();
    const mods = await Promise.all(checked.modifiers.map(m => keycodeFor(c, MOD_KEYSYM[m])));
    const sym = KEYSYM[checked.key] ?? checked.key.charCodeAt(0);
    const key = await keycodeFor(c, sym);
    const extraShift = key.shift && !checked.modifiers.includes('shift') ? [await keycodeFor(c, MOD_KEYSYM.shift)] : [];
    const held = [...mods, ...extraShift];
    await this.#own.around(async () => {
      const down: number[] = [];
      try {
        for (const m of held) { stillLive(live); await c.fakeInput(2, m.code); down.push(m.code); }
        stillLive(live); await c.fakeInput(2, key.code); await c.fakeInput(3, key.code);
      } finally { for (const code of down.reverse()) await c.fakeInput(3, code).catch(() => {}); }
      await c.getInputFocus();
    });
  }

  async typeFileName(name: string, live: () => boolean = () => true): Promise<void> {
    const text = checkFileName(name);
    if (!/^[a-z0-9.-]+$/.test(text)) refuse('DRIVING_TEXT_REFUSED', 'Chausar types only the export file name it made.');
    const c = await this.#conn();
    const shift = await keycodeFor(c, MOD_KEYSYM.shift);
    const keys = await Promise.all([...text].map(ch => keycodeFor(c, ch.charCodeAt(0))));
    await this.#own.around(async () => {
      for (const k of keys) {
        stillLive(live);
        if (k.shift) await c.fakeInput(2, shift.code);
        await c.fakeInput(2, k.code); await c.fakeInput(3, k.code);
        if (k.shift) await c.fakeInput(3, shift.code);
      }
      await c.getInputFocus();
    });
  }

  async snapshot(id: string): Promise<Snapshot> {
    const num = parseId(id); const c = await this.#conn();
    try {
      const [geo, attrs] = await Promise.all([c.getGeometry(num), c.getWindowAttributes(num)]);
      if (geo.width > SNAP_MAX || geo.height > SNAP_MAX) refuse('DRIVER_FAILED', 'This window is too large to picture.');
      if (attrs.mapState !== 2) refuse('DRIVER_FAILED', 'The window cannot be pictured now.');
      const image = await c.getImage(num, 0, 0, geo.width, geo.height);
      const rgb = zpixmapToRgb(c.setup, image.depth, image.visual || attrs.visual, image.data, geo.width, geo.height);
      return { width: geo.width, height: geo.height, png: encodePng(geo.width, geo.height, rgb) };
    } catch (e) {
      if (isGone(e)) refuse('WINDOW_NOT_FOUND', 'This window cannot be found.');
      if (e instanceof Error && 'xcode' in e && e.xcode === BAD_MATCH) refuse('DRIVER_FAILED', 'The window must be fully on screen to take its picture.');
      throw e;
    }
  }

  async watch(onActivity: (activity: Activity) => void): Promise<{ close(): void }> {
    const c = await X11Client.open(this.#display, this.#env, this.#timeoutMs);
    const root = c.setup.root; let pause = 0; let timer: NodeJS.Timeout | null = null; let closed = false;
    const report = (kind: Activity['kind']) => { if (!closed && (kind === 'stop-key' || !this.#own.ours())) onActivity({ kind, at: Date.now() }); };
    try {
      pause = (await keycodeFor(c, PAUSE)).code;
      for (const m of STOP_MODS) await c.grabKey(root, pause, m);
    } catch (e) {
      c.close();
      if (e instanceof Error && 'xcode' in e && e.xcode === BAD_ACCESS) refuse('DRIVER_FAILED', 'Another program holds the stop key.');
      throw e;
    }
    // A watch that can no longer see the person or hold the stop key ends the session.
    c.onClose = () => report('stop-key');
    c.onEvent = event => {
      const key = keyEvent(event);
      if (key && event.type === 2 && key.keycode === pause && !event.sent) return report('stop-key');
      const raw = c.rawEvent(event);
      if (raw) report(raw.evtype === XI.RawKeyPress ? 'key' : raw.evtype === XI.RawButtonPress ? 'button' : 'pointer');
    };
    const xi = await c.xiQueryVersion(2, 2).catch(() => null);
    const raw = !!xi && xi.major >= 2 && await c.xiSelectEvents(root, XI.AllMasterDevices, [XI.RawKeyPress, XI.RawButtonPress, XI.RawMotion]).then(() => true, () => false);
    if (!raw) {
      let last: { x: number; y: number; mask: number; keys: Buffer } | null = null; let busy = false; let failures = 0;
      timer = setInterval(async () => {
        if (busy || closed) return; busy = true;
        try {
          const [p, keys] = await Promise.all([c.queryPointer(root), c.queryKeymap()]);
          if (last) {
            if (!keys.equals(last.keys)) report('key');
            if ((p.mask & 0x1f00) !== (last.mask & 0x1f00)) report('button');
            if (p.x !== last.x || p.y !== last.y) report('pointer');
          }
          last = { x: p.x, y: p.y, mask: p.mask, keys }; failures = 0;
        } catch { if (++failures >= 5) report('stop-key'); } finally { busy = false; }
      }, 50);
    }
    const handle = {
      close: () => {
        if (closed) return; closed = true; this.#watches.delete(handle); c.onClose = () => {};
        if (timer) clearInterval(timer);
        if (c.closed) return;
        Promise.all(STOP_MODS.map(m => c.ungrabKey(root, pause, m))).catch(() => {}).finally(() => c.close());
      },
    };
    this.#watches.add(handle);
    return handle;
  }

  async close(): Promise<void> {
    for (const w of [...this.#watches]) w.close();
    const client = this.#client; this.#client = null;
    if (client) await client.then(c => c.close(), () => {});
  }
}

function stillLive(live: () => boolean) { if (!live()) refuse('DRIVING_STOPPED', 'Chausar stopped before this key.'); }
