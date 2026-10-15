import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { check, newId } from '../contracts.ts';

/** Shared helpers for per-user OS integration (wake timer, start at login).
 * They follow background-service.ts: absolute validated paths, no shell, no elevation. */
export type OsPlatform = 'win32' | 'darwin' | 'linux';

export function osPlatform(value: unknown, code: string, message: string): OsPlatform {
  check(value === 'win32' || value === 'darwin' || value === 'linux', code, message);
  return value;
}

/** An absolute, normalized path without control characters (and, on Windows, without quotes or wildcards). */
export function validOsPath(platform: OsPlatform, value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (platform === 'win32') return /^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)/.test(value) && win32.isAbsolute(value)
    && win32.normalize(value) === value && !/["%<>|?*]/.test(value.slice(2));
  return posix.isAbsolute(value) && posix.normalize(value) === value;
}

/** One CommandLineToArgvW argument. Validated Windows paths never contain quotes. */
export function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/(\\+)$/, '$1$1')}"`;
}

/** Write through a private temporary file and rename; refuse symlinked folders or files. */
export async function writeOsFileAtomically(path: string, directory: string, content: Buffer, code: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const directoryInfo = await lstat(directory);
  check(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(), code, 'The settings folder must be a real folder.');
  try {
    const existing = await lstat(path);
    check(existing.isFile() && !existing.isSymbolicLink(), code, 'The settings file must be a regular file.');
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const temporary = join(directory, `.${newId('os')}.tmp`);
  const file = await open(temporary, 'wx', 0o644);
  try { await file.writeFile(content); await file.sync(); await file.close(); await rename(temporary, path); }
  catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}

/** Read a regular file (never through a symlink); null when absent. */
export async function readOsFile(path: string, code: string): Promise<string | null> {
  let info;
  try { info = await lstat(path); } catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  check(info.isFile() && !info.isSymbolicLink(), code, 'The settings file must be a regular file.');
  check(info.size <= 64 * 1024, code, 'The settings file is too large.');
  const file = await open(path, 'r');
  try { return await file.readFile('utf8'); } finally { await file.close(); }
}

/** Remove a regular file; a symlink in its place is refused rather than followed. */
export async function removeOsFile(path: string, code: string): Promise<void> {
  let info;
  try { info = await lstat(path); } catch (error: any) { if (error?.code === 'ENOENT') return; throw error; }
  check(info.isFile() || info.isSymbolicLink(), code, 'The settings path is not a file.');
  await unlink(path);
}

export function confirmedPayload(payload: unknown, action: string): void {
  check((payload as any)?.confirmed === true, 'CONFIRMATION_REQUIRED', `${action} needs a person to confirm it first.`);
}
export function plainPayload(payload: unknown): Record<string, unknown> {
  const value = payload ?? {};
  check(typeof value === 'object' && !Array.isArray(value), 'INVALID_REQUEST', 'The request must be an object.');
  return value as Record<string, unknown>;
}
