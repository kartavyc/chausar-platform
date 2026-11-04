// One-shot A4 (hands-on row 9): the text of an ordinary PDF, read by code on this computer, for About you's resume. The
// trusted Python helper (pdf.extract) is not part of the desktop beta, so without this every resume was refused.
//
// What it reads: the pages in the order of the page tree (objects plain or inside object streams, contents compressed
// with FlateDecode or not), and the text shown on them with Tj, TJ, ' and ", through each font's ToUnicode map when it
// has one (two-byte codes included, as Word, Google Docs and LibreOffice write them), else as single bytes. A wide gap
// inside TJ, or a move along the line, is a space; a move to a new line is a line break.
// What it does not: OCR (a scanned page gives no text), forms, images, encrypted files (refused, PDF_ENCRYPTED), or any
// script or action in the file. Nothing in the file is run or followed; it is only read as data.
// A4 review (M3): one work budget per read, so no file can hold the engine. Inflated bytes across every stream (8 MB),
// map entries (50,000 codes and ranges; a range is looked up by its bounds, never walked code by code) and objects
// (20,000) are counted; an object stream is opened only when an object in it is needed. A budget that runs out refuses
// the file in plain words (PDF_TOO_COMPLEX).
// No imports but the refusal brand: the fake engine reads with this same code (pdf-text.ts gives the engine zlib).
import { refusalError } from '../refusal-brand.ts';

/** What inflate answers: the plain bytes, null when it cannot, or 'too-large' when they would pass the limit given. */
export type InflateResult = Uint8Array | null | 'too-large';
/** inflate: FlateDecode's bytes to plain bytes, at most limit of them; without it a compressed stream is skipped. */
export type PdfTextOptions = { maxPages?: number; maxChars?: number; inflate?: (bytes: Uint8Array, limit: number) => InflateResult };
/** A stream's data is kept as a latin1 string: one character per byte. */
type PdfObject = { dict: string; data: string | null };
/** A ToUnicode range, kept by its bounds: each code to the target's UTF-16 units with the last one counted up, or a list. */
type Range = { low: number; high: number; width: number; units: number[] | null; list: string[] | null };
type Font = { map: Map<string, string> | null; ranges: Range[]; bytes: 1 | 2 };

const UNREADABLE = 'Chausar could not read that PDF. Paste a few lines about your work instead.';
const ENCRYPTED = 'That PDF is locked with a password, so Chausar cannot read it. Save it again without a password, or paste a few lines about your work.';
const TOO_COMPLEX = 'This PDF is too complex to read. Paste the text instead.';
/** The work one read may do. */
export const PDF_BUDGET = Object.freeze({ inflatedBytes: 8 * 1024 * 1024, mapEntries: 50_000, objects: 20_000 });

const fail = (code: 'PDF_UNREADABLE' | 'PDF_ENCRYPTED' | 'PDF_TOO_COMPLEX', message: string): never => { throw refusalError(new Error(message), { code }); };
const tooComplex = (): never => fail('PDF_TOO_COMPLEX', TOO_COMPLEX);
const toLatin1 = (bytes: Uint8Array): string => { let out = ''; for (let at = 0; at < bytes.length; at += 8192) out += String.fromCharCode(...bytes.subarray(at, at + 8192)); return out; };
const fromLatin1 = (text: string): Uint8Array => { const bytes = new Uint8Array(text.length); for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at) & 0xff; return bytes; };
/** Hex digits as UTF-16BE code units, so a surrogate pair or a ligature (two or more units) reads whole. */
const unitsOf = (hex: string): number[] => { const units: number[] = []; for (let at = 0; at + 4 <= hex.length; at += 4) units.push(parseInt(hex.slice(at, at + 4), 16)); return units; };
const textOf = (units: readonly number[]): string => String.fromCharCode(...units);

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

/** One read of one file, with its budget, its objects found so far, and its object streams opened only on need. */
class Reader {
  readonly objects = new Map<number, PdfObject>();
  readonly #streams: PdfObject[] = [];
  readonly #decoded = new Map<PdfObject, string | null>();
  readonly #fonts = new Map<number, Font>();
  #inflated = 0;
  #entries = 0;
  readonly src: string;
  readonly inflate: PdfTextOptions['inflate'];
  constructor(src: string, inflate: PdfTextOptions['inflate']) {
    this.src = src; this.inflate = inflate;
    const header = /(\d+)\s+(\d+)\s+obj\b/g;
    let match: RegExpExecArray | null;
    while ((match = header.exec(src))) {
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
      const object = { dict, data };
      this.#count();
      this.objects.set(Number(match[1]), object);
      if (data && /\/Type\s*\/ObjStm\b/.test(dict)) this.#streams.push(object);
      header.lastIndex = endAt + 'endobj'.length;
    }
  }
  #count() { if (this.objects.size >= PDF_BUDGET.objects) tooComplex(); }
  /** One map entry (a code or a range) more. */
  entry() { this.#entries += 1; if (this.#entries > PDF_BUDGET.mapEntries) tooComplex(); }

  /** An object by number: a plain one, else from the next object stream not yet opened, until found or none are left. */
  get(number: number | null): PdfObject | undefined {
    if (number === null) return undefined;
    while (!this.objects.has(number) && this.#streams.length) this.#open(this.#streams.shift()!);
    return this.objects.get(number);
  }
  /** Every object stream opened (for a file whose page tree could not be walked). */
  openAll() { while (this.#streams.length) this.#open(this.#streams.shift()!); }
  #open(stream: PdfObject) {
    const body = this.decoded(stream);
    const count = Number(/\/N\s+(\d+)/.exec(stream.dict)?.[1] ?? 0), first = Number(/\/First\s+(\d+)/.exec(stream.dict)?.[1] ?? 0);
    if (!body || !count) return;
    if (count > PDF_BUDGET.objects) tooComplex();
    const numbers = body.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count && index * 2 + 1 < numbers.length; index += 1) {
      const number = numbers[index * 2]!, offset = numbers[index * 2 + 1]!;
      const next = index + 1 < count ? numbers[index * 2 + 3] ?? body.length - first : body.length - first;
      if (this.objects.has(number)) continue;
      this.#count();
      this.objects.set(number, { dict: body.slice(first + offset, first + next), data: null });
    }
  }

  /** A stream's bytes after its filters, or null when a filter is one this reader does not take (images and the like). */
  decoded(object: PdfObject): string | null {
    if (this.#decoded.has(object)) return this.#decoded.get(object)!;
    let data = object.data;
    if (data !== null) {
      const filters = [...(/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(object.dict)?.[1] ?? '').matchAll(/\/(\w+)/g)].map(item => item[1]);
      for (const filter of filters) {
        if ((filter !== 'FlateDecode' && filter !== 'Fl') || !this.inflate) { data = null; break; }
        let plain: InflateResult;
        try { plain = this.inflate(fromLatin1(data), PDF_BUDGET.inflatedBytes - this.#inflated); } catch { plain = null; }
        if (plain === 'too-large') return tooComplex();
        if (!plain) { data = null; break; }
        this.#inflated += plain.length;
        if (this.#inflated > PDF_BUDGET.inflatedBytes) tooComplex();
        data = toLatin1(plain);
      }
    }
    this.#decoded.set(object, data);
    return data;
  }

  /** A dictionary given directly or by reference. */
  dictOf(value: string | null): string | null {
    const number = refNumber(value);
    return number === null ? value : this.get(number)?.dict ?? null;
  }

  /** A font's codes: its ToUnicode map (codes and ranges, each counted), kept per font object. */
  font(number: number): Font {
    const known = this.#fonts.get(number);
    if (known) return known;
    const dict = this.get(number)?.dict ?? '';
    const stream = this.get(refNumber(valueOf(dict, 'ToUnicode')));
    const parsed = stream ? this.#toUnicode(this.decoded(stream) ?? '') : null;
    const found = parsed && ((parsed.map?.size ?? 0) || parsed.ranges.length) ? parsed : null;
    const font: Font = found ? { ...found } : { map: null, ranges: [], bytes: /\/Subtype\s*\/Type0\b/.test(dict) ? 2 : 1 };
    this.#fonts.set(number, font);
    return font;
  }
  #toUnicode(text: string): Font {
    const map = new Map<string, string>();
    const ranges: Range[] = [];
    const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
    const bytes: 1 | 2 = space && space[1]!.length <= 2 ? 1 : 2;
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) { this.entry(); map.set(pair[1]!.toUpperCase(), textOf(unitsOf(pair[2]!))); }
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
        this.entry();
        const low = parseInt(range[1]!, 16), high = parseInt(range[2]!, 16);
        if (high < low) continue;
        const list = range[3]!.startsWith('[') ? [...range[3]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map(item => textOf(unitsOf(item[1]!))) : null;
        ranges.push({ low, high, width: range[1]!.length, units: list ? null : unitsOf(range[3]!.slice(1, -1)), list });
      }
    }
    return { map, ranges, bytes };
  }
}

/** A code's text in a font: its own entry, else the first range that holds it (the target's last unit counted up). */
function codeText(font: Font, key: string): string {
  const own = font.map?.get(key);
  if (own !== undefined) return own;
  const code = parseInt(key, 16);
  for (const range of font.ranges) {
    if (code < range.low || code > range.high || key.length !== range.width) continue;
    if (range.list) return range.list[code - range.low] ?? '';
    const units = [...range.units!];
    if (!units.length) return '';
    units[units.length - 1] = (units[units.length - 1]! + code - range.low) & 0xffff;
    return textOf(units);
  }
  return '';
}

/** The pages in page-tree order, at most max; else every page object in number order. */
function pagesOf(reader: Reader, max: number): PdfObject[] {
  const root = refNumber(/\/Root\s+(\d+\s+\d+\s+R)/.exec(reader.src)?.[1] ?? null) ?? [...reader.objects].find(([, object]) => /\/Type\s*\/Catalog\b/.test(object.dict))?.[0] ?? null;
  const pages: PdfObject[] = [];
  const seen = new Set<number>();
  const walk = (number: number | null) => {
    if (number === null || seen.has(number) || pages.length >= max) return;
    seen.add(number);
    const node = reader.get(number);
    if (!node) return;
    if (/\/Type\s*\/Page(?![s\w])/.test(node.dict)) { pages.push(node); return; }
    for (const kid of (valueOf(node.dict, 'Kids') ?? '').matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid[1]));
  };
  if (root !== null) walk(refNumber(valueOf(reader.get(root)?.dict ?? '', 'Pages')));
  if (pages.length) return pages;
  reader.openAll();
  return [...reader.objects.entries()].sort(([a], [b]) => a - b).map(([, object]) => object).filter(object => /\/Type\s*\/Page(?![s\w])/.test(object.dict)).slice(0, max);
}

function fontsOf(reader: Reader, page: PdfObject): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const resources = reader.dictOf(valueOf(page.dict, 'Resources'));
  const table = resources ? reader.dictOf(valueOf(resources, 'Font')) : null;
  for (const entry of (table ?? '').matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(entry[1]!, reader.font(Number(entry[2])));
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
  if (!font.map && !font.ranges.length) return font.bytes === 1 ? bytes.replace(/[^\x20-\x7E\xA0-\xFF]/g, '') : '';
  let out = '';
  for (let at = 0; at + font.bytes <= bytes.length; at += font.bytes) {
    out += codeText(font, [...bytes.slice(at, at + font.bytes)].map(char => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(''));
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
    const token = /^(?:<<|>>|\/[^\s/<>\[\]()%]*|[+-]?(?:\d+\.?\d*|\.\d+)|[^\s/<>\[\]()%]+)/.exec(content.slice(at, at + 256))?.[0] ?? char;
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
 * PDF_TOO_COMPLEX for one past the work budget, PDF_UNREADABLE for one this reader cannot take. No text gives ''.
 */
export function pdfText(bytes: Uint8Array, options: PdfTextOptions = {}): string {
  const maxPages = options.maxPages ?? 6, maxChars = options.maxChars ?? 20_000;
  const src = toLatin1(bytes);
  if (!src.startsWith('%PDF-')) fail('PDF_UNREADABLE', UNREADABLE);
  // A4 review (L2): with or without a space before the dictionary or the reference.
  if (/\/Encrypt(?![A-Za-z0-9])\s*(?:\d+\s+\d+\s+R|<<)/.test(src)) fail('PDF_ENCRYPTED', ENCRYPTED);
  const reader = new Reader(src, options.inflate);
  if (!reader.objects.size) fail('PDF_UNREADABLE', UNREADABLE);
  const texts: string[] = [];
  for (const page of pagesOf(reader, maxPages)) {
    const contents = valueOf(page.dict, 'Contents');
    const numbers = contents === null ? [] : contents.startsWith('[') ? [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map(item => Number(item[1])) : [refNumber(contents)].filter((item): item is number => item !== null);
    const content = numbers.map(number => { const object = reader.get(number); return object ? reader.decoded(object) ?? '' : ''; }).join('\n');
    const text = pageText(content, fontsOf(reader, page));
    if (text) texts.push(text);
  }
  return texts.join('\n').slice(0, maxChars).trim();
}
