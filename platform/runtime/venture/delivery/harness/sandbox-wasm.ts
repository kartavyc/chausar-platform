// Chausar delivery harness: compiles a checked row program (sandbox-lang.ts) to a WebAssembly module.
// The module holds the table's cells as data, imports nothing, and writes one text value per output and row.
// Text values are packed into one i64: the low 32 bits are a byte offset in memory, the high 32 bits the length.
// The string helpers below are hand-written WebAssembly; no outside compiler or package is used.
import { ChausarError } from '../../../contracts.ts';
import type { RowExpr, RowProgram, RowType } from './sandbox-lang.ts';

const I32 = 0x7f, I64 = 0x7e, EMPTY = 0x40;
const PAGE = 65536;

function uleb(value: number): number[] {
  const out: number[] = [];
  let n = value >>> 0;
  do { let byte = n & 0x7f; n >>>= 7; if (n !== 0) byte |= 0x80; out.push(byte); } while (n !== 0);
  return out;
}

function sleb(value: bigint): number[] {
  const out: number[] = [];
  let n = value;
  for (;;) {
    const byte = parseInt((n & 0x7fn).toString(), 10);
    n >>= 7n;
    const sign = (byte & 0x40) !== 0;
    if ((n === 0n && !sign) || (n === -1n && sign)) { out.push(byte); return out; }
    out.push(byte | 0x80);
  }
}

const OPS = {
  unreachable: 0x00, block: 0x02, loop: 0x03, if: 0x04, else: 0x05, end: 0x0b, br: 0x0c, br_if: 0x0d, return: 0x0f, call: 0x10,
  'local.get': 0x20, 'local.set': 0x21, 'local.tee': 0x22, 'global.get': 0x23, 'global.set': 0x24,
  'i64.load': 0x29, 'i32.load8_u': 0x2d, 'i64.store': 0x37, 'i32.store8': 0x3a, 'memory.size': 0x3f, 'memory.grow': 0x40,
  'i32.const': 0x41, 'i64.const': 0x42,
  'i32.eqz': 0x45, 'i32.eq': 0x46, 'i32.ne': 0x47, 'i32.lt_s': 0x48, 'i32.lt_u': 0x49, 'i32.gt_u': 0x4b, 'i32.le_u': 0x4d, 'i32.ge_s': 0x4e, 'i32.ge_u': 0x4f,
  'i64.eqz': 0x50, 'i64.gt_u': 0x56,
  'i32.add': 0x6a, 'i32.sub': 0x6b, 'i32.mul': 0x6c, 'i32.and': 0x71, 'i32.or': 0x72, 'i32.shl': 0x74, 'i32.shr_u': 0x76,
  'i64.add': 0x7c, 'i64.sub': 0x7d, 'i64.mul': 0x7e, 'i64.or': 0x84, 'i64.shl': 0x86, 'i64.shr_u': 0x88,
  'i32.wrap_i64': 0xa7, 'i64.extend_i32_u': 0xad,
} as const;
type Op = keyof typeof OPS;

/** A function body under construction. Each method appends one instruction with its immediates. */
class Body {
  bytes: number[] = [];
  op(name: Op): this { this.bytes.push(OPS[name]); return this; }
  block(type = EMPTY): this { this.bytes.push(OPS.block, type); return this; }
  loop(type = EMPTY): this { this.bytes.push(OPS.loop, type); return this; }
  if(type = EMPTY): this { this.bytes.push(OPS.if, type); return this; }
  br(label: number): this { this.bytes.push(OPS.br, ...uleb(label)); return this; }
  brIf(label: number): this { this.bytes.push(OPS.br_if, ...uleb(label)); return this; }
  call(index: number): this { this.bytes.push(OPS.call, ...uleb(index)); return this; }
  get(local: number): this { this.bytes.push(OPS['local.get'], ...uleb(local)); return this; }
  set(local: number): this { this.bytes.push(OPS['local.set'], ...uleb(local)); return this; }
  tee(local: number): this { this.bytes.push(OPS['local.tee'], ...uleb(local)); return this; }
  globalGet(index: number): this { this.bytes.push(OPS['global.get'], ...uleb(index)); return this; }
  globalSet(index: number): this { this.bytes.push(OPS['global.set'], ...uleb(index)); return this; }
  i32(value: number): this { this.bytes.push(OPS['i32.const'], ...sleb(BigInt(value | 0))); return this; }
  i64(value: bigint): this { this.bytes.push(OPS['i64.const'], ...sleb(value)); return this; }
  load8(): this { this.bytes.push(OPS['i32.load8_u'], 0, 0); return this; }
  store8(): this { this.bytes.push(OPS['i32.store8'], 0, 0); return this; }
  load64(offset: number): this { this.bytes.push(OPS['i64.load'], 3, ...uleb(offset)); return this; }
  store64(offset: number): this { this.bytes.push(OPS['i64.store'], 3, ...uleb(offset)); return this; }
  memorySize(): this { this.bytes.push(OPS['memory.size'], 0); return this; }
  memoryGrow(): this { this.bytes.push(OPS['memory.grow'], 0); return this; }
  /** Leaves the byte offset of a packed text local on the stack. */
  ptr(local: number): this { return this.get(local).op('i32.wrap_i64'); }
  /** Leaves the byte length of a packed text local on the stack. */
  len(local: number): this { return this.get(local).i64(32n).op('i64.shr_u').op('i32.wrap_i64'); }
  /** Packs two i32 locals (offset, length) into one i64 text value. */
  pack(ptrLocal: number, lenLocal: number): this {
    return this.get(ptrLocal).op('i64.extend_i32_u').get(lenLocal).op('i64.extend_i32_u').i64(32n).op('i64.shl').op('i64.or');
  }
}

type Func = { type: number; locals: number[]; body: Body };

// Function indices (the module imports nothing, so these start at zero).
const F = { alloc: 0, find: 1, copy: 2, same: 3, lower: 4, upper: 5, trim: 6, before: 7, after: 8, replace: 9, concat: 10, contains: 11, starts: 12, ends: 13, equals: 14, run: 15 } as const;
// Type indices.
const TYPES: [number[], number[]][] = [
  [[I32], [I32]], // 0 alloc
  [[I32, I32, I32, I32], [I32]], // 1 find
  [[I32, I32, I32], []], // 2 copy
  [[I32, I32, I32], [I32]], // 3 same
  [[I64], [I64]], // 4 lower, upper, trim
  [[I64, I64], [I64]], // 5 before, after, concat
  [[I64, I64, I64], [I64]], // 6 replace
  [[I64, I64], [I32]], // 7 contains, starts, ends, equals
  [[], [I32]], // 8 run
];

/** alloc(n): bump allocation from global 0, growing memory up to its maximum; traps when memory runs out. */
function allocFunc(): Func {
  const b = new Body();
  b.globalGet(0).set(1);
  b.get(1).get(0).op('i32.add').set(2);
  b.get(2).get(1).op('i32.lt_u').if().op('unreachable').op('end');
  b.block().get(2).memorySize().i32(16).op('i32.shl').op('i32.le_u').brIf(0)
    .get(2).memorySize().i32(16).op('i32.shl').op('i32.sub').i32(65535).op('i32.add').i32(16).op('i32.shr_u')
    .memoryGrow().i32(-1).op('i32.eq').if().op('unreachable').op('end')
    .op('end');
  b.get(2).globalSet(0).get(1);
  return { type: 0, locals: [I32, I32], body: b };
}

/** find(hp, hn, np, nn): the first byte index of the needle in the haystack, or -1. */
function findFunc(): Func {
  const b = new Body();
  b.get(3).get(1).op('i32.gt_u').if().i32(-1).op('return').op('end');
  b.i32(0).set(4);
  b.block().loop()
    .get(4).get(1).get(3).op('i32.sub').op('i32.gt_u').brIf(1)
    .get(0).get(4).op('i32.add').get(2).get(3).call(F.same).if().get(4).op('return').op('end')
    .get(4).i32(1).op('i32.add').set(4).br(0)
    .op('end').op('end');
  b.i32(-1);
  return { type: 1, locals: [I32], body: b };
}

/** copy(dst, src, n): byte by byte. */
function copyFunc(): Func {
  const b = new Body();
  b.i32(0).set(3);
  b.block().loop()
    .get(3).get(2).op('i32.ge_u').brIf(1)
    .get(0).get(3).op('i32.add').get(1).get(3).op('i32.add').load8().store8()
    .get(3).i32(1).op('i32.add').set(3).br(0)
    .op('end').op('end');
  return { type: 2, locals: [I32], body: b };
}

/** same(a, b, n): 1 when the n bytes at a and b are equal. */
function sameFunc(): Func {
  const b = new Body();
  b.i32(0).set(3);
  b.block().loop()
    .get(3).get(2).op('i32.ge_u').brIf(1)
    .get(0).get(3).op('i32.add').load8().get(1).get(3).op('i32.add').load8().op('i32.ne').if().i32(0).op('return').op('end')
    .get(3).i32(1).op('i32.add').set(3).br(0)
    .op('end').op('end');
  b.i32(1);
  return { type: 3, locals: [I32], body: b };
}

/** lower or upper: a new copy with ASCII letters of one case moved to the other. */
function caseFunc(toUpper: boolean): Func {
  const [from, to, shift] = toUpper ? [97, 122, -32] : [65, 90, 32];
  const b = new Body();
  b.ptr(0).set(1).len(0).set(2).get(2).call(F.alloc).set(3).i32(0).set(4);
  b.block().loop()
    .get(4).get(2).op('i32.ge_u').brIf(1)
    .get(1).get(4).op('i32.add').load8().set(5)
    .get(5).i32(from).op('i32.ge_u').get(5).i32(to).op('i32.le_u').op('i32.and').if().get(5).i32(shift).op('i32.add').set(5).op('end')
    .get(3).get(4).op('i32.add').get(5).store8()
    .get(4).i32(1).op('i32.add').set(4).br(0)
    .op('end').op('end');
  b.pack(3, 2);
  return { type: 4, locals: [I32, I32, I32, I32, I32], body: b };
}

/** Leaves 1 when local c holds a space, tab, new line or carriage return. */
function isSpace(b: Body, c: number): Body {
  return b.get(c).i32(32).op('i32.eq').get(c).i32(9).op('i32.eq').op('i32.or').get(c).i32(10).op('i32.eq').op('i32.or').get(c).i32(13).op('i32.eq').op('i32.or');
}

/** trim: a slice without the spaces at both ends (no copy). */
function trimFunc(): Func {
  const b = new Body();
  b.ptr(0).set(1).len(0).set(2).i32(0).set(3).get(2).set(4);
  b.block().loop().get(3).get(4).op('i32.ge_u').brIf(1).get(1).get(3).op('i32.add').load8().set(5);
  isSpace(b, 5).op('i32.eqz').brIf(1).get(3).i32(1).op('i32.add').set(3).br(0).op('end').op('end');
  b.block().loop().get(4).get(3).op('i32.le_u').brIf(1).get(1).get(4).op('i32.add').i32(1).op('i32.sub').load8().set(5);
  isSpace(b, 5).op('i32.eqz').brIf(1).get(4).i32(1).op('i32.sub').set(4).br(0).op('end').op('end');
  b.get(1).get(3).op('i32.add').set(1).get(4).get(3).op('i32.sub').set(2).pack(1, 2);
  return { type: 4, locals: [I32, I32, I32, I32, I32], body: b };
}

/** before(s, sep) is the text before the first sep (all of s when absent); after(s, sep) the text after it (empty when absent). */
function splitFunc(after: boolean): Func {
  const b = new Body();
  // locals: 2 sp, 3 sn, 4 tp, 5 tn, 6 i
  b.ptr(0).set(2).len(0).set(3).ptr(1).set(4).len(1).set(5);
  b.get(2).get(3).get(4).get(5).call(F.find).set(6);
  if (!after) {
    b.get(6).i32(0).op('i32.lt_s').if(I64).get(0).op('else').pack(2, 6).op('end');
  } else {
    b.get(6).i32(0).op('i32.lt_s').if(I64).i64(0n).op('else')
      .get(2).get(6).op('i32.add').get(5).op('i32.add').set(2)
      .get(3).get(6).op('i32.sub').get(5).op('i32.sub').set(3)
      .pack(2, 3).op('end');
  }
  return { type: 5, locals: [I32, I32, I32, I32, I32], body: b };
}

/** replace(s, from, to): every from becomes to. An empty from changes nothing. Two passes, so memory is exact. */
function replaceFunc(): Func {
  const b = new Body();
  // locals: 3 sp, 4 sn, 5 fp, 6 fn, 7 tp, 8 tn, 9 count, 10 pos, 11 r, 12 out, 13 w, 14 outLen
  b.ptr(0).set(3).len(0).set(4).ptr(1).set(5).len(1).set(6).ptr(2).set(7).len(2).set(8);
  b.get(6).op('i32.eqz').if().get(0).op('return').op('end');
  const findNext = () => b.get(3).get(10).op('i32.add').get(4).get(10).op('i32.sub').get(5).get(6).call(F.find).tee(11);
  b.i32(0).set(9).i32(0).set(10);
  b.block().loop();
  findNext();
  b.i32(0).op('i32.lt_s').brIf(1)
    .get(9).i32(1).op('i32.add').set(9)
    .get(10).get(11).op('i32.add').get(6).op('i32.add').set(10).br(0)
    .op('end').op('end');
  // The new length in 64 bits first, so a huge result traps instead of wrapping.
  b.get(4).op('i64.extend_i32_u').get(9).op('i64.extend_i32_u').get(8).op('i64.extend_i32_u').op('i64.mul').op('i64.add')
    .get(9).op('i64.extend_i32_u').get(6).op('i64.extend_i32_u').op('i64.mul').op('i64.sub')
    .i64(0xffffffn).op('i64.gt_u').if().op('unreachable').op('end');
  b.get(4).get(9).get(8).op('i32.mul').op('i32.add').get(9).get(6).op('i32.mul').op('i32.sub').set(14);
  b.get(14).call(F.alloc).set(12).i32(0).set(13).i32(0).set(10);
  b.block().loop();
  findNext();
  b.i32(0).op('i32.lt_s').if()
    .get(12).get(13).op('i32.add').get(3).get(10).op('i32.add').get(4).get(10).op('i32.sub').call(F.copy)
    .br(2).op('end')
    .get(12).get(13).op('i32.add').get(3).get(10).op('i32.add').get(11).call(F.copy)
    .get(13).get(11).op('i32.add').set(13)
    .get(12).get(13).op('i32.add').get(7).get(8).call(F.copy)
    .get(13).get(8).op('i32.add').set(13)
    .get(10).get(11).op('i32.add').get(6).op('i32.add').set(10).br(0)
    .op('end').op('end');
  b.pack(12, 14);
  return { type: 6, locals: Array(12).fill(I32), body: b };
}

/** concat(a, b): a new text holding a then b. */
function concatFunc(): Func {
  const b = new Body();
  // locals: 2 ap, 3 an, 4 bp, 5 bn, 6 out, 7 total
  b.ptr(0).set(2).len(0).set(3).ptr(1).set(4).len(1).set(5);
  b.get(3).get(5).op('i32.add').set(7).get(7).call(F.alloc).set(6);
  b.get(6).get(2).get(3).call(F.copy);
  b.get(6).get(3).op('i32.add').get(4).get(5).call(F.copy);
  b.pack(6, 7);
  return { type: 5, locals: Array(6).fill(I32), body: b };
}

/** contains, starts, ends and equals: yes or no tests on two texts. */
function testFunc(kind: 'contains' | 'starts' | 'ends' | 'equals'): Func {
  const b = new Body();
  // locals: 2 hp, 3 hn, 4 np, 5 nn
  b.ptr(0).set(2).len(0).set(3).ptr(1).set(4).len(1).set(5);
  if (kind === 'contains') {
    b.get(2).get(3).get(4).get(5).call(F.find).i32(0).op('i32.ge_s');
  } else if (kind === 'equals') {
    b.get(3).get(5).op('i32.eq').if(I32).get(2).get(4).get(5).call(F.same).op('else').i32(0).op('end');
  } else {
    b.get(5).get(3).op('i32.le_u').if(I32);
    if (kind === 'starts') b.get(2); else b.get(2).get(3).op('i32.add').get(5).op('i32.sub');
    b.get(4).get(5).call(F.same).op('else').i32(0).op('end');
  }
  return { type: 7, locals: Array(4).fill(I32), body: b };
}

export type CompiledModule = { bytes: Uint8Array<ArrayBuffer>; rows: number; outputs: string[]; maxMemoryPages: number };
export const MAX_MEMORY_PAGES = 256; // 16 MiB

/** The packed i64 text value for an offset and a length. */
const packed = (ptr: number, len: number) => (BigInt(len) << 32n) | BigInt(ptr);

/**
 * Compiles a checked program for these rows. Cells, literals and the cell table go in one data segment; outputs
 * go to an i64 table after it, and the heap starts after that.
 */
export function compileRowProgram(program: RowProgram, rows: readonly Record<string, string>[], maxMemoryPages = MAX_MEMORY_PAGES): CompiledModule {
  const encoder = new TextEncoder();
  const data: number[] = [];
  const strings = new Map<string, number>();
  const intern = (text: string): { ptr: number; len: number } => {
    const found = strings.get(text);
    const bytes = encoder.encode(text);
    if (found !== undefined) return { ptr: found, len: bytes.length };
    const ptr = data.length;
    for (const byte of bytes) data.push(byte);
    strings.set(text, ptr);
    return { ptr, len: bytes.length };
  };
  const yes = intern('true'), no = intern('false');
  const columns = program.columns;
  const cellRefs = rows.map(row => columns.map(column => intern(row[column] ?? '')));
  while (data.length % 8) data.push(0);
  const cellTable = data.length;
  for (const refs of cellRefs) for (const ref of refs) {
    let value = packed(ref.ptr, ref.len);
    for (let i = 0; i < 8; i += 1) { data.push(parseInt((value & 0xffn).toString(), 10)); value >>= 8n; }
  }
  // Literals are interned while the code is emitted; the data segment is finished after that.
  const literal = (text: string) => { const ref = intern(text); return packed(ref.ptr, ref.len); };

  const lets = new Map<string, { local: number; type: RowType }>();
  const runLocals: number[] = [I32]; // local 0 is the row index
  for (const statement of program.statements) if (statement.kind === 'let') {
    lets.set(statement.name, { local: runLocals.length, type: statement.type });
    runLocals.push(statement.type === 'text' ? I64 : I32);
  }
  const outputs = program.statements.filter(statement => statement.kind === 'out');
  const run = new Body();
  const columnCount = columns.length;
  const emit = (expr: RowExpr): void => {
    switch (expr.kind) {
      case 'text': run.i64(literal(expr.value)); return;
      case 'bool': run.i32(expr.value ? 1 : 0); return;
      case 'name': run.get(lets.get(expr.name)!.local); return;
      case 'column': {
        const index = columns.indexOf(expr.column);
        run.i32(cellTable).get(0).i32(columnCount * 8).op('i32.mul').op('i32.add').load64(index * 8);
        return;
      }
      case 'if': {
        emit(expr.test);
        run.if(typeOfExpr(expr.then) === 'text' ? I64 : I32);
        emit(expr.then);
        run.op('else');
        emit(expr.else);
        run.op('end');
        return;
      }
      case 'and': emit(expr.left); run.if(I32); emit(expr.right); run.op('else').i32(0).op('end'); return;
      case 'or': emit(expr.left); run.if(I32).i32(1).op('else'); emit(expr.right); run.op('end'); return;
      case 'not': emit(expr.value); run.op('i32.eqz'); return;
      case 'call': {
        if (expr.fn === 'empty') { emit(expr.args[0]); run.i64(32n).op('i64.shr_u').op('i64.eqz'); return; }
        if (expr.fn === 'concat') {
          emit(expr.args[0]);
          for (const arg of expr.args.slice(1)) { emit(arg); run.call(F.concat); }
          return;
        }
        for (const arg of expr.args) emit(arg);
        run.call(F[expr.fn]);
        return;
      }
    }
  };
  const typeOfExpr = (expr: RowExpr): RowType => {
    switch (expr.kind) {
      case 'text': case 'column': return 'text';
      case 'bool': case 'and': case 'or': case 'not': return 'bool';
      case 'name': return lets.get(expr.name)!.type;
      case 'if': return typeOfExpr(expr.then);
      case 'call': return ['contains', 'starts', 'ends', 'equals', 'empty'].includes(expr.fn) ? 'bool' : 'text';
    }
  };

  // Reserve the output table's place now: its address goes into the code before the data segment is final.
  // Literals interned during emission are appended to data, so the output table address is computed afterwards
  // and patched through a global instead of a constant.
  run.i32(0).set(0);
  run.block().loop().get(0).globalGet(2).op('i32.ge_u').brIf(1);
  for (const statement of program.statements) {
    if (statement.kind === 'let') { emit(statement.expr); run.set(lets.get(statement.name)!.local); continue; }
    const index = outputs.indexOf(statement);
    run.globalGet(1).get(0).i32(outputs.length * 8).op('i32.mul').op('i32.add');
    emit(statement.expr);
    if (statement.type === 'bool') run.if(I64).i64(packed(yes.ptr, yes.len)).op('else').i64(packed(no.ptr, no.len)).op('end');
    run.store64(index * 8);
  }
  run.get(0).i32(1).op('i32.add').set(0).br(0).op('end').op('end');
  run.i32(0);

  while (data.length % 8) data.push(0);
  const outTable = data.length;
  const heapBase = outTable + rows.length * outputs.length * 8;
  const minPages = Math.ceil((heapBase + 1) / PAGE) + 1;
  if (minPages > maxMemoryPages) throw new ChausarError('SANDBOX_FAILED', 'This table is too large for one light sandbox run.');

  const funcs: Func[] = [
    allocFunc(), findFunc(), copyFunc(), sameFunc(), caseFunc(false), caseFunc(true), trimFunc(), splitFunc(false), splitFunc(true),
    replaceFunc(), concatFunc(), testFunc('contains'), testFunc('starts'), testFunc('ends'), testFunc('equals'),
    { type: 8, locals: runLocals, body: run }, // run has no parameters, so its row index is a declared local too
  ];
  return { bytes: encodeModule(funcs, data, { minPages, maxPages: maxMemoryPages, heapBase, outTable, rows: rows.length, outs: outputs.length }), rows: rows.length, outputs: outputs.map(out => out.name), maxMemoryPages };
}

function vec(items: number[][]): number[] {
  return [...uleb(items.length), ...items.flat()];
}

function section(id: number, payload: number[]): number[] {
  return [id, ...uleb(payload.length), ...payload];
}

function name(text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  return [...uleb(bytes.length), ...bytes];
}

function localGroups(locals: number[]): number[] {
  const groups: number[][] = [];
  for (const type of locals) {
    const last = groups.at(-1);
    if (last && last[1] === type) last[0] += 1; else groups.push([1, type]);
  }
  return vec(groups.map(([count, type]) => [...uleb(count), type]));
}

function encodeModule(funcs: Func[], data: number[], layout: { minPages: number; maxPages: number; heapBase: number; outTable: number; rows: number; outs: number }): Uint8Array<ArrayBuffer> {
  const constGlobal = (mutable: boolean, value: number) => [I32, mutable ? 1 : 0, OPS['i32.const'], ...sleb(BigInt(value)), OPS.end];
  const types = section(1, vec(TYPES.map(([params, results]) => [0x60, ...vec(params.map(p => [p])), ...vec(results.map(r => [r]))])));
  const functions = section(3, vec(funcs.map(func => uleb(func.type))));
  const memory = section(5, vec([[1, ...uleb(layout.minPages), ...uleb(layout.maxPages)]]));
  // Global 0: the heap pointer. Global 1: the output table. Global 2: the row count. Global 3: outputs per row.
  const globals = section(6, vec([constGlobal(true, layout.heapBase), constGlobal(false, layout.outTable), constGlobal(false, layout.rows), constGlobal(false, layout.outs)]));
  const exports = section(7, vec([
    [...name('memory'), 2, 0], [...name('run'), 0, ...uleb(F.run)],
    [...name('out_table'), 3, 1], [...name('rows'), 3, 2], [...name('outs'), 3, 3],
  ]));
  const code = section(10, vec(funcs.map(func => {
    const body = [...localGroups(func.locals), ...func.body.bytes, OPS.end];
    return [...uleb(body.length), ...body];
  })));
  const dataSection = section(11, vec([[0, OPS['i32.const'], ...sleb(0n), OPS.end, ...uleb(data.length), ...data]]));
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...types, ...functions, ...memory, ...globals, ...exports, ...code, ...dataSection]);
}
