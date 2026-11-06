// Chausar playbook kit (Ink v2 wave 5, package 5A5): the engine's atomic file writer, wave 4's export hygiene (P12,
// app/desktop/money-export.cjs writeAtomic) on the engine side, for a report folder, a DOCX or an XLSX written to a
// folder on this computer. Several files are written together or not at all: each name is first reserved with an
// exclusive create (unless replacing), each file's bytes go to a temporary file beside it that is flushed and closed,
// then every one is renamed into place; a file being replaced is first moved aside and put back if a later rename
// fails. Any failure takes away what this write made and answers in plain words with no path in them. Names are plain
// file names, never a path. Written for Chausar from the desktop's own writer; nothing is learned from an outside source.
import * as fsp from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ChausarError } from '../../../contracts.ts';

/** One file to write: a plain name inside the folder, and its bytes. */
export type AtomicFile = { name: string; bytes: Uint8Array };
type Fs = typeof fsp;

/** A plain file name: letters, digits, dot, dash and underscore, not starting with a dot. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/** The words for a file system error: what happened and what to do, never the path it names. */
const FS_WORDS: Readonly<Record<string, string>> = Object.freeze({
  EACCES: 'Chausar could not write there. Choose another folder.',
  EPERM: 'Chausar could not write there. Choose another folder.',
  EROFS: 'Chausar could not write there: that disk is read-only. Choose another folder.',
  ENOSPC: 'There is not enough space on that disk. Free some space or choose another disk.',
  EDQUOT: 'There is not enough space on that disk. Free some space or choose another disk.',
  ENOENT: 'That folder is not there any more. Choose another folder.',
  ENOTDIR: 'That folder is not there any more. Choose another folder.',
  EBUSY: 'The file is open in another app. Close it there and save again.',
});
const EXISTS_WORDS = 'A file with this name is already there, so Chausar left it alone. Choose another folder, or replace it.';

function plain(error: unknown): ChausarError {
  if (error instanceof ChausarError) return error;
  const code = (error as { code?: unknown })?.code;
  return new ChausarError('EXPORT_NOT_SAVED', (typeof code === 'string' && FS_WORDS[code]) || 'Chausar could not write the files. Choose another folder and save again.');
}

type Staged = { target: string; temp: string; reserved: boolean; aside: string | null; placed: boolean };

/**
 * Writes every file into the folder, all or none. Without replace, a name already there refuses with EXPORT_EXISTS and
 * nothing is written; with replace, the old file is kept aside until every new one is in place. A name that is not a
 * plain file name refuses with EXPORT_NOT_SAVED. options.fs is for tests.
 */
export async function writeFilesAtomic(folder: string, files: readonly AtomicFile[], options: { replace?: boolean; fs?: Fs } = {}): Promise<void> {
  const fs = options.fs ?? fsp;
  const names = new Set<string>();
  for (const file of files) {
    if (typeof file.name !== 'string' || !FILE_NAME.test(file.name) || names.has(file.name.toLowerCase())) {
      throw new ChausarError('EXPORT_NOT_SAVED', 'Each file needs its own plain name, with no folder in it.');
    }
    names.add(file.name.toLowerCase());
  }
  const staged: Staged[] = [];
  try {
    for (const file of files) {
      const target = join(folder, file.name);
      const item: Staged = { target, temp: join(folder, `.${file.name}.${randomBytes(6).toString('hex')}.tmp`), reserved: false, aside: null, placed: false };
      staged.push(item);
      if (options.replace !== true) {
        let slot;
        try { slot = await fs.open(target, 'wx', 0o600); } catch (error) {
          throw (error as { code?: unknown })?.code === 'EEXIST' ? new ChausarError('EXPORT_EXISTS', EXISTS_WORDS) : error;
        }
        item.reserved = true;
        await slot.close();
      }
      const handle = await fs.open(item.temp, 'wx', 0o600);
      try {
        await handle.writeFile(file.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    for (const item of staged) {
      if (!item.reserved) {
        const aside = `${item.temp}.old`;
        try { await fs.rename(item.target, aside); item.aside = aside; } catch (error) { if ((error as { code?: unknown })?.code !== 'ENOENT') throw error; }
      }
      await fs.rename(item.temp, item.target);
      item.placed = true;
    }
  } catch (error) {
    await undo(staged, fs);
    throw plain(error);
  }
  for (const item of staged) if (item.aside) await fs.rm(item.aside, { force: true }).catch(() => {});
}

/** Takes away what a failed write made: temporary files, reserved names, files put in place; old files go back. */
async function undo(staged: readonly Staged[], fs: Fs): Promise<void> {
  for (const item of staged) {
    await fs.rm(item.temp, { force: true }).catch(() => {});
    if (item.placed || item.reserved) await fs.rm(item.target, { force: true }).catch(() => {});
    if (item.aside) await fs.rename(item.aside, item.target).catch(() => {});
  }
}
