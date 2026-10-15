/**
 * The shared JSON-lines client for the Windows and macOS desktop helpers (WK-14, experimental).
 *
 * Each OS driver keeps ONE long-lived helper process (PowerShell with an embedded C# class on
 * Windows, osascript running JXA on macOS). The script is written to a private temp directory
 * (mkdtemp, mode 0600) and run as a file, because the helper's stdin carries the requests:
 *   request  {"id":n,"op":"…","args":{…}}
 *   reply    {"id":n,"ok":true,"result":…} or {"id":n,"ok":false,"code":"DRIVER_FAILED"}
 *   event    {"event":"pointer"|"key"|"button"|"stop-key"} (only while watching)
 *
 * Nothing the helper says is trusted: every reply field is checked here, error codes pass only
 * from a fixed list (sentences are always Chausar's own), and a broken line, a line over 8 MB or
 * an unknown event ends the helper. A timeout ends the helper too (a hung UI Automation or
 * Accessibility call cannot be cancelled) and the next request starts a fresh one. If the helper
 * ends while the person is being watched, the watch reports the stop key: a session that can no
 * longer see the person or the stop key must stop.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import { OwnInput, checkFileName, chordText, parseChord, type Activity, type Availability, type Chord, type DesktopDriver,
  type DriverPlatform, type FocusInfo, type Snapshot, type WindowInfo } from './driver.ts';

export type HelperSpawn = (command: string, args: readonly string[]) => ChildProcess;
export type HelperDriverOptions = { spawn?: HelperSpawn; excludePids?: number[]; timeoutMs?: number };
type EventKind = Activity['kind'];

export const HELPER_MAX_LINE = 8 * 1024 * 1024;
export const HELPER_MAX_PNG = 6 * 1024 * 1024;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
/** The only codes a helper may pass through, each with Chausar's own sentence. */
export const HELPER_CODES: Readonly<Record<string, string>> = Object.freeze({
  DRIVER_FAILED: 'The desktop helper could not do this.',
  DRIVER_UNAVAILABLE: 'The desktop helper is not running.',
  DRIVER_TIMEOUT: 'The desktop helper did not answer in time.',
  DRIVER_REPLY_INVALID: 'The desktop helper gave an answer Chausar cannot use.',
  DRIVER_PERMISSION_REQUIRED: 'Allow Chausar in System Settings, Privacy and Security, Accessibility.',
  DRIVER_WINDOW_GONE: 'The window has closed.',
  DRIVER_FOCUS_REFUSED: 'The window could not be brought to the front.',
  DRIVER_SNAPSHOT_FAILED: 'Chausar could not take a picture of the window.',
  DRIVING_KEY_REFUSED: 'This key is not allowed while driving.',
  DRIVING_TEXT_REFUSED: 'Chausar types only the export file name it made.',
});
const EVENTS = new Set<EventKind>(['pointer', 'key', 'button', 'stop-key']);
const fail = (code: string) => new ChausarError(code, HELPER_CODES[code] ?? HELPER_CODES.DRIVER_FAILED);
const passCode = (value: unknown) => typeof value === 'string' && CODE.test(value) && Object.hasOwn(HELPER_CODES, value) ? value : 'DRIVER_FAILED';
const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };
export type HelperLaunch = () => ChildProcess;

/** One helper process speaking JSON lines; started on the first request, again after it ends. */
export class HelperClient {
  #child: ChildProcess | null = null; #chunks: string[] = []; #size = 0; #next = 1;
  readonly #pending = new Map<number, Pending>();
  private readonly options: { launch: HelperLaunch; timeoutMs: number; onEvent(kind: EventKind): void; onEnd(): void };
  constructor(options: HelperClient['options']) { this.options = options; }

  request(op: string, args: Record<string, unknown> = {}, timeoutMs = this.options.timeoutMs): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try { child = this.#start(); } catch { reject(fail('DRIVER_UNAVAILABLE')); return; }
      const id = this.#next++;
      const timer = setTimeout(() => { if (this.#pending.delete(id)) { reject(fail('DRIVER_TIMEOUT')); this.#end(child, 'DRIVER_UNAVAILABLE'); } }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin!.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }
  get running() { return this.#child !== null; }
  close() { if (this.#child) this.#end(this.#child, 'DRIVER_UNAVAILABLE'); }

  #start(): ChildProcess {
    if (this.#child) return this.#child;
    const child = this.options.launch();
    check(child.stdin && child.stdout, 'DRIVER_UNAVAILABLE', HELPER_CODES.DRIVER_UNAVAILABLE);
    this.#child = child; this.#chunks = []; this.#size = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.#data(child, chunk));
    child.stderr?.resume();
    child.stdin.on('error', () => this.#end(child, 'DRIVER_UNAVAILABLE'));
    child.on('error', () => this.#end(child, 'DRIVER_UNAVAILABLE'));
    child.on('exit', () => this.#end(child, 'DRIVER_UNAVAILABLE'));
    return child;
  }
  #end(child: ChildProcess, code: string) {
    if (this.#child !== child) return;
    this.#child = null; this.#chunks = []; this.#size = 0;
    try { child.kill(); } catch { /* already gone */ }
    for (const [id, pending] of this.#pending) { clearTimeout(pending.timer); this.#pending.delete(id); pending.reject(fail(code)); }
    this.options.onEnd();
  }
  #data(child: ChildProcess, chunk: string) {
    let at = chunk.indexOf('\n');
    while (at >= 0 && this.#child === child) {
      const line = this.#chunks.join('') + chunk.slice(0, at);
      this.#chunks = []; this.#size = 0; chunk = chunk.slice(at + 1);
      if (line.length > HELPER_MAX_LINE) return this.#end(child, 'DRIVER_REPLY_INVALID');
      this.#line(child, line.replace(/\r$/, ''));
      at = chunk.indexOf('\n');
    }
    if (this.#child !== child || !chunk) return;
    this.#chunks.push(chunk); this.#size += chunk.length;
    if (this.#size > HELPER_MAX_LINE) this.#end(child, 'DRIVER_REPLY_INVALID');
  }
  #line(child: ChildProcess, line: string) {
    if (!line.trim()) return;
    let message: unknown;
    try { message = JSON.parse(line); } catch { return this.#end(child, 'DRIVER_REPLY_INVALID'); }
    if (!plain(message)) return this.#end(child, 'DRIVER_REPLY_INVALID');
    if ('event' in message) {
      if (!EVENTS.has(message.event as EventKind) || 'id' in message) return this.#end(child, 'DRIVER_REPLY_INVALID');
      return this.options.onEvent(message.event as EventKind);
    }
    if (!Number.isSafeInteger(message.id)) return this.#end(child, 'DRIVER_REPLY_INVALID');
    const pending = this.#pending.get(message.id as number);
    if (!pending) return;
    this.#pending.delete(message.id as number); clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result);
    else if (message.ok === false) pending.reject(fail(passCode(message.code)));
    else pending.reject(fail('DRIVER_REPLY_INVALID'));
  }
}

// ---- reply checks ---------------------------------------------------------------------------
const WINDOW_ID = /^0x[0-9a-f]{1,16}$/;
const STRIP = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function invalid(): never { throw fail('DRIVER_REPLY_INVALID'); }
const replyId = (value: unknown) => typeof value === 'string' && WINDOW_ID.test(value) ? value : invalid();
const replyText = (value: unknown) => typeof value === 'string' && value.length <= 400 ? value.replace(STRIP, '') : invalid();
const replyPid = (value: unknown) => value === null ? null : Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 0x7fffffff ? value as number : invalid();
const replyFlag = (value: unknown) => value === null || typeof value === 'boolean' ? value : invalid();
const replyDone = (value: unknown) => { if (value !== true) invalid(); };
function replyWindow(value: unknown): WindowInfo {
  if (!plain(value)) invalid();
  const owned = value.owned === undefined ? undefined : typeof value.owned === 'boolean' ? value.owned : invalid();
  return Object.freeze({ id: replyId(value.id), title: replyText(value.title), app: replyText(value.app), pid: replyPid(value.pid), ...(owned === undefined ? {} : { owned }) });
}
function replyWindows(value: unknown): WindowInfo[] {
  if (!Array.isArray(value) || value.length > 4096) invalid();
  const seen = new Set<string>();
  return value.map(replyWindow).filter(w => !seen.has(w.id) && !!seen.add(w.id));
}
function replySnapshot(value: unknown): Snapshot {
  if (!plain(value)) invalid();
  const { width, height, png } = value;
  const side = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= 16384;
  if (!side(width) || !side(height) || typeof png !== 'string' || png.length > HELPER_MAX_LINE || png.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(png)) invalid();
  const bytes = Buffer.from(png, 'base64');
  // Signature, then the IHDR chunk (length 13) whose width and height must match the reply.
  if (bytes.length < 33 || bytes.length > HELPER_MAX_PNG || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13
    || bytes.toString('latin1', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) invalid();
  return Object.freeze({ width: width as number, height: height as number, png: bytes });
}
const windowArg = (id: string) => { check(typeof id === 'string' && WINDOW_ID.test(id), 'DRIVER_WINDOW_GONE', HELPER_CODES.DRIVER_WINDOW_GONE); return id; };

/** A driver that does its work in one helper process. Windows and macOS differ only in the helper. */
export abstract class HelperDriver implements DesktopDriver {
  abstract readonly platform: DriverPlatform;
  readonly #own = new OwnInput();
  readonly #listeners = new Set<(activity: Activity) => void>();
  readonly #exclude: ReadonlySet<number>;
  readonly #client: HelperClient;
  #dir: string | null = null;

  /** True when the helper itself drops injected input (Windows low-level hooks): then the person is never muted. */
  readonly #filtersInjected: boolean;
  protected constructor(options: HelperDriverOptions, helper: { command: string; args(scriptPath: string): string[]; scriptName: string; script: string; filtersInjected?: boolean }) {
    this.#filtersInjected = helper.filtersInjected === true;
    this.#exclude = new Set([process.pid, ...(options.excludePids ?? [])]);
    const spawn = options.spawn ?? ((command, args) => nodeSpawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));
    const launch = () => {
      this.#dir ??= mkdtempSync(join(tmpdir(), 'chausar-driver-'));
      const path = join(this.#dir, helper.scriptName);
      writeFileSync(path, helper.script, { mode: 0o600 });
      return spawn(helper.command, helper.args(path));
    };
    this.#client = new HelperClient({ launch, timeoutMs: options.timeoutMs ?? 15000, onEvent: kind => this.#event(kind), onEnd: () => this.#lost() });
  }

  async available(): Promise<Availability> {
    try {
      replyDone(await this.#client.request('available'));
      return { ok: true };
    } catch (error) {
      const code = error instanceof ChausarError && Object.hasOwn(HELPER_CODES, error.code) ? error.code : 'DRIVER_UNAVAILABLE';
      return { ok: false, code, reason: HELPER_CODES[code] };
    }
  }
  async listWindows() { return replyWindows(await this.#client.request('list')).filter(w => this.#shown(w)); }
  async windowInfo(id: string) {
    const result = await this.#client.request('info', { id: windowArg(id) });
    if (result === null) return null;
    const window = replyWindow(result);
    if (window.id !== id) invalid();
    return this.#shown(window) ? window : null;
  }
  async related(id: string) { return replyWindows(await this.#client.request('related', { id: windowArg(id) })).filter(w => w.id !== id && this.#shown(w)); }
  async focus(id: string) { replyDone(await this.#client.request('focus', { id: windowArg(id) })); }
  async focused(): Promise<FocusInfo> {
    const result = await this.#client.request('focused');
    if (!plain(result)) invalid();
    return Object.freeze({ windowId: result.windowId === null ? null : replyId(result.windowId), secret: replyFlag(result.secret) });
  }
  // The helper sends a whole chord or name in one go, so `live` is asked just before handing it over.
  async press(chord: Chord, live: () => boolean = () => true) {
    const checked = parseChord(chordText(chord));
    check(live(), 'DRIVING_STOPPED', 'Chausar stopped before this key.');
    await this.#own.around(async () => replyDone(await this.#client.request('press', { modifiers: [...checked.modifiers], key: checked.key })));
  }
  async typeFileName(name: string, live: () => boolean = () => true) {
    const checked = checkFileName(name);
    check(live(), 'DRIVING_STOPPED', 'Chausar stopped before this key.');
    await this.#own.around(async () => replyDone(await this.#client.request('type', { name: checked })));
  }
  async snapshot(id: string) { return replySnapshot(await this.#client.request('snapshot', { id: windowArg(id) })); }
  async watch(onActivity: (activity: Activity) => void) {
    const first = this.#listeners.size === 0;
    this.#listeners.add(onActivity);
    if (first) {
      try { replyDone(await this.#client.request('watch')); } catch (error) { this.#listeners.delete(onActivity); throw error; }
    }
    return { close: () => {
      if (!this.#listeners.delete(onActivity) || this.#listeners.size > 0 || !this.#client.running) return;
      this.#client.request('unwatch').catch(() => { /* the helper ending ends the watch too */ });
    } };
  }
  async close() {
    this.#listeners.clear();
    this.#client.close();
    if (this.#dir) { rmSync(this.#dir, { recursive: true, force: true }); this.#dir = null; }
  }

  #shown(window: WindowInfo) { return window.pid === null || !this.#exclude.has(window.pid); }
  #event(kind: EventKind) {
    // Never mute the stop key; mute pointer, key and button while our own input is in flight.
    if (kind !== 'stop-key' && !this.#filtersInjected && this.#own.ours()) return;
    this.#emit(kind);
  }
  #emit(kind: EventKind) {
    const activity = Object.freeze({ kind, at: Date.now() });
    for (const listener of [...this.#listeners]) { try { listener(activity); } catch { /* a listener cannot break the watch */ } }
  }
  #lost() {
    if (this.#listeners.size === 0) return;
    this.#emit('stop-key');
    this.#listeners.clear();
  }
}
