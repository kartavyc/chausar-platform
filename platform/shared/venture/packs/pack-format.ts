/**
 * W6 6F2 (D31): the playbook pack format. A pack is one JSON document with three kinds of part and nothing else:
 *   - skills: markdown guidance the owner's AI tool reads during jobs (text, never code);
 *   - mcpServers: references to MCP servers the owner may add later (never added, connected or trusted by a pack);
 *   - calculators: WebAssembly modules that are pure integer functions (no imports, no start code, bounded memory),
 *     run in an isolated worker, whose answers become code receipts like Chausar's own calculators.
 * Code hooks, scripts and any unknown part are refused. Browser-safe: the fake engine validates with this same file.
 */
import { ChausarError, check, digest } from '../../portable.ts';
import { quotable } from '../../owner-flag.ts';
import { validateExternalServers } from '../agent-runtime/external-config.ts';
import type { ExternalMcpServer } from '../agent-runtime/external-config.ts';

export const PACK_FORMAT = 'chausar-pack/1';
export type PackUnit = 'money' | 'count' | 'bps';
export type PackInput = { name: string; label: string; unit: PackUnit };
export type PackCalculator = { id: string; name: string; about: string; inputs: PackInput[]; output: { label: string; unit: PackUnit }; wasmBase64: string; moduleDigest: string; maxMemoryPages: number; timeoutMs: number };
export type PackSkill = { id: string; title: string; markdown: string };
export type PackDoc = { format: typeof PACK_FORMAT; id: string; name: string; version: string; about: string; skills: PackSkill[]; mcpServers: ExternalMcpServer[]; calculators: PackCalculator[] };
export type PackCalculatorView = { id: string; name: string; about: string; inputs: PackInput[]; output: { label: string; unit: PackUnit }; moduleDigest: string };
export type PackView = {
  id: string; name: string; version: string; about: string; digest: string;
  skills: { id: string; title: string; words: number }[];
  mcpServers: ExternalMcpServer[];
  calculators: PackCalculatorView[];
};
export type ValidPack = { doc: PackDoc; view: PackView; digest: string };

const BAD = 'PACK_INVALID', CODE = 'PACK_CODE_REFUSED', WASM = 'PACK_WASM_REFUSED';
const ID = /^[a-z][a-z0-9-]{0,39}$/;
/** Top-level names a code-running plugin system would use. A pack has none of them. */
const HOOKS = /^(hooks?|scripts?|on[A-Z].*|pre.*install|post.*install|install|uninstall|main|module|bin|exec|commands?|run|entry|preload|lifecycle|agents?)$/i;
const MARKUP_CODE = /<\s*(script|iframe|object|embed)\b|javascript\s*:|\bon[a-z]+\s*=\s*["']/i;
const plain = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) && !value.includes(String.fromCharCode(8212));
function object(value: unknown, message: string): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), BAD, message);
  return value as Record<string, unknown>;
}
function exactKeys(row: Record<string, unknown>, keys: readonly string[], what: string) {
  for (const key of Object.keys(row)) {
    check(!HOOKS.test(key) || keys.includes(key), CODE, 'Packs cannot run code hooks or scripts. Remove them and try again.');
    check(keys.includes(key), BAD, `${what} has a part Chausar does not know: ${key.slice(0, 40)}.`);
  }
  for (const key of keys) check(Object.hasOwn(row, key), BAD, `${what} needs ${key}.`);
}

/** Base64 to bytes, strict. */
export function base64Bytes(text: unknown, max: number): Uint8Array {
  check(typeof text === 'string' && text.length > 0 && text.length <= Math.ceil(max / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0, WASM, 'A calculator must be a base64 WebAssembly module of at most 64 KB.');
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Read a WebAssembly 1 module and accept only a pure function: no imports, no start function, no tables, an export
 * named run with exactly `inputs` i64 parameters and one i64 result, and an optional bounded memory.
 */
export function inspectPureWasm(bytes: Uint8Array, inputs: number, maxMemoryPages: number): void {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const fail = (message: string): never => { throw new ChausarError(WASM, message); };
  if (!(bytes.length >= 8 && header.every((byte, i) => bytes[i] === byte))) fail('A calculator must be a WebAssembly 1 module.');
  let at = 8;
  const byte = (end: number) => { if (at >= end) fail('This calculator module is cut short.'); return bytes[at++]!; };
  const uint = (end: number) => { let value = 0, shift = 0; for (let i = 0; i < 5; i++) { const next = byte(end); value += (next & 0x7f) * 2 ** shift; if (!(next & 0x80)) return value; shift += 7; } return fail('This calculator module has a bad number.'); };
  const types: { params: number[]; results: number[] }[] = []; const functions: number[] = []; const exports: { name: string; kind: number; index: number }[] = [];
  let last = 0, memory = false;
  while (at < bytes.length) {
    const id = bytes[at++]!, size = uint(bytes.length), end = at + size;
    if (end > bytes.length) fail('This calculator module is cut short.');
    if (id !== 0) { if (id <= last) fail('This calculator module has its parts out of order.'); last = id; }
    if (id === 2) fail('Calculators cannot import anything: no files, network, clock or host functions.');
    if (id === 8) fail('Calculators cannot run start code. Export one run function only.');
    if (id === 4 || id === 9) fail('Calculators cannot use function tables.');
    if (id > 12) fail('This calculator module has a part Chausar does not accept.');
    if (id === 1) {
      for (let n = uint(end); n > 0; n--) {
        if (byte(end) !== 0x60) fail('This calculator module has a bad function type.');
        const params: number[] = []; for (let p = uint(end); p > 0; p--) params.push(byte(end));
        const results: number[] = []; for (let r = uint(end); r > 0; r--) results.push(byte(end));
        types.push({ params, results });
      }
    } else if (id === 3) { for (let n = uint(end); n > 0; n--) functions.push(uint(end)); }
    else if (id === 5) {
      const count = uint(end); if (count > 1) fail('A calculator may have at most one memory.');
      if (count === 1) {
        if (byte(end) !== 1) fail('A calculator memory must declare its maximum size.');
        const min = uint(end), max = uint(end);
        if (min > max || max > maxMemoryPages) fail('This calculator needs more memory than its maxMemoryPages allows.');
        memory = true;
      }
    } else if (id === 7) {
      for (let n = uint(end); n > 0; n--) {
        const length = uint(end); if (at + length > end) fail('This calculator module is cut short.');
        let name = ''; for (let i = 0; i < length; i++) name += String.fromCharCode(bytes[at + i]!); at += length;
        exports.push({ name, kind: byte(end), index: uint(end) });
      }
    }
    at = end;
  }
  const run = exports.find(row => row.name === 'run');
  if (!run || run.kind !== 0 || exports.some(row => !(row.name === 'run' || (row.name === 'memory' && row.kind === 2 && memory)))) fail('A calculator exports one function named run, and at most its memory.');
  const type = types[functions[run!.index] ?? -1];
  if (!type || type.params.length !== inputs || type.params.some(param => param !== 0x7e) || type.results.length !== 1 || type.results[0] !== 0x7e)
    fail(`The run function must take ${inputs} whole-number inputs (i64) and return one whole number (i64).`);
}

function calculatorOf(raw: unknown): PackCalculator {
  const row = object(raw, 'Describe each calculator.');
  exactKeys(row, ['id', 'name', 'about', 'inputs', 'output', 'wasmBase64', 'maxMemoryPages', 'timeoutMs'], 'A calculator');
  check(typeof row.id === 'string' && ID.test(row.id), BAD, 'Give each calculator a short id in lower case.');
  check(plain(row.name, 80) && plain(row.about, 300), BAD, 'Give each calculator a name and a one-line description.');
  check(Array.isArray(row.inputs) && row.inputs.length >= 1 && row.inputs.length <= 8, BAD, 'A calculator takes one to eight inputs.');
  const names = new Set<string>();
  const inputs = (row.inputs as unknown[]).map(item => {
    const input = object(item, 'Describe each input.'); exactKeys(input, ['name', 'label', 'unit'], 'An input');
    check(typeof input.name === 'string' && /^[a-z][A-Za-z0-9]{0,31}$/.test(input.name) && !names.has(input.name), BAD, 'Give each input a unique short name.');
    check(plain(input.label, 80) && ['money', 'count', 'bps'].includes(input.unit as string), BAD, 'Each input needs a label and a unit: money, count or bps.');
    names.add(input.name); return { name: input.name, label: input.label as string, unit: input.unit as PackUnit };
  });
  const output = object(row.output, 'Describe the answer.'); exactKeys(output, ['label', 'unit'], 'The answer');
  check(plain(output.label, 80) && ['money', 'count', 'bps'].includes(output.unit as string), BAD, 'The answer needs a label and a unit: money, count or bps.');
  check(Number.isInteger(row.maxMemoryPages) && (row.maxMemoryPages as number) >= 0 && (row.maxMemoryPages as number) <= 16, BAD, 'Set maxMemoryPages from 0 to 16.');
  check(Number.isInteger(row.timeoutMs) && (row.timeoutMs as number) >= 50 && (row.timeoutMs as number) <= 5000, BAD, 'Set timeoutMs from 50 to 5000.');
  const bytes = base64Bytes(row.wasmBase64, 64 * 1024);
  inspectPureWasm(bytes, inputs.length, row.maxMemoryPages as number);
  return { id: row.id, name: row.name as string, about: row.about as string, inputs, output: { label: output.label as string, unit: output.unit as PackUnit },
    wasmBase64: row.wasmBase64 as string, moduleDigest: digest(row.wasmBase64), maxMemoryPages: row.maxMemoryPages as number, timeoutMs: row.timeoutMs as number };
}

/** Validate a whole pack. Throws PACK_INVALID, PACK_CODE_REFUSED or PACK_WASM_REFUSED with a plain reason. */
export function validatePack(raw: unknown): ValidPack {
  const row = object(raw, 'Choose a Chausar pack file.');
  check(JSON.stringify(row).length <= 1024 * 1024, BAD, 'A pack must be at most 1 MB.');
  exactKeys(row, ['format', 'id', 'name', 'version', 'about', 'skills', 'mcpServers', 'calculators'], 'This pack');
  check(row.format === PACK_FORMAT, BAD, `This is not a ${PACK_FORMAT} pack.`);
  check(typeof row.id === 'string' && ID.test(row.id), BAD, 'Give the pack a short id in lower case.');
  check(plain(row.name, 80) && plain(row.about, 300), BAD, 'Give the pack a name and a one-line description.');
  check(typeof row.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(row.version), BAD, 'Give the pack a version like 1.0.0.');
  check(Array.isArray(row.skills) && row.skills.length <= 20 && Array.isArray(row.mcpServers) && row.mcpServers.length <= 10 && Array.isArray(row.calculators) && row.calculators.length <= 10, BAD, 'A pack holds up to 20 skills, 10 server references and 10 calculators.');
  check((row.skills as unknown[]).length + (row.mcpServers as unknown[]).length + (row.calculators as unknown[]).length > 0, BAD, 'This pack is empty.');
  const skillIds = new Set<string>();
  const skills = (row.skills as unknown[]).map(item => {
    const skill = object(item, 'Describe each skill.'); exactKeys(skill, ['id', 'title', 'markdown'], 'A skill');
    check(typeof skill.id === 'string' && ID.test(skill.id) && !skillIds.has(skill.id), BAD, 'Give each skill a unique short id in lower case.');
    check(plain(skill.title, 120), BAD, 'Give each skill a title.');
    check(typeof skill.markdown === 'string' && skill.markdown.trim().length > 0 && skill.markdown.length <= 20000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(skill.markdown), BAD, 'A skill is markdown text of at most 20,000 characters.');
    check(!MARKUP_CODE.test(skill.markdown), CODE, 'Skills are plain markdown. Scripts and embedded code are refused.');
    skillIds.add(skill.id); return { id: skill.id, title: skill.title as string, markdown: skill.markdown };
  });
  for (const item of row.mcpServers as unknown[]) {
    const server = object(item, 'Describe each server reference.');
    check(!Object.hasOwn(server, 'credentialRef') && !Object.hasOwn(server, 'credentialRevision'), BAD, 'A pack can’t carry a saved sign-in or password. Add the server first, then sign in or save its key.');
  }
  let mcpServers: ExternalMcpServer[] = [];
  try { mcpServers = validateExternalServers(row.mcpServers); }
  catch (error) { const why = quotable(error); throw new ChausarError(BAD, `A server reference is not valid${why ? `: ${why}` : '.'}`); }
  const calcIds = new Set<string>();
  const calculators = (row.calculators as unknown[]).map(item => { const calc = calculatorOf(item); check(!calcIds.has(calc.id), BAD, 'Give each calculator a unique id.'); calcIds.add(calc.id); return calc; });
  check(calculators.every(calc => packOperation(row.id as string, calc.id).length <= 64), BAD, 'Shorten the pack or calculator id: together they must stay under 58 letters.');
  const doc: PackDoc = { format: PACK_FORMAT, id: row.id, name: row.name as string, version: row.version as string, about: row.about as string, skills, mcpServers, calculators };
  const packDigest = digest(doc);
  return { doc, view: packView(doc, packDigest), digest: packDigest };
}
/** What the owner sees of a pack: everything except the calculator code bytes. */
export function packView(doc: PackDoc, packDigest: string): PackView {
  return { id: doc.id, name: doc.name, version: doc.version, about: doc.about, digest: packDigest,
    skills: doc.skills.map(skill => ({ id: skill.id, title: skill.title, words: skill.markdown.split(/\s+/).filter(Boolean).length })),
    mcpServers: structuredClone(doc.mcpServers),
    calculators: doc.calculators.map(calc => ({ id: calc.id, name: calc.name, about: calc.about, inputs: structuredClone(calc.inputs), output: { ...calc.output }, moduleDigest: calc.moduleDigest })) };
}

/** The job calculator name for one pack calculator: pack_<pack>_<calculator>, lower case with underscores. */
export const packOperation = (packId: string, calculatorId: string) => `pack_${packId}_${calculatorId}`.replaceAll('-', '_');
