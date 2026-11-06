// W6 6F2: tiny hand-assembled WebAssembly modules for pack calculator tests. Built at runtime, no compiler.
export type WasmOptions = { params?: number; body?: number[]; importFn?: boolean; start?: boolean; memory?: { min: number; max?: number }; exportName?: string; result?: number };
const I64 = 0x7e;
const uleb = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
const name = (text: string) => [...uleb(text.length), ...[...text].map(c => c.charCodeAt(0))];
/** A module exporting run(i64 x params) -> i64. Default body: (a * b) / 10000, the GST on an amount at a rate in basis points. */
export function wasmModule(options: WasmOptions = {}): Uint8Array {
  const params = options.params ?? 2;
  const body = options.body ?? [0x20, 0x00, 0x20, 0x01, 0x7e, 0x42, 0x90, 0xce, 0x00, 0x7f];
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  bytes.push(...section(1, [1, 0x60, ...uleb(params), ...Array(params).fill(I64), 1, options.result ?? I64]));
  if (options.importFn) bytes.push(...section(2, [1, ...name('env'), ...name('leak'), 0x00, 0x00]));
  bytes.push(...section(3, [1, 0x00]));
  if (options.memory) bytes.push(...section(5, [1, options.memory.max === undefined ? 0x00 : 0x01, ...uleb(options.memory.min), ...(options.memory.max === undefined ? [] : uleb(options.memory.max))]));
  const fn = options.importFn ? 1 : 0;
  bytes.push(...section(7, [1, ...name(options.exportName ?? 'run'), 0x00, fn]));
  if (options.start) bytes.push(...section(8, [fn]));
  const code = [0x00, ...body, 0x0b];
  bytes.push(...section(10, [1, ...uleb(code.length), ...code]));
  return Uint8Array.from(bytes);
}
export const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
/** loop forever: (loop (br 0)), then a value so the body still types. */
export const LOOP_BODY = [0x03, 0x40, 0x0c, 0x00, 0x0b, 0x42, 0x00];
/** a / b, which traps when b is zero. */
export const DIVIDE_BODY = [0x20, 0x00, 0x20, 0x01, 0x7f];
