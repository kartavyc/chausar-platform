/**
 * The host's shell port: `shell.openExternal` (SH-10) and `shell.print` (FR-04), and nothing
 * else. On the desktop it calls the two preload functions on `window.chausar`, which check
 * their argument and pass it to main on its own channel, where it is checked again. In the
 * browser (the loopback server, design part 15) the same seam opens a new tab with no opener
 * and no referrer, and prints with the browser's own dialog.
 *
 * Screens never call this directly: the host passes it as `onPrint` to the first run and as
 * `openLink` (behind the link dialog, after the person pressed "Open in your browser").
 */

export type PrintKind = 'recovery-kit' | 'page';
export type OpenOutcome = 'opened' | 'refused';
/** SH-11: the only kind of text the shell saves. */
export type SaveKind = 'fault-report';
export type SaveOutcome = 'saved' | 'cancelled' | 'refused';
export type CrashState = 'crashed' | 'clean';

export interface ShellPort {
  openExternal(url: string): Promise<OpenOutcome>;
  print(kind: PrintKind): Promise<void>;
  /** SH-11: the shown text to a file the person picks in the system save dialog. No path ever leaves the renderer. */
  saveText?(kind: SaveKind, text: string): Promise<SaveOutcome>;
  /** SH-11: whether the last run ended without a clean quit, and the person's answer, which clears it. */
  crashState?(): Promise<CrashState>;
  crashAnswer?(answer: 'send' | 'dont-send'): Promise<void>;
}

/** The preload functions on `window.chausar`, when that preload has them. */
export interface DesktopShellBridge {
  readonly openExternal?: (url: string) => Promise<unknown>;
  readonly print?: (kind: PrintKind) => Promise<unknown>;
  readonly saveText?: (kind: SaveKind, text: string) => Promise<unknown>;
  readonly crashState?: () => Promise<unknown>;
  readonly crashAnswer?: (answer: 'send' | 'dont-send') => Promise<unknown>;
}

/** What the browser fallback uses; `window` by default. */
export interface BrowserShell {
  open(url: string, target: string, features: string): unknown;
  print(): void;
  readonly document: { readonly documentElement: { readonly dataset: DOMStringMap } };
}

export const MAX_EXTERNAL_URL_LENGTH = 2048;
export const MAX_SAVE_LENGTH = 64 * 1024;
const OPEN_INTERVAL_MS = 1000;
const PRINT_KINDS: readonly string[] = ['recovery-kit', 'page'];

/**
 * The same rule as main (`app/desktop/shell-ipc.cjs`): https only, at most 2048 characters,
 * no credentials, no whitespace or control characters, a named host with a dot that is not
 * this computer, a bare local-network name or an address by number. Returns the
 * re-serialized address, or null.
 */
export function externalUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_EXTERNAL_URL_LENGTH) return null;
  if (/[\u0000- \u007f-\u009f]/.test(input)) return null;
  // Only plain ASCII as typed (no look-alike letters, no direction marks) and no backslash, so what the
  // person reads in the dialog is what opens.
  if (/[^\u0021-\u007e]|\\/.test(input)) return null;
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.') || host === 'localhost' || host.endsWith('.localhost')
    || host.startsWith('[') || /^[0-9.]+$/.test(host)) return null;
  // Never a name on the local network, and only the default port. Names that resolve to a private address
  // cannot be caught without resolving them; the person's confirmation in the dialog is the control there.
  if (url.port !== '' || /\.(local|lan|internal|localdomain|home\.arpa|intranet|corp)$/.test(host)) return null;
  return url.href.length <= MAX_EXTERNAL_URL_LENGTH ? url.href : null;
}

export function createShellPort(desktop: DesktopShellBridge | null, browser: BrowserShell | null = typeof window === 'undefined' ? null : window,
  now: () => number = Date.now): ShellPort {
  let lastOpen = -Infinity;
  // The document marked for paper: the browser's, or this renderer's own on the desktop.
  const root = () => (browser?.document ?? (typeof document === 'undefined' ? undefined : document))?.documentElement.dataset;
  return Object.freeze({
    async openExternal(url: string): Promise<OpenOutcome> {
      const href = externalUrl(url);
      if (href === null) return 'refused';
      if (desktop !== null) {
        if (typeof desktop.openExternal !== 'function') return 'refused';
        try { return await desktop.openExternal(href) === 'opened' ? 'opened' : 'refused'; } catch { return 'refused'; }
      }
      const at = now();
      if (browser === null || at - lastOpen < OPEN_INTERVAL_MS) return 'refused';
      lastOpen = at;
      try { browser.open(href, '_blank', 'noopener,noreferrer'); return 'opened'; } catch { return 'refused'; }
    },
    async print(kind: PrintKind): Promise<void> {
      if (!PRINT_KINDS.includes(kind)) return;
      // The print stylesheet (host.css) shows only what this kind names.
      const dataset = root();
      if (dataset) dataset['print'] = kind;
      try {
        if (desktop !== null) { if (typeof desktop.print === 'function') await desktop.print(kind); }
        else browser?.print();
      } catch { /* The dialog closed or never opened: nothing to report. */ }
      finally { if (dataset) delete dataset['print']; }
    },
    async saveText(kind: SaveKind, text: string): Promise<SaveOutcome> {
      if (kind !== 'fault-report' || typeof text !== 'string' || text.length === 0 || text.length > MAX_SAVE_LENGTH) return 'refused';
      if (desktop !== null) {
        if (typeof desktop.saveText !== 'function') return 'refused';
        try { const result = await desktop.saveText(kind, text); return result === 'saved' || result === 'cancelled' ? result : 'refused'; } catch { return 'refused'; }
      }
      // The browser keeps its own download prompt: a text file with the fixed name, nothing else.
      const doc = typeof document === 'undefined' ? null : document;
      if (doc === null || typeof URL.createObjectURL !== 'function') return 'refused';
      try {
        const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const link = doc.createElement('a');
        link.href = href; link.download = 'chausar-fault-report.txt'; link.rel = 'noopener';
        link.click(); URL.revokeObjectURL(href);
        return 'saved';
      } catch { return 'refused'; }
    },
    async crashState(): Promise<CrashState> {
      if (desktop === null || typeof desktop.crashState !== 'function') return 'clean';
      try { return await desktop.crashState() === 'crashed' ? 'crashed' : 'clean'; } catch { return 'clean'; }
    },
    async crashAnswer(answer: 'send' | 'dont-send'): Promise<void> {
      if (desktop === null || typeof desktop.crashAnswer !== 'function' || (answer !== 'send' && answer !== 'dont-send')) return;
      try { await desktop.crashAnswer(answer); } catch { /* The question comes back on the next start. */ }
    },
  });
}
