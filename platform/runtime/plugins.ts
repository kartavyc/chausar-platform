import { check } from './contracts.ts';

/** Inspect imports and memory bounds before handing bytes to the native compiler in a child. */
export function inspectWasm(bytes: Uint8Array, memoryLimit: number): { imports: string[] } {
  check(bytes.length >= 8 && bytes.length <= 1024 * 1024 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])), 'INVALID_WASM', 'Use a WASM 1 binary no larger than 1 MiB.');
  let offset = 8; const imports: string[] = []; const seen = new Set<number>();
  const uint = (end: number) => { let value = 0; let shift = 0; for (let i = 0; i < 5; i += 1) { check(offset < end, 'INVALID_WASM', 'Truncated WASM integer.'); const byte = bytes[offset++]; check(i < 4 || (byte & 0xf0) === 0, 'INVALID_WASM', 'Invalid WASM integer.'); value += (byte & 0x7f) * 2 ** shift; if (!(byte & 0x80)) return value; shift += 7; } throw new Error('Invalid WASM integer.'); };
  const name = (end: number) => { const length = uint(end); check(offset + length <= end && length <= 200, 'INVALID_WASM', 'Invalid WASM import name.'); const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)); offset += length; return value; };
  const limits = (end: number, maximum: number, required: boolean) => {
    check(offset < end, 'INVALID_WASM', 'Truncated WASM memory limits.'); const flags = bytes[offset++]; check(flags === 0 || flags === 1, 'UNSUPPORTED_WASM', 'Shared memories and memory64 are not supported.');
    const minimum = uint(end); const maximumValue = flags === 1 ? uint(end) : undefined;
    check(!required || maximumValue !== undefined, 'UNBOUNDED_MEMORY', 'Every WASM memory must declare a maximum.');
    check(minimum <= maximum && (maximumValue === undefined || (maximumValue >= minimum && maximumValue <= maximum)), 'MEMORY_LIMIT', 'The module exceeds its declared memory/table limit.');
  };
  while (offset < bytes.length) {
    const section = bytes[offset++]; const length = uint(bytes.length); const end = offset + length; check(end <= bytes.length && section <= 12, 'INVALID_WASM', 'Invalid WASM section.');
    if (section !== 0) { check(!seen.has(section), 'INVALID_WASM', 'Duplicate WASM section.'); seen.add(section); }
    if (section === 2) {
      const count = uint(end); check(count <= 16, 'IMPORT_LIMIT', 'Too many host imports.');
      for (let i = 0; i < count; i += 1) { const module = name(end); const field = name(end); check(offset < end, 'INVALID_WASM', 'Truncated import.'); const kind = bytes[offset++]; check(module === 'chausar' && kind === 0, 'UNSUPPORTED_IMPORT', 'Only explicitly approved chausar function imports are supported. WASI, memory and network imports are refused.'); uint(end); imports.push(field); }
      check(offset === end, 'INVALID_WASM', 'Invalid import section.');
    } else if (section === 4) {
      const count = uint(end); check(count <= 1, 'TABLE_LIMIT', 'At most one bounded function table is supported.');
      for (let i = 0; i < count; i += 1) { check(bytes[offset++] === 0x70, 'UNSUPPORTED_WASM', 'Only function reference tables are supported.'); limits(end, 65536, true); }
      check(offset === end, 'INVALID_WASM', 'Invalid table section.');
    } else if (section === 5) {
      const count = uint(end); check(count <= 1, 'MEMORY_LIMIT', 'At most one bounded memory is supported.');
      for (let i = 0; i < count; i += 1) limits(end, memoryLimit, true);
      check(offset === end, 'INVALID_WASM', 'Invalid memory section.');
    }
    offset = end;
  }
  return { imports };
}
