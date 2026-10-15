// A minimal PDF reader for the PDFs Chromium saves (Skia's writer, the same one Electron's
// printToPDF uses): the page count from the /Type /Page objects, and each page's text from
// its content stream, through each font's /ToUnicode map. node:zlib only. It reads only
// what that writer produces: uncompressed cross-references, FlateDecode streams, Type0 and
// simple fonts with a ToUnicode CMap, and the Tf, Tj, TJ, ', ", Td, TD, Tm, T* and ET operators.
import { inflateSync } from 'node:zlib';

/** Every indirect object: its dictionary text and, when it has one, its decoded stream. */
export function readObjects(bytes) {
  const text = bytes.toString('latin1');
  const objects = new Map();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const streamAt = body.indexOf('stream');
    let dictionary = body, stream = null;
    if (streamAt >= 0 && /<<[\s\S]*>>\s*$/.test(body.slice(0, streamAt))) {
      dictionary = body.slice(0, streamAt);
      let from = start + streamAt + 'stream'.length;
      if (text[from] === '\r') from++;
      if (text[from] === '\n') from++;
      const lengthMatch = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dictionary);
      let length = lengthMatch && !lengthMatch[2] ? Number(lengthMatch[1]) : text.indexOf('endstream', from) - from;
      let raw = bytes.subarray(from, from + length);
      if (/\/FlateDecode/.test(dictionary)) { try { raw = inflateSync(raw); } catch { raw = Buffer.alloc(0); } }
      stream = raw;
    }
    objects.set(Number(match[1]), { dictionary, stream });
    pattern.lastIndex = end;
  }
  return objects;
}

const ref = (dictionary, key) => { const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dictionary); return match ? Number(match[1]) : null; };

/** A ToUnicode CMap: code (hex string) to text. */
export function parseToUnicode(cmap) {
  const map = new Map();
  const hexText = hex => { let out = ''; for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); return hex.length === 2 ? String.fromCharCode(parseInt(hex, 16)) : out; };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(pair[1].toLowerCase(), hexText(pair[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const low = parseInt(range[1], 16), high = parseInt(range[2], 16), width = range[1].length;
      if (range[3].startsWith('[')) {
        const items = [...range[3].matchAll(/<([0-9a-fA-F]*)>/g)].map(item => hexText(item[1]));
        for (let code = low; code <= high; code++) map.set(code.toString(16).padStart(width, '0'), items[code - low] ?? '');
      } else {
        const base = range[3].slice(1, -1);
        const first = parseInt(base.slice(-4), 16);
        for (let code = low; code <= high; code++) map.set(code.toString(16).padStart(width, '0'), hexText(base.slice(0, -4)) + String.fromCharCode(first + code - low));
      }
    }
  }
  const widths = [...new Set([...map.keys()].map(key => key.length))];
  return { map, width: widths.length === 1 ? widths[0] : 4 };
}

/** The text drawn by one content stream, a line break wherever the text moves to a new line. */
function contentText(content, fonts) {
  let out = '', font = null, lastY = null;
  const decode = hex => {
    if (!font) return '';
    let text = '';
    for (let i = 0; i + font.width <= hex.length; i += font.width) text += font.map.get(hex.slice(i, i + font.width).toLowerCase()) ?? '';
    return text;
  };
  const literal = value => value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[c] ?? String.fromCharCode(parseInt(c, 8)));
  const strings = operand => [...operand.matchAll(/<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\)])*)\)/g)].map(item => (item[1] !== undefined ? decode(item[1].replace(/\s+/g, '')) : literal(item[2])));
  const tokens = /\/(\S+)\s+[\d.]+\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+(-?[\d.]+)\s+Tm|(\[(?:<[^>]*>|\((?:\\.|[^\\)])*\)|[^\]])*\])\s*TJ|(<[^>]*>|\((?:\\.|[^\\)])*\))\s*(?:Tj|'|")|\bT\*|\bET\b/g;
  for (const match of content.matchAll(tokens)) {
    if (match[1] !== undefined) { font = fonts.get(match[1]) ?? null; continue; }
    if (match[2] !== undefined) { if (Number(match[3]) !== 0) { out += '\n'; } continue; }
    if (match[4] !== undefined) { const y = Number(match[4]); if (lastY !== null && Math.abs(y - lastY) > 0.5) out += '\n'; lastY = y; continue; }
    if (match[5] !== undefined) { out += strings(match[5]).join(''); continue; }
    if (match[6] !== undefined) { out += strings(match[6]).join(''); continue; }
    out += '\n';
  }
  return out;
}

/** The pages of a PDF and the text of each. */
export function readPdf(bytes) {
  const objects = readObjects(bytes);
  const pages = [...objects.entries()].filter(([, object]) => /\/Type\s*\/Page(?![s\w])/.test(object.dictionary));
  const resolveDict = (dictionary, key) => {
    const inline = new RegExp(`/${key}\\s*<<`).exec(dictionary);
    if (inline) { let depth = 0, i = inline.index + inline[0].length - 2; const start = i; for (; i < dictionary.length; i++) { if (dictionary.startsWith('<<', i)) { depth++; i++; } else if (dictionary.startsWith('>>', i)) { depth--; i++; if (depth === 0) break; } } return dictionary.slice(start, i + 1); }
    const id = ref(dictionary, key);
    return id === null ? '' : objects.get(id)?.dictionary ?? '';
  };
  return {
    pageCount: pages.length,
    pages: pages.map(([, page]) => {
      const resources = resolveDict(page.dictionary, 'Resources');
      const fontDict = resolveDict(resources, 'Font');
      const fonts = new Map();
      for (const entry of fontDict.matchAll(/\/(\S+?)\s+(\d+)\s+\d+\s+R/g)) {
        const font = objects.get(Number(entry[2]));
        const toUnicode = font ? ref(font.dictionary, 'ToUnicode') : null;
        const cmap = toUnicode === null ? null : objects.get(toUnicode)?.stream;
        fonts.set(entry[1], cmap ? parseToUnicode(cmap.toString('latin1')) : { map: new Map(), width: 2 });
      }
      const contents = [...(/\/Contents\s*\[([^\]]*)\]/.exec(page.dictionary)?.[1] ?? /\/Contents\s+(\d+\s+\d+\s+R)/.exec(page.dictionary)?.[1] ?? '').matchAll(/(\d+)\s+\d+\s+R/g)]
        .map(item => objects.get(Number(item[1]))?.stream?.toString('latin1') ?? '');
      return { text: contents.map(content => contentText(content, fonts)).join('\n') };
    }),
  };
}
