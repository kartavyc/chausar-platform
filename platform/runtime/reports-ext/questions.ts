/**
 * "Open a question file" (RP-08): an accountant or CA seat reads a file that `reportsx.askPerson` made in this workspace.
 * Only plain file names under `<directory>/exports/questions/` are read; any other path, a link or a large file is refused.
 */
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { authorize, check, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { seatOf } from '../trust-ext/core-state.ts';
import { isoAt } from './common.ts';
import { sha256 } from './export-files.ts';

const NAME = /^question-[A-Za-z0-9-]{1,80}\.html$/;
const MAX_BYTES = 1_000_000;

/** The question files are for the accountant's or CA's seat. */
function requireAccountant(host: ModuleHost, ctx: Context) {
  const state = host.store.read(), member = authorize(host.store, ctx, 'read');
  check(['accountant', 'ca'].includes(seatOf(state, member)), 'FORBIDDEN', 'Only an accountant or CA seat opens question files.');
}
const folderOf = (host: ModuleHost) => resolve(host.directory, 'exports', 'questions');

/** The path of a question file by its name, refused unless it is a plain file name inside the questions folder. */
function pathOf(host: ModuleHost, name: unknown): string {
  check(typeof name === 'string' && NAME.test(name), 'INVALID_QUESTION_FILE', 'Choose a question file by its name.');
  const folder = folderOf(host), path = resolve(folder, name), inside = relative(folder, path);
  check(inside === name && !inside.includes(sep) && !inside.startsWith('..'), 'INVALID_QUESTION_FILE', 'Choose a question file by its name.');
  return path;
}

/** The file's words as plain text: headings, paragraphs, table rows and list items each on a line; no markup is passed on. */
export function questionText(html: string): string {
  return html.replace(/<(style|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(h1|h2|p|tr|li|table|ul)>/gi, '\n').replace(/<\/td>/gi, '  ').replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')
    .split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n');
}

export async function questionFiles(ctx: Context, host: ModuleHost) {
  requireAccountant(host, ctx);
  let names: string[] = [];
  try { names = (await readdir(folderOf(host))).filter(name => NAME.test(name)); } catch { /* No question file has been made yet. */ }
  const items: { name: string; bytes: number; at: string }[] = [];
  for (const name of names.sort().reverse()) {
    const info = await lstat(join(folderOf(host), name));
    if (info.isFile()) items.push({ name, bytes: info.size, at: isoAt(info.mtimeMs) });
  }
  return { items };
}

export async function openQuestion(ctx: Context, host: ModuleHost, name: unknown) {
  requireAccountant(host, ctx);
  const path = pathOf(host, name);
  let info;
  try { info = await lstat(path); } catch { info = null; }
  check(info !== null && info.isFile(), 'QUESTION_FILE_NOT_FOUND', 'There is no question file with this name.');
  check(info.size <= MAX_BYTES, 'INVALID_QUESTION_FILE', 'This file is too large to be a question file.');
  const bytes = await readFile(path), html = bytes.toString('utf8');
  return { name: name as string, bytes: bytes.length, sha256: sha256(bytes), at: isoAt(info.mtimeMs), text: questionText(html) };
}
