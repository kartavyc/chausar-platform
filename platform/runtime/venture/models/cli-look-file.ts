// D4 task 6: the look at each command-line tool, kept between starts in one file beside the business folders
// (custody/cli-looks.json, next to ai-setup.json). Per tool it holds the last real look (CliFinding) and the program it
// looked at: the command asked for (the Codex program the owner chose is part of it), and that program's size and
// modified time. Nothing else: no tool output, no account, no key. Written whole through a temporary file and a rename,
// read at most 16 KB; anything that is not exactly this shape is refused on read (that tool, or the whole file, counts
// as never looked at). Never made, read or written on the hosted web server.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DELEGATE_CLIS } from '../contract-values.ts';
import type { CliFinding, DelegateCli } from '../contracts.ts';
import { newerVersion, noteNewerOnce, readLocalJson } from '../../local-files.ts';

const MAX_BYTES = 16 * 1024;
/** How long a kept look may answer at start: a day. Older, the tool is looked at before the first answer. */
export const KEPT_LOOK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CLI_LOOKS_FILE = 'cli-looks.json';

/** A finding answered from the file: as last seen, sign-in unknown until the background look lands (A2's rule). */
export type KeptCliFinding = CliFinding;
/** One tool's kept look: the finding and the program it was taken of. */
export type KeptLook = { command: string; size: number; mtimeMs: number; finding: CliFinding };
export type KeptLooks = Partial<Record<DelegateCli, KeptLook>>;
/** The host's file, or a test's stand-in. read answers the raw file (null when there is none); write replaces it. */
export type CliLookPort = { read(): Promise<unknown>; write(looks: KeptLooks): Promise<void> };

/** Where the desktop keeps it: the custody folder beside the businesses, as ai-setup.json. */
export function cliLookPath(directory: string): string {
  return join(directory, 'custody', CLI_LOOKS_FILE);
}

export function cliLookFile(path: string): CliLookPort {
  return {
    async read() {
      try {
        if ((await stat(path)).size > MAX_BYTES) return null;
        const text = await readFile(path, 'utf8');
        if (text.length > MAX_BYTES) return null;
        const raw = JSON.parse(text) as unknown;
        // D12: looks a newer Chausar kept are left alone: not read, not replaced; noted once.
        if (newerVersion(raw, 1)) { await noteNewerOnce(dirname(path), CLI_LOOKS_FILE, 'cli-looks'); return null; }
        return raw;
      } catch { return null; }
    },
    async write(looks: KeptLooks) {
      if (newerVersion(await readLocalJson(path), 1)) { await noteNewerOnce(dirname(path), CLI_LOOKS_FILE, 'cli-looks'); return; }
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, looks: Object.fromEntries(Object.entries(looks).map(([cli, look]) => [cli, { ...look, finding: { ...look.finding, signedIn: 'unknown' } }])) }), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

/** The program's size and modified time now, or null when it cannot be read. */
export async function programStamp(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
  } catch { return null; }
}

/** Only a real look at a tool that answered is kept: never a located-only, replayed or unstarted one. */
export function keepable(finding: CliFinding): boolean {
  return finding.found && finding.answered && !finding.replay && finding.via !== 'npm-shim' && typeof finding.path === 'string';
}

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => key in value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const FINDING_KEYS = ['cli', 'at', 'found', 'path', 'answered', 'version', 'flags', 'missingFlags', 'signedIn', 'statusCommand', 'profile', 'replay'] as const;
const FLAG = /^--[a-z0-9][a-z0-9-]{0,62}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;

function findingOf(cli: DelegateCli, value: unknown): CliFinding | null {
  if (!plain(value) || !exactKeys(value, FINDING_KEYS, ['via', 'ran'])) return null;
  const { at, path, version, flags, missingFlags, signedIn } = value;
  if (value.cli !== cli || typeof at !== 'string' || at.length > 40 || !Number.isFinite(Date.parse(at))) return null;
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) return null;
  if (version !== null && (typeof version !== 'string' || !VERSION.test(version))) return null;
  if (flags !== 'match' && flags !== 'mismatch' && flags !== 'unknown') return null;
  if (!Array.isArray(missingFlags) || missingFlags.length > 40 || !missingFlags.every(flag => typeof flag === 'string' && FLAG.test(flag))) return null;
  if (signedIn !== 'yes' && signedIn !== 'no' && signedIn !== 'unknown') return null;
  for (const key of ['found', 'answered', 'statusCommand', 'profile', 'replay'] as const) if (typeof value[key] !== 'boolean') return null;
  if ('via' in value && value.via !== 'npm-shim') return null;
  if ('ran' in value && typeof value.ran !== 'boolean') return null;
  const finding = {
    cli, at, found: value.found, path, answered: value.answered, version, flags, missingFlags: [...missingFlags], signedIn,
    statusCommand: value.statusCommand, profile: value.profile, replay: value.replay,
    ...('via' in value ? { via: 'npm-shim' as const } : {}), ...('ran' in value ? { ran: value.ran as boolean } : {}),
  } as CliFinding;
  return keepable(finding) ? finding : null;
}

/** The kept looks in a file read back, each checked field by field; a file of any other shape keeps nothing. */
export function readKeptLooks(raw: unknown): KeptLooks {
  if (!plain(raw) || !exactKeys(raw, ['version', 'looks']) || raw.version !== 1 || !plain(raw.looks)) return {};
  const looks: KeptLooks = {};
  for (const [cli, entry] of Object.entries(raw.looks)) {
    if (!(DELEGATE_CLIS as readonly string[]).includes(cli)) return {};
    if (!plain(entry) || !exactKeys(entry, ['command', 'size', 'mtimeMs', 'finding'])) continue;
    const { command, size, mtimeMs } = entry;
    if (typeof command !== 'string' || command.length === 0 || command.length > 1024) continue;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) continue;
    if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs < 0) continue;
    const finding = findingOf(cli as DelegateCli, entry.finding);
    if (finding) looks[cli as DelegateCli] = { command, size, mtimeMs, finding };
  }
  return looks;
}
