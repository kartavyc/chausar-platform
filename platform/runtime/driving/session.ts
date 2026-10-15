/**
 * The driving session (WK-14, experimental): one window, read and export only, while the
 * person watches.
 *
 * The controller lives in the engine process with the desktop driver. It runs a plan's steps
 * one at a time and checks the rules before every step and before every key:
 *
 * - one window only: input goes only to the chosen window or a dialog of the same program;
 *   anything else taking focus pauses the session;
 * - a sign-in, one-time code or captcha (by title, or a password field that has focus) hands
 *   over to the person: "Sign in yourself. Chausar continues after.";
 * - a payment, edit or delete screen stops the session;
 * - any input the person makes pauses it at once; the stop key, the strip and the tray stop it;
 * - the workspace locking or changing stops it.
 *
 * Reasons are fixed sentences. Window titles are shown as data in `window.title` and are never
 * copied into a reason, a step or an error.
 */
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, copyFile, unlink, stat, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { check } from '../contracts.ts';
import { FORBIDDEN_SCREEN, SIGN_IN, type Activity, type DesktopDriver, type DriverPlatform, type WindowInfo } from './driver.ts';
import type { Plan } from './plans.ts';

export const STATES = ['idle', 'driving', 'sign-in', 'paused-by-you', 'stopped-by-key', 'stopped', 'step-failed', 'done'] as const;
export type DrivingState = typeof STATES[number];
export const ACTIVE: readonly DrivingState[] = ['driving', 'sign-in', 'paused-by-you'];
export type Step = { at: string; text: string; state: 'done' | 'running' | 'failed' };
export type ExportFile = { id: string; sessionId: string; workspaceId: string; name: string; mediaType: string; bytes: number; sha256: string; at: string; path: string };
export type SessionRecord = {
  id: string; workspaceId: string; memberId: string; window: { id: string; title: string; app: string }; plan: string;
  startedAt: string; endedAt: string | null; state: DrivingState; reason: string | null; steps: Step[]; exports: ExportFile[];
};
export const STOP_KEY = 'Ctrl Alt Pause';

/** Fixed sentences; nothing from outside the app is ever put into one. */
export const REASONS = {
  moved: 'You moved the mouse or typed. Paused.',
  focus: 'Another window came to the front. Paused.',
  signIn: 'Sign in yourself. Chausar continues after.',
  secret: 'A password box has focus. Sign in yourself. Chausar continues after.',
  forbidden: 'This looks like a payment or edit screen. Chausar stopped and changed nothing.',
  closed: 'The window closed.',
  key: 'Stopped by your key.',
  stopped: 'Stopped.',
  locked: 'The workspace locked or changed. Chausar stopped.',
  timeout: 'A step took too long.',
  fileMissing: 'The exported file did not appear.',
  tooLong: 'The session took too long and stopped.',
  driver: 'The window could not be driven.',
  done: 'Finished.',
} as const;
const MEDIA: Readonly<Record<string, string>> = { png: 'image/png', csv: 'text/csv', xml: 'application/xml', json: 'application/json', txt: 'text/plain', html: 'text/html',
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };
export const EXPORT_NAME = /^chausar-export-[a-z0-9]{6,32}\.(png|csv|xml|xlsx|xls|txt|pdf|json|html)$/;
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

class Halt extends Error { readonly state: DrivingState; readonly reason: string; constructor(state: DrivingState, reason: string) { super(reason); this.state = state; this.reason = reason; } }

export type ControllerOptions = {
  driver: DesktopDriver | null;
  /** Why there is no driver (shown as the plain reason), when `driver` is null. */
  unavailable?: { code: string; reason: string };
  /** `<directory>/driving-exports`: exports are kept here per workspace and session. */
  exportRoot: string;
  plans: readonly Plan[];
  /** Told on every state change (the desktop strip and tray listen through the worker). */
  notify?: (state: DrivingState, active: boolean) => void;
  /** Folders searched for a plan's exact export name besides the session folder. */
  searchFolders?: readonly string[];
  pollMs?: number; sessionLimitMs?: number;
  /** Pointer moves this soon after Start are the hand leaving the Start button, not a pause. */
  startGraceMs?: number;
};

export class DrivingController {
  #current: SessionRecord | null = null;
  #last: SessionRecord | null = null;
  #wake: (() => void) | null = null;
  #watch: { close(): void } | null = null;
  #run: Promise<void> | null = null;
  #probe: () => boolean = () => true;
  #finished: ((record: SessionRecord) => void) | null = null;
  #startedAt = 0;
  readonly poll: number; readonly limit: number; readonly options: ControllerOptions;
  constructor(options: ControllerOptions) { this.options = options; this.poll = options.pollMs ?? 250; this.limit = options.sessionLimitMs ?? 15 * 60_000; }

  get platform(): DriverPlatform | null { return this.options.driver?.platform ?? null; }
  async availability(): Promise<{ ok: boolean; code: string | null; reason: string | null }> {
    if (!this.options.driver) return { ok: false, code: this.options.unavailable?.code ?? 'DRIVER_UNAVAILABLE', reason: this.options.unavailable?.reason ?? 'Driving works only in the installed desktop app.' };
    const a = await this.options.driver.available();
    return a.ok ? { ok: true, code: null, reason: null } : { ok: false, code: a.code, reason: a.reason };
  }
  async driver(): Promise<DesktopDriver> {
    const a = await this.availability();
    check(a.ok && this.options.driver, a.code ?? 'DRIVER_UNAVAILABLE', a.reason ?? 'Driving is not available on this computer.');
    return this.options.driver;
  }
  /** The session now: the running one, else the last one in this engine, else idle. */
  status(workspaceId: string | null): SessionRecord | null {
    const record = this.#current ?? this.#last;
    return record && record.workspaceId === workspaceId ? record : null;
  }
  get active(): SessionRecord | null { return this.#current; }

  async windows(): Promise<WindowInfo[]> {
    const driver = await this.driver();
    return (await driver.listWindows()).slice(0, 100);
  }

  /**
   * Start one session. `probe` answers whether the same workspace is still open; `finished`
   * records the session once it ends.
   */
  async start(input: { windowId: string; plan: Plan; workspaceId: string; memberId: string; probe: () => boolean; finished: (record: SessionRecord) => void }): Promise<SessionRecord> {
    check(!this.#current, 'SESSION_ACTIVE', 'Chausar is already driving a window. Stop it first.');
    const driver = await this.driver();
    check(input.plan.verified, 'DRIVING_PLAN_UNVERIFIED', 'This plan has not been checked against the real program yet, so Chausar does not run it.');
    const window = await driver.windowInfo(input.windowId);
    check(window, 'WINDOW_NOT_FOUND', 'That window is no longer open. Choose it again.');
    check(input.plan.app === null || input.plan.app.test(window.app), 'DRIVING_PLAN_MISMATCH', 'This plan is for another program.');
    check(!this.#current, 'SESSION_ACTIVE', 'Chausar is already driving a window. Stop it first.');
    const record: SessionRecord = { id: `drive_${randomBytes(9).toString('hex')}`, workspaceId: input.workspaceId, memberId: input.memberId, window: { id: window.id, title: window.title, app: window.app },
      plan: input.plan.id, startedAt: new Date().toISOString(), endedAt: null, state: 'driving', reason: null, steps: [], exports: [] };
    this.#current = record; this.#probe = input.probe; this.#finished = input.finished; this.#startedAt = Date.now();
    try {
      this.#watch = await driver.watch(activity => this.#activity(activity));
    } catch (error) { this.#current = null; throw error; }
    this.#notify();
    this.#run = this.#execute(driver, record, input.plan).catch(() => {});
    return record;
  }

  /** Stop now. Safe to call at any time; the key, strip, tray and screens all come here. */
  stop(by: 'person' | 'key' | 'lock' = 'person'): SessionRecord | null {
    const record = this.#current;
    if (!record) return null;
    this.#end(record, by === 'key' ? 'stopped-by-key' : 'stopped', by === 'key' ? REASONS.key : by === 'lock' ? REASONS.locked : REASONS.stopped);
    return record;
  }

  /** Continue after "Paused" or after signing in. */
  resume(): SessionRecord {
    const record = this.#current;
    check(record && (record.state === 'paused-by-you' || record.state === 'sign-in'), 'SESSION_NOT_PAUSED', 'There is no paused session to continue.');
    record.state = 'driving'; record.reason = null;
    this.#notify(); this.#wake?.();
    return record;
  }

  /** Waits for the running plan to finish (tests and shutdown). */
  async settled(): Promise<void> { await this.#run; }

  #activity(activity: Activity) {
    const record = this.#current;
    if (!record) return;
    if (activity.kind === 'stop-key') { this.stop('key'); return; }
    if (activity.kind === 'pointer' && Date.now() - this.#startedAt < (this.options.startGraceMs ?? 1000)) return;
    // While the person signs in, their typing is expected.
    if (record.state === 'driving') this.#pause(record, REASONS.moved);
  }
  #pause(record: SessionRecord, reason: string) {
    if (record.state !== 'driving') return;
    record.state = 'paused-by-you'; record.reason = reason;
    this.#step(record, reason, 'done');
    this.#notify();
  }
  #end(record: SessionRecord, state: DrivingState, reason: string) {
    if (this.#current !== record) return;
    for (const step of record.steps) if (step.state === 'running') step.state = state === 'done' ? 'done' : 'failed';
    record.state = state; record.reason = reason; record.endedAt = new Date().toISOString();
    this.#current = null; this.#last = record;
    try { this.#watch?.close(); } catch { /* the watch may already be gone */ }
    this.#watch = null;
    this.#wake?.();
    this.#notify();
    try { this.#finished?.(record); } catch { /* recording is best effort; the session has ended */ }
  }
  #notify() {
    const record = this.#current ?? this.#last;
    const state = record?.state ?? 'idle';
    try { this.options.notify?.(state, ACTIVE.includes(state)); } catch { /* the listener never blocks the session */ }
  }
  #step(record: SessionRecord, text: string, state: Step['state']) {
    if (record.steps.length >= 200) record.steps.shift();
    const step = { at: new Date().toISOString(), text, state };
    record.steps.push(step);
    return step;
  }

  /** Waits while paused or signing in; throws Halt once the session has ended. */
  async #gate(record: SessionRecord, driver: DesktopDriver, deadline: number) {
    for (;;) {
      if (this.#current !== record) throw new Halt(record.state, record.reason ?? REASONS.stopped);
      if (!this.#probe()) { this.#end(record, 'stopped', REASONS.locked); throw new Halt('stopped', REASONS.locked); }
      if (Date.now() > deadline) { this.#end(record, 'step-failed', REASONS.tooLong); throw new Halt('step-failed', REASONS.tooLong); }
      if (record.state === 'driving') {
        await this.#screens(record, driver);
        if (record.state === 'driving') return;
      }
      if (record.state === 'sign-in') {
        await this.#screens(record, driver);
        // A password box that no longer has focus means the person has signed in.
        if (record.state === 'sign-in' && record.reason === REASONS.secret && (await driver.focused()).secret !== true) { record.state = 'driving'; record.reason = null; this.#notify(); continue; }
      }
      await new Promise<void>(accept => { const timer = setTimeout(accept, this.poll); this.#wake = () => { clearTimeout(timer); accept(); }; });
      this.#wake = null;
    }
  }
  /** The window's own title and its dialogs decide: sign-in waits for the person, payment or edit stops. */
  async #screens(record: SessionRecord, driver: DesktopDriver) {
    const window = await driver.windowInfo(record.window.id);
    if (!window) { this.#end(record, 'step-failed', REASONS.closed); throw new Halt('step-failed', REASONS.closed); }
    record.window.title = window.title;
    const titles = [window.title, ...(await driver.related(record.window.id)).map(w => w.title)];
    if (titles.some(title => FORBIDDEN_SCREEN.test(title))) { this.#end(record, 'step-failed', REASONS.forbidden); throw new Halt('step-failed', REASONS.forbidden); }
    const signIn = titles.some(title => SIGN_IN.test(title));
    if (signIn && record.state === 'driving') { record.state = 'sign-in'; record.reason = REASONS.signIn; this.#step(record, REASONS.signIn, 'done'); this.#notify(); }
    else if (!signIn && record.state === 'sign-in' && record.reason === REASONS.signIn) { record.state = 'driving'; record.reason = null; this.#notify(); }
  }
  /** Before any key: the chosen window (or its dialog) has focus and no password box does. */
  async #beforeInput(record: SessionRecord, driver: DesktopDriver, deadline: number) {
    let tries = 0;
    for (;;) {
      await this.#gate(record, driver, deadline);
      const focus = await driver.focused();
      const ours = focus.windowId === record.window.id || (focus.windowId !== null && (await driver.related(record.window.id)).some(w => w.id === focus.windowId));
      if (!ours) {
        // Bring the chosen window back once (after Continue, Chausar's own window has focus); then pause.
        if (tries < 3) { tries += 1; if (tries === 1) await driver.focus(record.window.id); await this.#sleep(this.poll); continue; }
        tries = 0; this.#pause(record, REASONS.focus); continue;
      }
      if (focus.secret === true) {
        if (record.state === 'driving') { record.state = 'sign-in'; record.reason = REASONS.secret; this.#step(record, REASONS.secret, 'done'); this.#notify(); }
        continue;
      }
      if (record.state === 'driving') return;
    }
  }

  async #execute(driver: DesktopDriver, record: SessionRecord, plan: Plan) {
    const deadline = Date.now() + this.limit;
    const folder = this.#folder(record);
    try {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      let fileName: string | null = null;
      for (const planned of plan.steps) {
        await this.#gate(record, driver, deadline);
        const step = this.#step(record, planned.say, 'running');
        switch (planned.kind) {
          case 'focus': await driver.focus(record.window.id); break;
          case 'keys':
            await this.#beforeInput(record, driver, deadline);
            await driver.press(planned.chord);
            await this.#sleep(planned.settleMs);
            break;
          case 'wait-title': await this.#until(record, driver, deadline, planned.timeoutMs, async () => {
            const titles = [(await driver.windowInfo(record.window.id))?.title ?? '', ...(await driver.related(record.window.id)).map(w => w.title)];
            return titles.some(title => planned.pattern.test(title));
          }); break;
          case 'type-file-name':
            fileName = `chausar-export-${randomBytes(8).toString('hex')}.${planned.extension}`;
            await this.#beforeInput(record, driver, deadline);
            await driver.typeFileName(fileName);
            break;
          case 'wait-file': {
            const name = fileName!;
            let found: string | null = null;
            await this.#until(record, driver, deadline, planned.timeoutMs, async () => (found = await this.#find(name, plan, folder)) !== null, REASONS.fileMissing);
            record.exports.push(await this.#keep(record, found!, name, folder));
            break;
          }
          case 'snapshot': {
            await this.#gate(record, driver, deadline);
            const picture = await driver.snapshot(record.window.id);
            const name = `chausar-export-${randomBytes(8).toString('hex')}.png`;
            await writeFile(join(folder, name), picture.png, { mode: 0o600, flag: 'wx' });
            record.exports.push(await this.#keep(record, join(folder, name), name, folder));
            break;
          }
        }
        if (this.#current !== record) return;
        step.state = 'done';
      }
      this.#end(record, 'done', REASONS.done);
    } catch (error) {
      if (error instanceof Halt) return;
      const code = (error as { code?: string })?.code;
      this.#end(record, 'step-failed', code === 'DRIVER_TIMEOUT' ? REASONS.timeout : code === 'WINDOW_NOT_FOUND' ? REASONS.closed : REASONS.driver);
    }
  }
  async #until(record: SessionRecord, driver: DesktopDriver, deadline: number, timeoutMs: number, test: () => Promise<boolean>, failure: string = REASONS.timeout) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await this.#gate(record, driver, deadline);
      if (await test()) return;
      if (Date.now() > end) { this.#end(record, 'step-failed', failure); throw new Halt('step-failed', failure); }
      await this.#sleep(this.poll);
    }
  }
  #sleep(ms: number) { return new Promise<void>(accept => setTimeout(accept, ms)); }
  #folder(record: SessionRecord) {
    check(/^[A-Za-z0-9_-]{1,120}$/.test(record.workspaceId), 'INVALID_SESSION_REQUEST', 'The workspace cannot hold driving exports.');
    return join(resolve(this.options.exportRoot), record.workspaceId, record.id);
  }
  /** The exact, unique export name in the session folder, the plan's folders or the usual save folders. */
  async #find(name: string, plan: Plan, folder: string): Promise<string | null> {
    const home = homedir();
    const folders = [folder, ...plan.folders, ...(this.options.searchFolders ?? [join(home, 'Downloads'), join(home, 'Documents'), home])];
    for (const candidate of folders) {
      try {
        const path = join(candidate, name);
        const first = await stat(path);
        if (!first.isFile()) continue;
        await this.#sleep(Math.min(this.poll, 300));
        const second = await stat(path);
        if (second.size === first.size && second.size > 0) return path;
      } catch { /* not there yet */ }
    }
    return null;
  }
  /** Moves the export into the session folder and records its size and digest. */
  async #keep(record: SessionRecord, from: string, name: string, folder: string): Promise<ExportFile> {
    check(EXPORT_NAME.test(name), 'INVALID_SESSION_REQUEST', 'The export name is not one Chausar made.');
    const path = join(folder, name);
    if (resolve(from) !== resolve(path)) {
      try { await rename(from, path); } catch { await copyFile(from, path); await unlink(from).catch(() => {}); }
    }
    const info = await stat(path);
    check(info.size > 0 && info.size <= MAX_EXPORT_BYTES, 'EXPORT_TOO_LARGE', 'The exported file is empty or too large to read in.');
    const bytes = await readFile(path);
    // A session stopped while the file was being kept leaves nothing behind.
    if (this.#current !== record) { await unlink(path).catch(() => {}); throw new Halt(record.state, record.reason ?? REASONS.stopped); }
    const extension = name.slice(name.lastIndexOf('.') + 1);
    return { id: `export_${randomBytes(9).toString('hex')}`, sessionId: record.id, workspaceId: record.workspaceId, name, mediaType: MEDIA[extension], bytes: info.size,
      sha256: createHash('sha256').update(bytes).digest('hex'), at: new Date().toISOString(), path };
  }

  /** Removes one session's export folder, or every folder older than `cutoff` for a workspace. */
  async sweep(workspaceId: string, keep: (sessionId: string) => boolean): Promise<number> {
    check(/^[A-Za-z0-9_-]{1,120}$/.test(workspaceId), 'INVALID_SESSION_REQUEST', 'The workspace cannot hold driving exports.');
    const root = join(resolve(this.options.exportRoot), workspaceId);
    let removed = 0;
    let names: string[] = [];
    try { names = await readdir(root); } catch { return 0; }
    for (const name of names) {
      if (!/^drive_[a-f0-9]{18}$/.test(name) || keep(name) || this.#current?.id === name) continue;
      const path = join(root, name);
      check(path.startsWith(root + sep), 'INVALID_SESSION_REQUEST', 'The export folder is outside the driving folder.');
      await rm(path, { recursive: true, force: true }); removed += 1;
    }
    return removed;
  }
}
