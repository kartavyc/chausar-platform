// One-shot A1 (row 0): what a failed request says to the owner. Only Chausar's own refusals keep their words: a
// ChausarError, or an error that carries a Chausar-shaped code (capital letters and underscores, not Node's ERR_ codes)
// and no system call. Anything else (a TypeError, a Node file error with a path in it) becomes one plain sentence, so
// engine source text, stack lines and paths never reach a screen. The hosted server, the local server and the desktop
// engine worker all answer this way.
import { ChausarError } from './contracts.ts';

export const UNEXPECTED_CODE = 'REQUEST_FAILED';
export const UNEXPECTED_WORDS = 'Something went wrong in Chausar, so this did not finish. Nothing was sent. Try again, and if it keeps happening, send feedback from Settings.';

export type OwnerError = { code: string; message: string; reason?: string };

/** True for an error whose words are Chausar's own. */
export function knownError(error: unknown): boolean {
  if (error instanceof ChausarError) return true;
  const raw = error as { code?: unknown; syscall?: unknown; errno?: unknown; message?: unknown } | null;
  return typeof raw?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(raw.code) && !raw.code.startsWith('ERR_')
    && raw.syscall === undefined && raw.errno === undefined && typeof raw.message === 'string';
}

/** The code, words and (when it is a short plain tag) reason a reply may carry. */
export function ownerError(error: unknown): OwnerError {
  if (!knownError(error)) return { code: UNEXPECTED_CODE, message: UNEXPECTED_WORDS };
  const e = error as { code: string; message: string; reason?: unknown };
  return { code: e.code, message: e.message, ...(typeof e.reason === 'string' && /^[a-z-]{1,32}$/.test(e.reason) ? { reason: e.reason } : {}) };
}
