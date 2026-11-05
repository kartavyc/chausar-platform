// D12: the per-computer files rule. A file kept beside the businesses (custody/cards, custody/ai-setup.json,
// custody/cli-looks.json; later C5's preferences.json, exports.json and updates/*.json, C7's seen.json and
// custody/data-versions.json) carries its own format or version. One written by a newer Chausar is left on disk
// untouched: the reader ignores it and works without it, a write or remove skips it, and it is noted once (per file,
// per process) in custody/diagnostics.jsonl. So after a rollback the older Chausar never clobbers the newer one's files.
// A damaged file of no known kind is not protected: the writers replace it as before.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BYTES = 1024 * 1024;

/** The file's JSON, or undefined when it is missing, too large or not JSON. */
export async function readLocalJson(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, 'utf8');
    return text.length > MAX_BYTES ? undefined : JSON.parse(text);
  } catch { return undefined; }
}

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A format of the same family that is not the one this app writes (chausar.ai-setup.v2 when this app writes v1). */
export function newerFormat(raw: unknown, current: string): boolean {
  const family = current.replace(/\.v\d+$/, '.v');
  return plain(raw) && typeof raw.format === 'string' && raw.format !== current && raw.format.startsWith(family) && /^\d+$/.test(raw.format.slice(family.length));
}

/** A whole version number this app does not write (99 when this app writes 1). */
export function newerVersion(raw: unknown, current: number): boolean {
  return plain(raw) && Number.isSafeInteger(raw.version) && raw.version !== current;
}

const noted = new Set<string>();
/** One line in custody/diagnostics.jsonl, once per file per process: the tag only, never a path, a name or a value. */
export async function noteNewerOnce(custodyFolder: string, file: string, step: string): Promise<void> {
  const key = join(custodyFolder, file);
  if (noted.has(key)) return;
  noted.add(key);
  try {
    await mkdir(custodyFolder, { recursive: true });
    await appendFile(join(custodyFolder, 'diagnostics.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), op: 'local-file', step, code: 'LOCAL_FILE_NEWER' })}\n`, 'utf8');
  } catch { /* the log is a help, never a gate */ }
}
