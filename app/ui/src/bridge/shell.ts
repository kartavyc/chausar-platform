/**
 * The host's shell port: `shell.openExternal` (SH-10), `shell.print` (FR-04) and, on the
 * desktop only, `imports.pickFile` (FR-07, BK-04, FR-13), and nothing else. On the desktop it calls the two preload functions on `window.chausar`, which check
 * their argument and pass it to main on its own channel, where it is checked again. In the
 * browser (the loopback server, design part 15) the same seam opens a new tab with no opener
 * and no referrer, and prints with the browser's own dialog.
 *
 * Screens never call this directly: the host passes it as `onPrint` to the first run and as
 * `openLink` (behind the link dialog, after the person pressed "Open in your browser").
 *
 * `pickFile` is the system open dialog in main (`app/desktop/file-ipc.cjs`): a statement comes
 * back as its base name and bytes (never its path), a backup as its managed name in the app's
 * backups folder. In the browser there is no `pickFile`: the screens draw `<input type=file>`.
 */

export type PrintKind = 'recovery-kit' | 'page';
export type OpenOutcome = 'opened' | 'refused';

export type PickKind = 'statement' | 'backup';
export const PICK_REFUSALS = ['FILE_TOO_LARGE', 'FILE_KIND_REFUSED', 'FILE_UNREADABLE', 'BACKUP_NOT_MANAGED', 'PICKER_BUSY'] as const;
export type PickRefusal = typeof PICK_REFUSALS[number];
/** What `imports.pickFile` answers. A statement carries its bytes; a backup only its managed name. */
export type PickReply =
  | { readonly outcome: 'picked'; readonly name: string; readonly bytesBase64?: string }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'refused'; readonly code: PickRefusal };

export interface ShellPort {
  openExternal(url: string): Promise<OpenOutcome>;
  print(kind: PrintKind): Promise<void>;
  /** The system open dialog (desktop only). Absent in the browser. */
  readonly pickFile?: ((kind: PickKind) => Promise<PickReply>) | undefined;
}

/** The preload functions on `window.chausar`, when that preload has them. */
export interface DesktopShellBridge {
  readonly openExternal?: (url: string) => Promise<unknown>;
  readonly print?: (kind: PrintKind) => Promise<unknown>;
  readonly pickFile?: (kind: PickKind) => Promise<unknown>;
}

/** The largest statement main reads (`MAX_STATEMENT_BYTES` in file-ipc.cjs): what one desktop request can carry as base64. */
export const MAX_PICKED_BYTES = 1_450_000;
const PICK_UNREADABLE: PickReply = Object.freeze({ outcome: 'refused', code: 'FILE_UNREADABLE' });

/** The pick reply checked again in the renderer: anything else is an unreadable file. */
export function pickReply(kind: PickKind, value: unknown): PickReply {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return PICK_UNREADABLE;
  const reply = value as Record<string, unknown>;
  const keys = Object.keys(reply).sort().join(',');
  if (reply['outcome'] === 'cancelled' && keys === 'outcome') return Object.freeze({ outcome: 'cancelled' });
  if (reply['outcome'] === 'refused' && keys === 'code,outcome') {
    const code = reply['code'];
    return typeof code === 'string' && (PICK_REFUSALS as readonly string[]).includes(code) ? Object.freeze({ outcome: 'refused', code: code as PickRefusal }) : PICK_UNREADABLE;
  }
  if (reply['outcome'] !== 'picked') return PICK_UNREADABLE;
  const name = reply['name'];
  if (typeof name !== 'string' || name.length === 0 || name.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return PICK_UNREADABLE;
  if (kind === 'backup') return keys === 'name,outcome' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}\.backup$/.test(name) ? Object.freeze({ outcome: 'picked', name }) : PICK_UNREADABLE;
  const bytes = reply['bytesBase64'];
  return keys === 'bytesBase64,name,outcome' && typeof bytes === 'string' && bytes.length <= Math.ceil(MAX_PICKED_BYTES / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes)
    ? Object.freeze({ outcome: 'picked', name, bytesBase64: bytes }) : PICK_UNREADABLE;
}

/** What the browser fallback uses; `window` by default. */
export interface BrowserShell {
  open(url: string, target: string, features: string): unknown;
  print(): void;
  readonly document: { readonly documentElement: { readonly dataset: DOMStringMap } };
}

export const MAX_EXTERNAL_URL_LENGTH = 2048;
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
  const pick = desktop !== null && typeof desktop.pickFile === 'function' ? desktop.pickFile : null;
  return Object.freeze({
    ...(pick === null ? {} : {
      async pickFile(kind: PickKind): Promise<PickReply> {
        if (kind !== 'statement' && kind !== 'backup') return Object.freeze({ outcome: 'refused', code: 'FILE_KIND_REFUSED' });
        try { return pickReply(kind, await pick(kind)); } catch { return PICK_UNREADABLE; }
      },
    }),
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
  });
}
