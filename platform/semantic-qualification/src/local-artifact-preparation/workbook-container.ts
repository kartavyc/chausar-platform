import { inflateRawSync } from 'node:zlib';
import { requireThat, SemanticError } from '../validation.ts';
import { PREPARATION_LIMITS } from './contracts.ts';

/** Deliberately narrow in-memory package profile, not universal ZIP or Excel support. */
export const WORKBOOK_CONTAINER_PROFILE = Object.freeze({
  zip: Object.freeze({ methods: Object.freeze([0, 8]), maxNameBytes: 240,
    descriptors: false, extras: false, comments: false, directories: false,
    encrypted: false, zip64: false, multiDisk: false }),
  xml: Object.freeze({ encoding: 'UTF-8', version: '1.0', maxDepth: 32,
    maxNodes: 100000, maxScalarLength: 20000, maxAttributes: 32,
    dtd: false, cdata: false, comments: false, processingInstructions: false }),
});

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Shared canonical name policy for archive parsing and reversible evidence identities. */
export function assertWorkbookMemberName(name: unknown): asserts name is string {
  requireThat(typeof name === 'string' && name.length > 0 && name.length <= WORKBOOK_CONTAINER_PROFILE.zip.maxNameBytes
    && /^[\x21-\x7e]+$/.test(name),
  'UNSAFE_ZIP_PATH', 'Package names must use bounded portable ASCII without spaces.');
  requireThat(name === '[Content_Types].xml' || name.split('/').every(segment =>
    /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== '.' && segment !== '..'
    && !segment.endsWith('.') && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)),
  'UNSAFE_ZIP_PATH', 'Traversal, absolute paths, directories and ambiguous package names are refused.');
}
function packageName(bytes: Uint8Array): string {
  requireThat(bytes.every(byte => byte < 128), 'UNSAFE_ZIP_PATH', 'Package member names must be ASCII.');
  const name = Buffer.from(bytes).toString('ascii'); assertWorkbookMemberName(name);
  return name;
}

type ZipPart = { name: string; offset: number; end: number; dataOffset: number;
  compressed: number; uncompressed: number; method: number; crc: number };

/** Reads original ZIP bytes only; never extracts files or retrieves relationships. */
export function readWorkbookContainer(input: Uint8Array): Map<string, Uint8Array> {
  requireThat(input instanceof Uint8Array && input.byteLength > 0
    && input.byteLength <= PREPARATION_LIMITS.originalBytes,
  'WORKBOOK_LIMIT', 'Original workbook bytes must fit the fixed 16 MiB preparation limit.');
  const bytes = Buffer.from(input);
  requireThat(bytes.length >= 22 && bytes.readUInt32LE(0) === 0x04034b50,
    'UNSUPPORTED_WORKBOOK', 'Only literal OOXML ZIP packages are supported; binary and encrypted Office files are refused.');
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      eocd = at; break;
    }
  }
  requireThat(eocd >= 0, 'INVALID_ZIP', 'The ZIP directory is missing, truncated or followed by unindexed bytes.');
  requireThat(bytes.readUInt16LE(eocd + 20) === 0, 'UNSUPPORTED_ZIP', 'ZIP archive comments are outside the supported profile.');
  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  requireThat(bytes.readUInt16LE(eocd + 4) === 0 && bytes.readUInt16LE(eocd + 6) === 0
    && bytes.readUInt16LE(eocd + 8) === entries && entries !== 0xffff
    && directorySize !== 0xffffffff && directoryOffset !== 0xffffffff,
  'UNSUPPORTED_ZIP', 'Multi-disk and ZIP64 archives are refused.');
  requireThat(entries > 0 && entries <= PREPARATION_LIMITS.parts,
    'WORKBOOK_LIMIT', 'A workbook must contain 1–256 package parts.');
  requireThat(directoryOffset + directorySize === eocd && directoryOffset > 0,
    'INVALID_ZIP', 'The ZIP directory does not occupy its exact declared span.');
  const parts: ZipPart[] = [];
  const names = new Set<string>();
  let position = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < entries; index++) {
    requireThat(position + 46 <= eocd && bytes.readUInt32LE(position) === 0x02014b50,
      'INVALID_ZIP', 'Invalid or truncated ZIP central entry.');
    const version = bytes.readUInt16LE(position + 6);
    const flags = bytes.readUInt16LE(position + 8);
    const method = bytes.readUInt16LE(position + 10);
    const crc = bytes.readUInt32LE(position + 16);
    const compressed = bytes.readUInt32LE(position + 20);
    const uncompressed = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const offset = bytes.readUInt32LE(position + 42);
    requireThat(!(flags & 0x2041), 'ENCRYPTED_ZIP', 'Encrypted ZIP entries are refused.');
    requireThat(!(flags & 8), 'UNSUPPORTED_ZIP', 'ZIP data descriptors are outside the supported profile.');
    requireThat((flags & ~0x0806) === 0 && (method === 8 || (flags & 6) === 0)
      && (method === 0 || method === 8) && (version === 10 || version === 20)
      && (method !== 8 || version === 20),
    'UNSUPPORTED_ZIP', 'Only stored/raw-deflate entries with supported flags and versions are accepted.');
    requireThat(bytes.readUInt16LE(position + 34) === 0 && compressed !== 0xffffffff
      && uncompressed !== 0xffffffff && offset !== 0xffffffff,
    'UNSUPPORTED_ZIP', 'Multi-disk and ZIP64 entries are refused.');
    requireThat(extraLength === 0 && commentLength === 0,
      'UNSUPPORTED_ZIP', 'ZIP extra fields and member comments are outside the supported profile.');
    const external = bytes.readUInt32LE(position + 38);
    const fileType = (external >>> 16) & 0xf000;
    requireThat((fileType === 0 || fileType === 0x8000) && !(external & 0x18),
      'ZIP_LINK_REFUSED', 'ZIP links, directories and other nonregular entries are refused.');
    requireThat(position + 46 + nameLength <= eocd,
      'INVALID_ZIP', 'Truncated ZIP name metadata.');
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    const name = packageName(nameBytes);
    requireThat(!names.has(name.toLowerCase()), 'INVALID_ZIP', 'Duplicate and case-aliasing ZIP names are refused.');
    names.add(name.toLowerCase());
    requireThat(offset + 30 <= directoryOffset && bytes.readUInt32LE(offset) === 0x04034b50,
      'INVALID_ZIP', 'Invalid or truncated ZIP local entry.');
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtraLength = bytes.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + localNameLength + localExtraLength;
    requireThat(localExtraLength === 0, 'UNSUPPORTED_ZIP', 'Local ZIP extra fields are outside the supported profile.');
    requireThat(dataOffset + compressed <= directoryOffset && localNameLength === nameLength
      && bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(nameBytes)
      && bytes.readUInt16LE(offset + 4) === version && bytes.readUInt16LE(offset + 6) === flags
      && bytes.readUInt16LE(offset + 8) === method
      && bytes.readUInt16LE(offset + 10) === bytes.readUInt16LE(position + 12)
      && bytes.readUInt16LE(offset + 12) === bytes.readUInt16LE(position + 14)
      && bytes.readUInt32LE(offset + 14) === crc && bytes.readUInt32LE(offset + 18) === compressed
      && bytes.readUInt32LE(offset + 22) === uncompressed,
    'INVALID_ZIP', 'Local ZIP names, timestamps, flags, sizes and CRC must agree with the directory.');
    requireThat(uncompressed <= PREPARATION_LIMITS.expandedBytes
      && expanded + uncompressed <= PREPARATION_LIMITS.expandedBytes,
    'WORKBOOK_LIMIT', 'Inflated package bytes exceed the fixed aggregate 32 MiB limit.');
    requireThat((method !== 0 || compressed === uncompressed) && (uncompressed === 0 || compressed > 0),
      'INVALID_ZIP', 'ZIP entry sizes are inconsistent.');
    expanded += uncompressed;
    parts.push({ name, offset, end: dataOffset + compressed, dataOffset, compressed, uncompressed, method, crc });
    position += 46 + nameLength;
  }
  requireThat(position === eocd, 'INVALID_ZIP', 'ZIP central entries do not fill their declared directory.');
  const spans = [...parts].sort((a, b) => a.offset - b.offset);
  requireThat(spans[0].offset === 0 && spans.at(-1)!.end === directoryOffset
    && spans.every((part, index) => index === 0 || part.offset === spans[index - 1].end),
  'INVALID_ZIP', 'Overlapping entries, archive prefixes, unindexed payloads and gaps are refused.');
  const files = new Map<string, Uint8Array>();
  for (const part of parts) {
    const packed = bytes.subarray(part.dataOffset, part.end);
    let unpacked: Buffer;
    if (part.method === 0) unpacked = Buffer.from(packed);
    else {
      try {
        // Node's synchronous info result reports consumed compressed input, not output bytes.
        const result = inflateRawSync(packed, { info: true, maxOutputLength: Math.max(1, part.uncompressed) }) as unknown as
          { buffer: Buffer; engine: { bytesWritten: number } };
        requireThat(result.engine.bytesWritten === packed.length,
          'INVALID_ZIP', 'Deflate streams with trailing packed bytes are refused.');
        unpacked = result.buffer;
      } catch (error) {
        if (error instanceof SemanticError) throw error;
        throw new SemanticError('INVALID_ZIP', 'Deflated bytes are corrupt or exceed the declared bounded size.');
      }
    }
    requireThat(unpacked.length === part.uncompressed && crc32(unpacked) === part.crc,
      'ZIP_CRC_MISMATCH', 'Workbook entry bytes failed exact size or CRC verification.');
    files.set(part.name, unpacked);
  }
  return files;
}

export type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[];
  /** Decoded character data without number/date conversion or line-ending normalization. */
  text: string;
  /** Original character-data lexemes before entity decoding; excludes child element markup. */
  rawText: string };
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const XML_SPACE = /^[ \t\r\n]*$/;
const QNAME = '[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
function xmlName(name: string): void {
  requireThat(new RegExp(`^${QNAME}$`).test(name) && name.length <= 200
    && !name.split(':').some(segment => RESERVED.has(segment)),
  'INVALID_OPENXML', 'Only bounded ASCII qualified XML names without reserved keys are supported.');
}
function xmlCharacter(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}
function entities(value: string): string {
  requireThat(value.length <= WORKBOOK_CONTAINER_PROFILE.xml.maxScalarLength,
    'WORKBOOK_LIMIT', 'XML scalar text exceeds 20,000 characters.');
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&([^;]*);|&/g, (_match, entity: string | undefined) => {
    requireThat(entity !== undefined, 'INVALID_OPENXML', 'An XML entity is unterminated.');
    if (Object.hasOwn(named, entity)) return named[entity];
    requireThat(/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(entity),
      'UNSUPPORTED_XML_ENTITY', 'Only predefined and numeric XML character entities are accepted.');
    const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    requireThat(xmlCharacter(code), 'INVALID_OPENXML', 'An XML character entity is invalid for XML 1.0.');
    return String.fromCodePoint(code);
  });
}
function attributes(source: string): { values: Record<string, string>; order: string[] } {
  const values: Record<string, string> = Object.create(null);
  const order: string[] = [];
  let position = 0;
  const matcher = new RegExp(`[ \\t\\r\\n]+(${QNAME})[ \\t\\r\\n]*=[ \\t\\r\\n]*("[^"]*"|'[^']*')`, 'y');
  while (position < source.length && !XML_SPACE.test(source.slice(position))) {
    matcher.lastIndex = position;
    const match = matcher.exec(source);
    requireThat(match && match.index === position,
      'INVALID_OPENXML', 'Malformed XML attribute syntax.');
    const name = match[1];
    xmlName(name);
    requireThat(!Object.hasOwn(values, name) && !match[2].includes('<'),
      'INVALID_OPENXML', 'Duplicate XML attributes and literal attribute markup are refused.');
    requireThat(order.length < WORKBOOK_CONTAINER_PROFILE.xml.maxAttributes,
      'WORKBOOK_LIMIT', 'XML elements may have at most 32 attributes.');
    values[name] = entities(match[2].slice(1, -1));
    order.push(name);
    position = matcher.lastIndex;
  }
  return { values, order };
}

/** Strict bounded UTF-8 XML 1.0 subset. Namespace meaning is checked by the workbook caller. */
export function parseWorkbookXml(bytes: Uint8Array): XmlNode {
  requireThat(bytes instanceof Uint8Array && bytes.length <= PREPARATION_LIMITS.expandedBytes,
    'WORKBOOK_LIMIT', 'XML bytes exceed the fixed package expansion limit.');
  let xml: string;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new SemanticError('INVALID_OPENXML', 'Package XML must be valid UTF-8.'); }
  for (const character of xml) requireThat(xmlCharacter(character.codePointAt(0)!),
    'INVALID_OPENXML', 'XML contains a character outside XML 1.0.');
  const document: XmlNode = { name: '#document', attributes: Object.create(null), children: [], text: '', rawText: '' };
  const stack: XmlNode[] = [document];
  let offset = 0;
  let nodes = 0;
  let declared = false;
  while (offset < xml.length) {
    if (xml[offset] !== '<') {
      const end = xml.indexOf('<', offset);
      const value = xml.slice(offset, end === -1 ? xml.length : end);
      requireThat(!value.includes(']]>'), 'INVALID_OPENXML', 'Literal CDATA terminators are invalid XML text.');
      if (stack.length === 1) requireThat(XML_SPACE.test(value), 'INVALID_OPENXML', 'Text outside the XML root is refused.');
      const current = stack.at(-1)!;
      requireThat(current.rawText.length + value.length <= WORKBOOK_CONTAINER_PROFILE.xml.maxScalarLength,
        'WORKBOOK_LIMIT', 'Accumulated XML scalar text exceeds 20,000 characters.');
      current.rawText += value;
      current.text += entities(value);
      offset += value.length;
      continue;
    }
    let end = offset + 1;
    let quote = '';
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    requireThat(end < xml.length && !quote, 'INVALID_OPENXML', 'An XML tag is truncated.');
    const token = xml.slice(offset, end + 1);
    if (token.startsWith('<?xml') && /^<\?xml[ \t\r\n]/.test(token)) {
      requireThat(offset === 0 && !declared && token.endsWith('?>'),
        'INVALID_OPENXML', 'The XML declaration must occur exactly once at the document start.');
      requireThat(!token.includes('&'), 'INVALID_OPENXML', 'XML declaration values must be literal tokens.');
      const declaration = attributes(token.slice(5, -2));
      requireThat(declaration.order[0] === 'version' && declaration.values.version === '1.0'
        && declaration.order.every((name, index) => index === 0 ? name === 'version'
          : name === 'encoding' ? index === 1 : name === 'standalone' && (index === 1 || index === 2))
        && (declaration.values.encoding === undefined || /^(?:UTF-8|utf-8)$/.test(declaration.values.encoding))
        && (declaration.values.standalone === undefined || /^(?:yes|no)$/.test(declaration.values.standalone)),
      'INVALID_OPENXML', 'Only an XML 1.0 UTF-8 declaration with optional standalone is supported.');
      declared = true;
    } else if (token.startsWith('</')) {
      const close = new RegExp(`^</(${QNAME})[ \\t\\r\\n]*>$`).exec(token);
      requireThat(close && stack.length > 1 && stack.at(-1)!.name === close[1],
        'INVALID_OPENXML', 'XML closing tags must match their opening tags.');
      stack.pop();
    } else {
      requireThat(!token.startsWith('<!') && !token.startsWith('<?'),
        'UNSUPPORTED_XML_ENTITY', 'DTDs, entity declarations, CDATA, comments and processing instructions are refused.');
      const open = new RegExp(`^<(${QNAME})([\\s\\S]*?)(/?)>$`).exec(token);
      requireThat(open, 'INVALID_OPENXML', 'Malformed XML opening tag.');
      xmlName(open[1]);
      requireThat(++nodes <= WORKBOOK_CONTAINER_PROFILE.xml.maxNodes
        && stack.length <= WORKBOOK_CONTAINER_PROFILE.xml.maxDepth,
      'WORKBOOK_LIMIT', 'XML document exceeds 100,000 elements or depth 32.');
      const node: XmlNode = { name: open[1], attributes: attributes(open[2]).values, children: [], text: '', rawText: '' };
      requireThat(stack.length > 1 || document.children.length === 0,
        'INVALID_OPENXML', 'XML must contain exactly one root element.');
      stack.at(-1)!.children.push(node);
      if (!open[3]) stack.push(node);
    }
    offset = end + 1;
  }
  requireThat(stack.length === 1 && document.children.length === 1,
    'INVALID_OPENXML', 'XML has a missing root or unclosed elements.');
  return document.children[0];
}
