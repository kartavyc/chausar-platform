// B1 fix round 3 (review 3, finding 1): reads the refusals a source can throw, for the engine's scan
// (owner-refusals-b1.test.ts) and the fake engine's (app/ui/tests/engine/fake-refusals-b1.test.ts), so both read alike.
// A refusal is a code in quotes followed by its words, whatever call carries them (check, new ChausarError, new
// EngineError, a local helper), or words first: refusalError(new Error('...'), { code: 'CODE' }).
import { readdir, readFile } from 'node:fs/promises';

/**
 * The engine's refusals that keep a developer word, by file (under platform/runtime) and code, each with its reason;
 * the fake engine may keep the same codes' words. Only the words of an outside tool an owner of that kind of business
 * uses themselves belong here; everything Chausar says in its own voice is plain.
 */
export const KEPT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  // The dev agency playbook serves software firms; npm, its lockfile and a source snapshot are the client's own tools and
  // words (the catalogue keeps them for the same three dev agency keys, w6-owner-words.test.ts).
  'venture/playbooks/dev-agency/audit-desk.ts DEV_SCAN_REQUIRED': 'a dev agency names the client source snapshot',
  'venture/playbooks/dev-agency/audit-desk.ts DEV_SCANNER_REQUIRED': 'npm is the client project\'s own package tool',
  'venture/playbooks/dev-agency/scanner-port.ts DEV_SCANNER_CHANGED': 'npm is the client project\'s own package tool',
  'venture/playbooks/dev-agency/scanners.ts DEV_SCAN_INVALID': 'npm audit and its lockfile are the client project\'s own tools',
  'venture/playbooks/dev-agency/source-core.ts DEV_SOURCE_INVALID': 'a dev agency names the client source snapshot',
  // An Android app's manifest is the APK's own part, named as Android names it, for an app testing business.
  'venture/playbooks/app-testing/apk-source.ts CLIENT_APK_REQUIRED': 'the Android manifest is the APK\'s own part',
});

export type Refusal = { file: string; code: string; words: string; internal: boolean };

const LIT = String.raw`(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\]|\\.)*\`)`;
// The words are read ahead, not taken, so a code that follows another code in quotes is read too.
const PAIR = new RegExp(String.raw`'([A-Z][A-Z0-9_]{2,63})'(?=\s*,\s*(${LIT}(?:\s*\+\s*${LIT})*))`, 'g');
const MARKED = new RegExp(String.raw`\bError\(\s*(${LIT})\s*\)\s*,\s*\{[^}]{0,120}?\bcode\s*:\s*'([A-Z][A-Z0-9_]{2,63})'`, 'g');

/** Every .ts file under a folder, by its path from there, with its text. */
export async function sourcesUnder(folder: URL, keep: (path: string) => boolean = () => true, prefix = ''): Promise<[string, string][]> {
  const found: [string, string][] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) found.push(...await sourcesUnder(new URL(`${entry.name}/`, folder), keep, `${path}/`));
    else if (entry.name.endsWith('.ts') && keep(path)) found.push([path, await readFile(new URL(entry.name, folder), 'utf8')]);
  }
  return found;
}

/** The source with every string's and comment's contents blanked, so brackets inside words never count. */
export function code(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack: number[] = []; // brace depth at each open template's ${
  let i = 0, braces = 0;
  const template = (start: number): number => { // from just after a backtick (or a closing }) to its end or next ${
    let k = start;
    while (k < source.length && source[k] !== '`') {
      if (source[k] === '\\') { k += 2; continue; }
      if (source[k] === '$' && source[k + 1] === '{') { blank(start, k); stack.push(braces); braces++; return k + 2; }
      k++;
    }
    blank(start, k);
    return k + 1;
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { const end = source.indexOf('\n', i); blank(i, end < 0 ? source.length : end); i = end < 0 ? source.length : end; continue; }
    if (c === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); blank(i, end < 0 ? source.length : end + 2); i = end < 0 ? source.length : end + 2; continue; }
    if (c === '\'' || c === '"') {
      let k = i + 1;
      while (k < source.length && source[k] !== c && source[k] !== '\n') k += source[k] === '\\' ? 2 : 1;
      blank(i + 1, k); i = k + 1; continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '/' && regexMayStart(source, i)) { // a regex literal: its quotes and brackets are not code either
      let k = i + 1, inClass = false;
      while (k < source.length && source[k] !== '\n' && (inClass || source[k] !== '/')) {
        if (source[k] === '\\') { k += 2; continue; }
        if (source[k] === '[') inClass = true; else if (source[k] === ']') inClass = false;
        k++;
      }
      if (source[k] === '/') { blank(i + 1, k); i = k + 1; continue; }
    }
    if (c === '{') braces++;
    if (c === '}') {
      braces--;
      if (stack.length && stack[stack.length - 1] === braces) { stack.pop(); i = template(i + 1); continue; }
    }
    i++;
  }
  return out.join('');
}

/** True when a slash here starts a regex literal rather than dividing: after an operator, a bracket or a keyword. */
function regexMayStart(source: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && /\s/.test(source.charAt(k))) k--;
  if (k < 0) return true;
  if (/[(,=:[!&|?{};+\-*%<>~^]/.test(source.charAt(k))) return true;
  return /\b(?:return|typeof|case|in|of|void|throw|delete)$/.test(source.slice(Math.max(0, k - 8), k + 1));
}

/** The name of the call whose brackets hold this place ('?' when there is none close by). */
export function callee(masked: string, at: number): string {
  let depth = 0;
  for (let k = at - 1; k >= Math.max(0, at - 4000); k--) {
    const c = masked[k];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) { depth--; continue; }
      if (c !== '(') return '?';
      return /([\w$]+)\s*$/.exec(masked.slice(Math.max(0, k - 80), k))?.[1] ?? '?';
    }
  }
  return '?';
}

/** True when this name throws InternalError in this file: the internal check itself, or a local helper that does. */
export function throwsInternal(source: string, name: string): boolean {
  if (name === 'internalCheck' || name === 'InternalError') return true;
  if (name === 'check') return /\binternalCheck as check\b/.test(source);
  if (!/^[\w$]+$/.test(name)) return false;
  const at = new RegExp(String.raw`(?:function\s+${name.replace(/\$/g, '\\$')}\s*\(|\b(?:const|let)\s+${name.replace(/\$/g, '\\$')}\s*=)`).exec(source);
  return !!at && /\b(?:InternalError|internalCheck)\b/.test(source.slice(at.index, at.index + 300));
}

/** Every refusal in these sources, with whether it is thrown as InternalError. */
export function refusalsIn(sources: [string, string][]): Refusal[] {
  const found: Refusal[] = [];
  for (const [file, source] of sources) {
    const masked = code(source);
    for (const match of source.matchAll(PAIR)) {
      if (masked[match.index] !== '\'') continue; // inside a comment or another string
      const words = [...(match[2] ?? '').matchAll(new RegExp(LIT, 'g'))].map(part => part[0].slice(1, -1)).join('').replace(/\$\{[^}]*\}/g, 'x');
      if (/^[A-Z0-9_]+$/.test(words)) continue; // a list of codes is not a refusal
      found.push({ file, code: match[1] ?? '', words, internal: throwsInternal(source, callee(masked, match.index)) });
    }
    for (const match of source.matchAll(MARKED)) {
      if (masked[match.index] !== 'E') continue;
      found.push({ file, code: match[2] ?? '', words: (match[1] ?? '').slice(1, -1).replace(/\$\{[^}]*\}/g, 'x'), internal: false });
    }
  }
  return found;
}
