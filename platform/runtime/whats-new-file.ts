// C7 task 26 (the file half): the "What's new" seen mark, one per computer: custody/seen.json beside ai-setup.json,
// { format, version, seenAt }, written whole through a temporary file and a rename, at most 4 KB. A computer with no file
// and no business yet records the running version silently, so a fresh install shows nothing; after an update the new
// version reads as not seen until the owner closes the sheet. A broken file reads as seen (nothing shown rather than a
// loop), and a file from a newer Chausar is left alone and noted once (D12, local-files.ts). The engine methods
// (whatsNew.get, whatsNew.seen) and the sheet wait for the main lane.
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ChausarError } from './portable.ts';
import { newerFormat, noteNewerOnce } from './local-files.ts';

export const SEEN_FILE = 'seen.json';
export const SEEN_FORMAT = 'chausar.seen.v1';
const MAX_BYTES = 4096;
const MAX_VERSION = 100;

type Kept = { kind: 'missing' } | { kind: 'broken' } | { kind: 'newer' } | { kind: 'seen'; version: string };

async function readKept(custodyFolder: string): Promise<Kept> {
  const path = join(custodyFolder, SEEN_FILE);
  let text: string;
  try {
    if ((await stat(path)).size > MAX_BYTES) return { kind: 'broken' };
    text = await readFile(path, 'utf8');
  } catch (error: any) { return error?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'broken' }; }
  let raw: any;
  try { raw = JSON.parse(text); } catch { return { kind: 'broken' }; }
  if (newerFormat(raw, SEEN_FORMAT)) { await noteNewerOnce(custodyFolder, SEEN_FILE, 'whats-new'); return { kind: 'newer' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.format !== SEEN_FORMAT || typeof raw.version !== 'string' || !raw.version || raw.version.length > MAX_VERSION) return { kind: 'broken' };
  return { kind: 'seen', version: raw.version };
}

function checkVersion(version: string): void {
  if (typeof version !== 'string' || !version || version.length > MAX_VERSION) throw new ChausarError('INVALID_VENTURE_REQUEST', 'Name the version Chausar is running.');
}

/** Marks this version seen, unless a newer Chausar's mark is there. */
export async function markSeen(custodyFolder: string, version: string, at = new Date()): Promise<void> {
  checkVersion(version);
  if ((await readKept(custodyFolder)).kind === 'newer') return;
  await mkdir(custodyFolder, { recursive: true });
  const path = join(custodyFolder, SEEN_FILE), temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ format: SEEN_FORMAT, version, seenAt: at.toISOString() }), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

/** Whether the running version's notes were seen on this computer. A fresh computer records the version and says seen. */
export async function whatsNewState(custodyFolder: string, version: string, { hasBusiness }: { hasBusiness: boolean }): Promise<{ version: string; seen: boolean }> {
  checkVersion(version);
  const kept = await readKept(custodyFolder);
  if (kept.kind === 'missing') {
    if (hasBusiness) return { version, seen: false };
    await markSeen(custodyFolder, version);
    return { version, seen: true };
  }
  if (kept.kind === 'seen') return { version, seen: kept.version === version };
  return { version, seen: true };
}
