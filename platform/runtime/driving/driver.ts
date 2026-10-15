/**
 * The desktop driver interface (WK-14, experimental). One driver per operating system reaches
 * the windows on this computer: X11 on Linux (spoken directly over the X socket, XTEST for input,
 * XInput 2 for watching the person), UI Automation on Windows and Accessibility on macOS.
 *
 * A driver only lists windows, reads them, focuses one, presses a checked key chord, types a
 * Chausar-made file name, takes a picture of one window and watches for the person's own input.
 * It never reads or types a secret: there is no method that accepts free text from a plan, and
 * `focused().secret` reports a password field so the session can refuse before any key.
 *
 * Every error a driver throws carries a fixed upper-case code and a plain sentence; window titles
 * and other outside text never appear in an error.
 */
import { check } from '../contracts.ts';

export type DriverPlatform = 'x11' | 'windows-uia' | 'macos-ax' | 'fake';
/** `owned`: in `related()` only, a dialog the window owns (X11 WM_TRANSIENT_FOR, Windows GW_OWNER). Only owned dialogs may take keys. */
export type WindowInfo = { readonly id: string; readonly title: string; readonly app: string; readonly pid: number | null; readonly owned?: boolean };
/** The focused window, and whether the focused control is a password field (`null`: cannot tell). */
export type FocusInfo = { readonly windowId: string | null; readonly secret: boolean | null };
/**
 * One input the person made themselves (a pointer move, a key or a button), or the stop key,
 * Ctrl Alt Pause, which the driver holds for the whole session and reports even while muted.
 */
export type Activity = { readonly kind: 'pointer' | 'key' | 'button' | 'stop-key'; readonly at: number };
export type Snapshot = { readonly width: number; readonly height: number; readonly png: Buffer };
export type Availability = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly reason: string };

export interface DesktopDriver {
  readonly platform: DriverPlatform;
  /** Whether this driver can reach the desktop now. Never throws. */
  available(): Promise<Availability>;
  /** Top-level windows a person may choose from, without Chausar's own windows. */
  listWindows(): Promise<WindowInfo[]>;
  /** The window as it is now, or null when it has closed. */
  windowInfo(id: string): Promise<WindowInfo | null>;
  /** Windows of the same program that belong to this one (dialogs, sign-in boxes, save boxes). */
  related(id: string): Promise<WindowInfo[]>;
  /** Raise and focus the window. */
  focus(id: string): Promise<void>;
  focused(): Promise<FocusInfo>;
  /**
   * Press one checked chord (see `parseChord`). `live` is asked before every key event the
   * driver sends; once it answers false nothing more is sent (held modifiers are released) and
   * the call refuses `DRIVING_STOPPED`.
   */
  press(chord: Chord, live?: () => boolean): Promise<void>;
  /** Type a Chausar-made file name (see `checkFileName`), never outside text. `live` as for `press`. */
  typeFileName(name: string, live?: () => boolean): Promise<void>;
  /** The stop key as the person presses it on this system. */
  readonly stopKey?: string;
  /** A picture of one window, as PNG. */
  snapshot(id: string): Promise<Snapshot>;
  /**
   * Report the person's own input and the stop key until closed. Input the driver sends itself
   * is never reported. The stop key (Ctrl Alt Pause) is grabbed for the life of the watch.
   */
  watch(onActivity: (activity: Activity) => void): Promise<{ close(): void }>;
  close(): Promise<void>;
}

/** A key chord: modifiers plus one key from the allowed list. */
export type Chord = { readonly modifiers: readonly Modifier[]; readonly key: string };
export type Modifier = 'ctrl' | 'alt' | 'shift';
const MODIFIERS: readonly Modifier[] = ['ctrl', 'alt', 'shift'];
/** Keys a plan may press: navigation, function keys, letters and digits (as chords). Nothing that deletes. */
const NAMED = ['enter', 'escape', 'tab', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'space',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'] as const;
const KEYS = new Set<string>([...NAMED, ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')]);
/**
 * Chords that change, delete, paste, close or quit in common programs (Tally's Alt+D deletes a
 * voucher, Ctrl+A accepts a form, Alt+F4 closes), refused in every plan whatever the program.
 */
const REFUSED = new Set(['alt+d', 'ctrl+d', 'ctrl+a', 'ctrl+x', 'ctrl+v', 'ctrl+z', 'ctrl+y', 'ctrl+s', 'ctrl+q', 'ctrl+w', 'alt+f4', 'ctrl+f4',
  'ctrl+shift+delete', 'alt+c', 'alt+x', 'alt+i', 'alt+a', 'ctrl+n', 'alt+r', 'ctrl+r', 'shift+enter', 'ctrl+enter']);

export const chordText = (chord: Chord) => [...MODIFIERS.filter(m => chord.modifiers.includes(m)), chord.key].join('+');

/** Parse "ctrl+alt+e"-style text into a checked chord. Unknown or refused chords throw. */
export function parseChord(value: unknown): Chord {
  check(typeof value === 'string' && value.length > 0 && value.length <= 40, 'DRIVING_KEY_REFUSED', 'This key is not allowed while driving.');
  const parts = value.toLowerCase().split('+');
  const key = parts.pop()!;
  const modifiers = parts as Modifier[];
  check(modifiers.every(m => MODIFIERS.includes(m)) && new Set(modifiers).size === modifiers.length, 'DRIVING_KEY_REFUSED', 'This key is not allowed while driving.');
  check(KEYS.has(key), 'DRIVING_KEY_REFUSED', 'This key is not allowed while driving.');
  // A bare letter or digit would type text into the program; only chords may use them.
  check(!/^[a-z0-9]$/.test(key) || modifiers.some(m => m !== 'shift'), 'DRIVING_KEY_REFUSED', 'Chausar does not type text into the program.');
  const chord = { modifiers: MODIFIERS.filter(m => modifiers.includes(m)), key };
  // Adding Shift to a refused chord does not make it safe.
  const unshifted = chordText({ modifiers: chord.modifiers.filter(m => m !== 'shift'), key });
  check(!REFUSED.has(chordText(chord)) && !REFUSED.has(unshifted), 'DRIVING_KEY_REFUSED', 'This key can change or delete data, so Chausar never presses it.');
  // Ctrl+Alt with a letter or digit is AltGr on many layouts and types a character.
  check(!(chord.modifiers.includes('ctrl') && chord.modifiers.includes('alt') && /^[a-z0-9]$/.test(key)), 'DRIVING_KEY_REFUSED', 'Chausar does not type text into the program.');
  // Chords that switch to another program.
  check(!(['tab', 'escape'].includes(key) && chord.modifiers.some(m => m === 'alt' || m === 'ctrl')), 'DRIVING_KEY_REFUSED', 'This key moves to another program, so Chausar never presses it.');
  return Object.freeze(chord);
}

/** File names Chausar makes for an export. Only these are ever typed. */
export const FILE_NAME = /^chausar-export-[a-z0-9]{6,32}\.(csv|xml|xlsx|xls|txt|pdf|json|html)$/;
export function checkFileName(name: unknown): string {
  check(typeof name === 'string' && FILE_NAME.test(name), 'DRIVING_TEXT_REFUSED', 'Chausar types only the export file name it made.');
  return name;
}

/**
 * Window titles that mean the program asks for a sign-in, a one-time code or a captcha. The
 * session hands these to the person ("Sign in yourself. Chausar continues after.").
 */
export const SIGN_IN = /sign[\s-]?in|log[\s-]?in|log[\s-]?on|password|passcode|pass[\s-]?phrase|\bpin\b|one[\s-]?time|\botp\b|verification code|verify (it'?s|you)|captcha|not a robot|two[\s-]?(factor|step)|\b2fa\b|authenticat|security code|पासवर्ड|लॉग ?इन|ओटीपी/i;
/** Window titles for payment, edit or delete screens. A session stops before touching them. */
export const FORBIDDEN_SCREEN = /\bpay(ment|ments|ee|ing)?\b|\btransfer\b|\bcheckout\b|\bupi\b|net[\s-]?banking|\bneft\b|\brtgs\b|\bimps\b|\bdelete\b|\bremove\b|\balter(ation)?\b|\bedit(ing)?\b|voucher (creation|entry)|\bcreate\b|\bpost(ing)?\b|\bpurchase\b|भुगतान|हटाएं/i;

/** Mutes activity the driver caused itself: its own key and pointer events, plus a short grace. */
export class OwnInput {
  #until = 0; #depth = 0;
  readonly graceMs: number; readonly clock: () => number;
  constructor(graceMs = 200, clock: () => number = Date.now) { this.graceMs = graceMs; this.clock = clock; }
  async around<T>(work: () => Promise<T>): Promise<T> {
    this.#depth += 1;
    try { return await work(); } finally { this.#depth -= 1; this.#until = this.clock() + this.graceMs; }
  }
  /** True when an input event seen now could be the driver's own. */
  ours(): boolean { return this.#depth > 0 || this.clock() < this.#until; }
}

/** Activating keys: they press whatever control has focus. A plan may use them only right after typing the export name or after waiting for a named screen. */
export const ACTIVATING = new Set(['enter', 'space']);
export const isActivating = (chord: Chord) => chord.modifiers.length === 0 && ACTIVATING.has(chord.key);

/** A typed driver refusal: a fixed code and a plain sentence. */
export function refuse(code: string, reason: string): never { check(false, code, reason); throw new Error(reason); }
