// Chausar hosted tier: the small part of CBOR (RFC 8949) that passkeys use. Definite lengths only, no tags, no
// floats: WebAuthn authenticators send canonical CBOR for the attestation object and the COSE public key.
// The encoder exists so tests can build authenticator responses offline.
import { ChausarError } from '../contracts.ts';

export type CborValue = number | bigint | string | Buffer | boolean | null | undefined | CborValue[] | Map<CborValue, CborValue>;

const MAX_ITEMS = 1024;
const MAX_DEPTH = 16;
const fail = (): never => { throw new ChausarError('PASSKEY_INVALID', 'The passkey response is malformed.'); };

function readLength(bytes: Buffer, at: number, info: number): { length: number | bigint; at: number } {
  if (info < 24) return { length: info, at };
  if (info === 24) { if (at + 1 > bytes.length) fail(); return { length: bytes[at], at: at + 1 }; }
  if (info === 25) { if (at + 2 > bytes.length) fail(); return { length: bytes.readUInt16BE(at), at: at + 2 }; }
  if (info === 26) { if (at + 4 > bytes.length) fail(); return { length: bytes.readUInt32BE(at), at: at + 4 }; }
  if (info === 27) { if (at + 8 > bytes.length) fail(); return { length: bytes.readBigUInt64BE(at), at: at + 8 }; }
  return fail();
}

function smallLength(value: number | bigint): number {
  if (typeof value === 'bigint') { if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(); return Number(value); }
  return value;
}

function decodeItem(bytes: Buffer, start: number, depth: number): { value: CborValue; at: number } {
  if (depth > MAX_DEPTH || start >= bytes.length) fail();
  const head = bytes[start], major = head >> 5, info = head & 31;
  const { length, at } = readLength(bytes, start + 1, info);
  switch (major) {
    case 0: return { value: typeof length === 'bigint' && length <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(length) : length, at };
    case 1: {
      if (typeof length === 'bigint') return { value: -1n - length, at };
      return { value: -1 - length, at };
    }
    case 2: case 3: {
      const size = smallLength(length);
      if (at + size > bytes.length) fail();
      const slice = bytes.subarray(at, at + size);
      return { value: major === 2 ? Buffer.from(slice) : slice.toString('utf8'), at: at + size };
    }
    case 4: {
      const count = smallLength(length);
      if (count > MAX_ITEMS) fail();
      const items: CborValue[] = [];
      let cursor = at;
      for (let i = 0; i < count; i++) { const item = decodeItem(bytes, cursor, depth + 1); items.push(item.value); cursor = item.at; }
      return { value: items, at: cursor };
    }
    case 5: {
      const count = smallLength(length);
      if (count > MAX_ITEMS) fail();
      const map = new Map<CborValue, CborValue>();
      let cursor = at;
      for (let i = 0; i < count; i++) {
        const key = decodeItem(bytes, cursor, depth + 1);
        if (typeof key.value !== 'number' && typeof key.value !== 'string') fail();
        if (map.has(key.value)) fail();
        const item = decodeItem(bytes, key.at, depth + 1);
        map.set(key.value, item.value);
        cursor = item.at;
      }
      return { value: map, at: cursor };
    }
    case 7: {
      if (info === 20) return { value: false, at };
      if (info === 21) return { value: true, at };
      if (info === 22) return { value: null, at };
      if (info === 23) return { value: undefined, at };
      return fail();
    }
    default: return fail();
  }
}

/** Decodes one item from the start of bytes and says where it ended (the COSE key sits inside authenticator data). */
export function decodeFirst(bytes: Buffer, start = 0): { value: CborValue; end: number } {
  const { value, at } = decodeItem(bytes, start, 0);
  return { value, end: at };
}

/** Decodes exactly one item; trailing bytes are refused. */
export function decodeCbor(bytes: Buffer): CborValue {
  const { value, end } = decodeFirst(bytes);
  if (end !== bytes.length) fail();
  return value;
}

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(length, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(length, 1); return b;
}

/** Canonical enough for tests: integers, text, bytes, arrays, maps, booleans and null. */
export function encodeCbor(value: CborValue): Buffer {
  if (value === null) return Buffer.from([0xf6]);
  if (value === undefined) return Buffer.from([0xf7]);
  if (value === true) return Buffer.from([0xf5]);
  if (value === false) return Buffer.from([0xf4]);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Only integers are supported.');
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'bigint') throw new Error('Big integers are not supported by this encoder.');
  if (typeof value === 'string') { const text = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, text.length), text]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)])]);
  throw new Error('Unsupported CBOR value.');
}
