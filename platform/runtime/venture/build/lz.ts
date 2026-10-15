// URI-safe LZ compression for the Replit brief link.
// The algorithm is lz-string by pieroxy (MIT licence), rewritten here without copying its source:
// a clean-room TypeScript port of the R5 research prototype. Only the two URI-safe functions are kept.
// Replit decodes its `prompt` query value with lz-string's decompressFromEncodedURIComponent, so this must
// produce byte-for-byte the same output. Golden values live in platform/tests/venture-build.test.ts.
// The import comes first on purpose: `node --check` treats a .ts file as module code only when module syntax
// appears before the first type annotation.
import { check } from '../../contracts.ts';

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';

function compressCore(input: string, bitsPerChar: number, toChar: (value: number) => string): string {
  const dict = new Map<string, number>();
  const toCreate = new Set<string>();
  const out: string[] = [];
  let w = '';
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  let val = 0;
  let pos = 0;

  const writeBits = (count: number, value: number) => {
    let rest = value;
    for (let i = 0; i < count; i++) {
      val = (val << 1) | (rest & 1);
      if (pos === bitsPerChar - 1) {
        pos = 0;
        out.push(toChar(val));
        val = 0;
      } else {
        pos++;
      }
      rest >>= 1;
    }
  };
  const grow = () => {
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  };
  const emit = () => {
    if (toCreate.has(w)) {
      const code = w.charCodeAt(0);
      if (code < 256) {
        writeBits(numBits, 0);
        writeBits(8, code);
      } else {
        writeBits(numBits, 1);
        writeBits(16, code);
      }
      grow();
      toCreate.delete(w);
    } else {
      writeBits(numBits, dict.get(w) as number);
    }
    grow();
  };

  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    if (!dict.has(c)) {
      dict.set(c, dictSize++);
      toCreate.add(c);
    }
    const wc = w + c;
    if (dict.has(wc)) {
      w = wc;
    } else {
      emit();
      dict.set(wc, dictSize++);
      w = c;
    }
  }
  if (w !== '') emit();
  writeBits(numBits, 2); // end of stream
  for (;;) {
    val = val << 1;
    if (pos === bitsPerChar - 1) {
      out.push(toChar(val));
      break;
    }
    pos++;
  }
  return out.join('');
}

function decompressCore(length: number, resetValue: number, getNextValue: (index: number) => number): string | null {
  const dict: string[] = ['', '', ''];
  const result: string[] = [];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  const readBits = (count: number): number => {
    let bits = 0;
    let power = 1;
    const max = 2 ** count;
    while (power !== max) {
      const bit = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (bit > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  let c: string;
  switch (readBits(2)) {
    case 0: c = String.fromCharCode(readBits(8)); break;
    case 1: c = String.fromCharCode(readBits(16)); break;
    case 2: return '';
    default: return null;
  }
  dict[3] = c;
  let w = c;
  result.push(c);
  for (;;) {
    if (data.index > length) return '';
    let code = readBits(numBits);
    switch (code) {
      case 0:
        dict[dictSize++] = String.fromCharCode(readBits(8));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dict[dictSize++] = String.fromCharCode(readBits(16));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: string;
    if (dict[code]) entry = dict[code];
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dict[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

/** Same output as lz-string's compressToEncodedURIComponent. */
export function compressToEncodedURIComponent(input: string): string {
  if (input === null || input === undefined) return '';
  check(typeof input === 'string', 'INVALID_VENTURE_REQUEST', 'Only text can be compressed.');
  return compressCore(input, 6, value => KEY.charAt(value));
}

/** Same output as lz-string's decompressFromEncodedURIComponent: '' for null, null for '' or a broken stream. */
export function decompressFromEncodedURIComponent(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return '';
  if (input === '') return null;
  const text = input.replace(/ /g, '+');
  return decompressCore(text.length, 32, index => KEY.indexOf(text.charAt(index)));
}
