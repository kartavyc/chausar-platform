// One-shot A4 (hands-on row 9): the text of an ordinary PDF, read by code on this computer, for About you's resume. The
// trusted Python helper (pdf.extract) is not part of the desktop beta, so without this every resume was refused.
//
// What it reads: the pages in the order of the page tree (objects plain or inside object streams, contents compressed
// with FlateDecode or not), and the text shown on them with Tj, TJ, ' and ", through each font's ToUnicode map when it
// has one (two-byte codes included, as Word, Google Docs and LibreOffice write them), else as single bytes. A wide gap
// inside TJ, or a move along the line, is a space; a move to a new line is a line break.
// What it does not: OCR (a scanned page gives no text), forms, images, encrypted files (refused, PDF_ENCRYPTED), or any
// script or action in the file. Nothing in the file is run or followed; it is only read as data.
// No imports but the refusal brand: the fake engine reads with this same code (pdf-text.ts gives the engine zlib).
import { refusalError } from '../refusal-brand.ts';

/** inflate: FlateDecode's bytes to plain bytes, or null when it cannot; without it a compressed stream is skipped. */
export type PdfTextOptions = { maxPages?: number; maxChars?: number; inflate?: (bytes: Uint8Array) => Uint8Array | null };
/** A stream's data is kept as a latin1 string: one character per byte. */
type PdfObject = { dict: string; data: string | null };
type Font = { map: Map<string, string> | null; bytes: 1 | 2 };

const UNREADABLE = 'Chausar could not read that PDF. Paste a few lines about your work instead.';
const ENCRYPTED = 'That PDF is locked with a password, so Chausar cannot read it. Save it again without a password, or paste a few lines about your work.';
const MAX_OBJECTS = 20_000;

const fail = (code: 'PDF_UNREADABLE' | 'PDF_ENCRYPTED', message: string): never => { throw refusalError(new Error(message), { code }); };
const toLatin1 = (bytes: Uint8Array): string => { let out = ''; for (let at = 0; at < bytes.length; at += 8192) out += String.fromCharCode(...bytes.subarray(at, at + 8192)); return out; };
const fromLatin1 = (text: string): Uint8Array => { const bytes = new Uint8Array(text.length); for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at) & 0xff; return bytes; };

/** Every object of the file by number, the newest of each, with those inside object streams. */
function readObjects(src: string, inflate: PdfTextOptions['inflate']): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const header = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(src)) && objects.size < MAX_OBJECTS) {
    const start = match.index + match[0].length;
    const streamAt = src.indexOf('stream', start);
    const endAt = src.indexOf('endobj', start);
    if (endAt < 0) break;
    let dict = src.slice(start, endAt);
    let data: string | null = null;
    if (streamAt >= 0 && streamAt < endAt && src.slice(streamAt - 3, streamAt) !== 'end') {
      dict = src.slice(start, streamAt);
      let from = streamAt + 'stream'.length;
      if (src[from] === '\r') from += 1;
      if (src[from] === '\n') from += 1;
      const until = src.lastIndexOf('endstream', endAt);
      let to = until > from ? until : endAt;
      if (src[to - 1] === '\n') to -= 1;
      if (src[to - 1] === '\r') to -= 1;
      data = src.slice(from, to);
    }
    objects.set(Number(match[1]), { dict, data });
    header.lastIndex = endAt + 'endobj'.length;
  }
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.dict) || !object.data) continue;
    const body = decoded(object, inflate);
    const count = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1] ?? 0), first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    if (!body || !count || count > MAX_OBJECTS) continue;
    const numbers = body.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count && index * 2 + 1 < numbers.length; index += 1) {
      const number = numbers[index * 2]!, offset = numbers[index * 2 + 1]!;
      const next = index + 1 < count ? numbers[index * 2 + 3] ?? body.length - first : body.length - first;
      if (!objects.has(number)) objects.set(number, { dict: body.slice(first + offset, first + next), data: null });
    }
  }
  return objects;
}

/** A stream's bytes after its filters, or null when a filter is one this reader does not take (images and the like). */
function decoded(object: PdfObject, inflate: PdfTextOptions['inflate']): string | null {
  if (!object.data) return null;
  const filters = [...(/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(object.dict)?.[1] ?? '').matchAll(/\/(\w+)/g)].map(item => item[1]);
  let data = object.data;
  for (const filter of filters) {
    if ((filter !== 'FlateDecode' && filter !== 'Fl') || !inflate) return null;
    let plain: Uint8Array | null;
    try { plain = inflate(fromLatin1(data)); } catch { return null; }
    if (!plain) return null;
    data = toLatin1(plain);
  }
  return data;
}

/** The value of a key in a dictionary's text: a reference's number, a nested dictionary or array as text, or a token. */
function valueOf(dict: string, key: string): string | null {
  const at = new RegExp(String.raw`/${key}(?![A-Za-z0-9])\s*`).exec(dict);
  if (!at) return null;
  const rest = dict.slice(at.index + at[0].length);
  const ref = /^(\d+)\s+\d+\s+R\b/.exec(rest);
  if (ref) return `${ref[1]} R`;
  const open = rest.startsWith('<<') ? ['<<', '>>'] : rest.startsWith('[') ? ['[', ']'] : null;
  if (open) {
    let depth = 0;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest.startsWith(open[0]!, index)) { depth += 1; index += open[0]!.length - 1; }
      else if (rest.startsWith(open[1]!, index)) { depth -= 1; index += open[1]!.length - 1; if (depth === 0) return rest.slice(0, index + 1); }
    }
    return null;
  }
  return /^[^\s/<>\[\]()]+|^\/\w+/.exec(rest)?.[0] ?? null;
}

const refNumber = (value: string | null) => (value && / R$/.test(value) ? Number(value.slice(0, -2)) : null);
/** A dictionary given directly or by reference. */
function dictOf(objects: Map<number, PdfObject>, value: string | null): string | null {
  const number = refNumber(value);
  return number === null ? value : objects.get(number)?.dict ?? null;
}

/** The pages in page-tree order, at most max; else every page object in number order. */
function pagesOf(objects: Map<number, PdfObject>, src: string, max: number): PdfObject[] {
  const root = refNumber(/\/Root\s+(\d+\s+\d+\s+R)/.exec(src)?.[1] ?? null) ?? [...objects].find(([, object]) => /\/Type\s*\/Catalog\b/.test(object.dict))?.[0] ?? null;
  const pages: PdfObject[] = [];
  const seen = new Set<number>();
  const walk = (number: number | null) => {
    if (number === null || seen.has(number) || pages.length >= max) return;
    seen.add(number);
    const node = objects.get(number);
    if (!node) return;
    if (/\/Type\s*\/Page(?![s\w])/.test(node.dict)) { pages.push(node); return; }
    for (const kid of (valueOf(node.dict, 'Kids') ?? '').matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid[1]));
  };
  if (root !== null) walk(refNumber(valueOf(objects.get(root)?.dict ?? '', 'Pages')));
  if (pages.length) return pages;
  return [...objects.entries()].sort(([a], [b]) => a - b).map(([, object]) => object).filter(object => /\/Type\s*\/Page(?![s\w])/.test(object.dict)).slice(0, max);
}

/** A ToUnicode map: each code (as hex) to its text, and how many bytes a code takes. */
function toUnicode(text: string): { map: Map<string, string>; bytes: 1 | 2 } {
  const map = new Map<string, string>();
  const hexText = (hex: string) => { let out = ''; for (let at = 0; at + 4 <= hex.length; at += 4) out += String.fromCharCode(parseInt(hex.slice(at, at + 4), 16)); return out; };
  const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
  const bytes: 1 | 2 = space && space[1]!.length <= 2 ? 1 : 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(pair[1]!.toUpperCase(), hexText(pair[2]!));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const low = parseInt(range[1]!, 16), high = parseInt(range[2]!, 16), width = range[1]!.length;
      if (high < low || high - low > 65_535) continue;
      const targets = range[3]!.startsWith('[') ? [...range[3]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map(item => item[1]!) : null;
      const base = targets ? 0 : parseInt(range[3]!.slice(1, -1) || '0', 16);
      for (let code = low; code <= high; code += 1) {
        const key = code.toString(16).toUpperCase().padStart(width, '0');
        map.set(key, targets ? hexText(targets[code - low] ?? '') : String.fromCodePoint(base + code - low));
      }
    }
  }
  return { map, bytes };
}

function fontsOf(objects: Map<number, PdfObject>, page: PdfObject, inflate: PdfTextOptions['inflate']): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const resources = dictOf(objects, valueOf(page.dict, 'Resources'));
  const table = resources ? dictOf(objects, valueOf(resources, 'Font')) : null;
  for (const entry of (table ?? '').matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const font = objects.get(Number(entry[2]))?.dict ?? '';
    const cmap = refNumber(valueOf(font, 'ToUnicode'));
    const stream = cmap === null ? null : objects.get(cmap);
    const parsed = stream ? toUnicode(decoded(stream, inflate) ?? '') : null;
    const twoByte = /\/Subtype\s*\/Type0\b/.test(font);
    fonts.set(entry[1]!, { map: parsed && parsed.map.size ? parsed.map : null, bytes: parsed && parsed.map.size ? parsed.bytes : twoByte ? 2 : 1 });
  }
  return fonts;
}

/** The bytes of a literal string's body, escapes read. */
function literal(body: string): string {
  return body.replace(/\\(\r\n|[\r\n]|[0-7]{1,3}|.)/g, (_all, escape: string) => {
    if (/^[\r\n]/.test(escape)) return '';
    if (/^[0-7]+$/.test(escape)) return String.fromCharCode(parseInt(escape, 8) & 0xff);
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[escape] ?? escape;
  });
}

function shown(bytes: string, font: Font | undefined): string {
  if (!font) return bytes.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  if (!font.map) return font.bytes === 1 ? bytes.replace(/[^\x20-\x7E\xA0-\xFF]/g, '') : '';
  let out = '';
  for (let at = 0; at + font.bytes <= bytes.length; at += font.bytes) {
    const key = [...bytes.slice(at, at + font.bytes)].map(char => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
    out += font.map.get(key) ?? '';
  }
  return out;
}

/** The text one page's content shows. */
function pageText(content: string, fonts: Map<string, Font>): string {
  let out = '';
  let font: Font | undefined;
  const operands: (string | number | { array: (string | number)[] })[] = [];
  let array: (string | number)[] | null = null;
  let lineY: number | null = null;
  const space = () => { if (out && !/\s$/.test(out)) out += ' '; };
  const line = () => { out = out.replace(/ +$/, ''); if (out && !out.endsWith('\n')) out += '\n'; };
  const push = (value: string | number) => { if (array) array.push(value); else operands.push(value); };
  for (let at = 0; at < content.length;) {
    const char = content[at]!;
    if (/\s/.test(char)) { at += 1; continue; }
    if (char === '%') { const end = content.indexOf('\n', at); at = end < 0 ? content.length : end; continue; }
    if (char === '(') {
      let depth = 1, index = at + 1;
      for (; index < content.length && depth; index += 1) {
        if (content[index] === '\\') { index += 1; continue; }
        if (content[index] === '(') depth += 1;
        else if (content[index] === ')') depth -= 1;
      }
      push(`S${literal(content.slice(at + 1, index - 1))}`); at = index; continue;
    }
    if (char === '<' && content[at + 1] !== '<') {
      const end = content.indexOf('>', at);
      const hex = content.slice(at + 1, end < 0 ? content.length : end).replace(/\s/g, '');
      let bytes = '';
      for (let index = 0; index < hex.length; index += 2) bytes += String.fromCharCode(parseInt(hex.slice(index, index + 2).padEnd(2, '0'), 16));
      push(`S${bytes}`); at = end < 0 ? content.length : end + 1; continue;
    }
    if (char === '[') { array = []; at += 1; continue; }
    if (char === ']') { if (array) operands.push({ array }); array = null; at += 1; continue; }
    const token = /^(?:<<|>>|\/[^\s/<>\[\]()%]*|[+-]?(?:\d+\.?\d*|\.\d+)|[^\s/<>\[\]()%]+)/.exec(content.slice(at))?.[0] ?? char;
    at += token.length;
    if (/^[+-]?(?:\d|\.\d)/.test(token)) { push(Number(token)); continue; }
    if (token.startsWith('/') || token === '<<' || token === '>>') { push(token); continue; }
    // An operator.
    const strings = () => operands.filter((item): item is string => typeof item === 'string' && item.startsWith('S')).map(item => item.slice(1));
    switch (token) {
      case 'Tf': font = fonts.get(String(operands.find(item => typeof item === 'string' && item.startsWith('/')) ?? '').slice(1)); break;
      case 'Tj': out += shown(strings().join(''), font); break;
      case "'": case '"': line(); out += shown(strings().join(''), font); break;
      case 'TJ': {
        const items = (operands.find((item): item is { array: (string | number)[] } => typeof item === 'object') ?? { array: [] }).array;
        for (const item of items) {
          if (typeof item === 'number') { if (item < -200) space(); }
          else if (item.startsWith('S')) out += shown(item.slice(1), font);
        }
        break;
      }
      case 'T*': line(); break;
      case 'Td': case 'TD': {
        const [x = 0, y = 0] = operands.filter((item): item is number => typeof item === 'number');
        if (y !== 0) line(); else if (x > 0) space();
        break;
      }
      case 'Tm': {
        const numbers = operands.filter((item): item is number => typeof item === 'number');
        const y = numbers[5] ?? 0;
        if (lineY !== null && y !== lineY) line(); else if (lineY !== null) space();
        lineY = y;
        break;
      }
      case 'BT': lineY = null; break;
      case 'ET': line(); break;
      case 'ID': { const end = content.indexOf('EI', at); at = end < 0 ? content.length : end + 2; break; }
      default: break;
    }
    operands.length = 0; array = null;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

/**
 * The text of a PDF's first pages, a line per line of text, at most maxChars. PDF_ENCRYPTED for a locked file,
 * PDF_UNREADABLE for one that is not a PDF this reader can take. A file with no text in it gives ''.
 */
export function pdfText(bytes: Uint8Array, options: PdfTextOptions = {}): string {
  const maxPages = options.maxPages ?? 6, maxChars = options.maxChars ?? 20_000;
  const src = toLatin1(bytes);
  if (!src.startsWith('%PDF-')) fail('PDF_UNREADABLE', UNREADABLE);
  if (/\/Encrypt\s+(?:\d+\s+\d+\s+R|<<)/.test(src)) fail('PDF_ENCRYPTED', ENCRYPTED);
  const objects = readObjects(src, options.inflate);
  if (!objects.size) fail('PDF_UNREADABLE', UNREADABLE);
  const texts: string[] = [];
  for (const page of pagesOf(objects, src, maxPages)) {
    const contents = valueOf(page.dict, 'Contents');
    const numbers = contents === null ? [] : contents.startsWith('[') ? [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map(item => Number(item[1])) : [refNumber(contents)].filter((item): item is number => item !== null);
    const content = numbers.map(number => { const object = objects.get(number); return object ? decoded(object, options.inflate) ?? '' : ''; }).join('\n');
    const text = pageText(content, fontsOf(objects, page, options.inflate));
    if (text) texts.push(text);
  }
  return texts.join('\n').slice(0, maxChars).trim();
}
