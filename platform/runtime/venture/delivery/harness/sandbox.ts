// Chausar delivery harness: where agent-written code runs, and how each tier says honestly whether it can.
// Light sandbox (wasm-lite): the agent's row program, compiled to WebAssembly by sandbox-wasm.ts, runs in the same
// isolated worker as back office plugins (platform/runtime/wasm-worker.mjs): a separate Node process with file
// access only to the worker, a memory cap and a time limit. The module imports nothing.
// Containers: agent-written Python in Docker with no network, only where Docker Desktop and the image are present.
// Chausar never downloads an image for the owner. Every value agent code makes is a label or a key, never an amount.
// On the shared hosted server ('hosted-web') neither tier runs: the server starts no sandbox worker and no container,
// and nothing there checks for Docker (docs/venture/hosted.md).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChausarError } from '../../../contracts.ts';
import { inspectWasm } from '../../../plugins.ts';
import { digest } from '../../records.ts';
import type { CapabilityState, ExecutionTier, SandboxPorts, SandboxProcessRequest, SandboxProcessResponse, VentureHostKind } from '../../contracts.ts';
import { looksLikeAmount } from './cells.ts';
import type { RowProgram } from './sandbox-lang.ts';
import { compileRowProgram, MAX_MEMORY_PAGES } from './sandbox-wasm.ts';

export const MAX_TABLE_ROWS = 5000;
export const MAX_CELL_BYTES = 500;
const CHUNK_ROWS = 400;
const MAX_MODULE_BYTES = 900 * 1024;
const WORKER_TIMEOUT_MS = 4000;
const WORKER_OUTPUT_BYTES = 2 * 1024 * 1024;

export const WASM_LITE_REASON = "Runs the agent's row programs on this computer, compiled to WebAssembly, in a separate process with no file, network or process access for the program, a memory cap and a time limit. Row programs make labels and keys; they can't add up money.";
export const PYTHON_IMAGE = 'python:3.12-alpine';
export const DOCKER_MISSING = 'Needs Docker Desktop.';
export const DOCKER_STOPPED = 'Docker Desktop is installed but not running.';
export const DOCKER_IMAGE_MISSING = `Docker is running, but ${PYTHON_IMAGE} is not on this computer. Chausar never downloads it for you; run docker pull ${PYTHON_IMAGE} once.`;
export const DOCKER_READY = 'Runs agent-written Python in a Docker container with no network, a read-only file system, a memory cap and a process limit. Not yet tried on a real task.';
export const HOSTED_NO_OWNER_CLI = 'Heavy work starts your own Claude Code or Codex on your computer. The shared hosted server never starts it; use the desktop app.';
export const HOSTED_NO_CONTAINERS = 'Containers never run on the shared hosted server.';
/** Refused until the founder decides whether agent-written code may run on a shared server. Plugins never run there. */
export const HOSTED_NO_AGENT_CODE = 'The shared hosted server runs no agent-written code and no plugins for now. The desktop app has the light sandbox.';

/**
 * Why agent-written code of this tier can't run on this host, or null when it may try. Only the hosted web server
 * refuses: there the light sandbox, the full sandbox and containers are all off, before anything starts.
 */
export function tierRefusal(host: VentureHostKind | undefined, tier: ExecutionTier): string | null {
  if (host !== 'hosted-web') return null;
  if (tier === 'wasm-lite' || tier === 'wasm') return HOSTED_NO_AGENT_CODE;
  if (tier === 'container') return HOSTED_NO_CONTAINERS;
  if (tier === 'owner-cli') return HOSTED_NO_OWNER_CLI;
  return null;
}

export type SandboxRun = { columns: string[]; rows: string[][]; driver: 'wasm-lite' | 'docker'; moduleDigest: string | null; memoryPages: number };

/**
 * A value agent code made, checked before anyone uses it: no currency sign or percent, no token of digits alone, and
 * nothing that reads as an amount once a currency code is taken off. Keys like INV-0042 or Q3 pass; 4500, 4,500.00,
 * 2026-09-14 and INR4500 do not. Returns why, or null.
 */
export function labelFinding(value: string): string | null {
  if (/[\p{Sc}%]/u.test(value)) return 'holds a currency sign or a percent';
  if (looksLikeAmount(value)) return 'looks like an amount';
  for (const match of value.matchAll(/[\p{L}\p{Nd}]+(?:[-./,:'\u2019][\p{L}\p{Nd}]+)*/gu)) {
    if (/\p{Nd}/u.test(match[0]) && !/\p{L}/u.test(match[0])) return 'looks like a number';
    if (looksLikeAmount(match[0])) return 'looks like an amount';
  }
  return null;
}

/** Runs one compiled module in the isolated worker. Errors keep the worker's code and never echo the program. */
function runWorker(moduleBase64: string, maxMemoryPages: number): Promise<{ rows: string[][]; memoryPages: number }> {
  const worker = fileURLToPath(new URL('../../../wasm-worker.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${worker}`, '--max-old-space-size=64', worker], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' },
    });
    const chunks: Buffer[] = [];
    let size = 0, errors = '', done = false;
    const finish = (error?: Error, value?: { rows: string[][]; memoryPages: number }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(value!);
    };
    const timer = setTimeout(() => finish(new ChausarError('SANDBOX_FAILED', 'The row program ran past its time limit.')), WORKER_TIMEOUT_MS);
    child.on('error', () => finish(new ChausarError('SANDBOX_FAILED', 'The light sandbox could not start.')));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > WORKER_OUTPUT_BYTES) finish(new ChausarError('SANDBOX_FAILED', 'The row program made more output than allowed.'));
      else chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2000); });
    child.on('close', code => {
      if (done) return;
      if (code !== 0) {
        const known = /\b(MEMORY_LIMIT|CELL_LIMIT|OUTPUT_LIMIT|TABLE_LIMIT|UNAPPROVED_IMPORT|ROW_PROGRAM_FAILED|OUTPUT_BOUNDS)\b/.exec(errors)?.[1];
        const trapped = /RuntimeError/.test(errors);
        finish(new ChausarError('SANDBOX_FAILED', known === 'MEMORY_LIMIT' || trapped
          ? 'The row program ran out of memory in the sandbox.'
          : known ? `The light sandbox stopped the row program (${known}).` : 'The light sandbox stopped the row program.'));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed?.mode !== 'table' || !Array.isArray(parsed.rows) || !Number.isInteger(parsed.memoryPages)) throw new Error('shape');
        finish(undefined, { rows: parsed.rows, memoryPages: parsed.memoryPages });
      } catch {
        finish(new ChausarError('SANDBOX_FAILED', 'The light sandbox returned something Chausar could not read.'));
      }
    });
    child.stdin.on('error', () => finish(new ChausarError('SANDBOX_FAILED', 'The light sandbox could not read the program.')));
    child.stdin.end(JSON.stringify({ mode: 'table', moduleBase64, maxMemoryPages, maxCellBytes: MAX_CELL_BYTES }));
  });
}

/** Compiles rows in chunks small enough for one worker each, so a long statement still fits the module limit. */
function compileChunks(program: RowProgram, rows: readonly Record<string, string>[]): { bytes: Uint8Array; count: number }[] {
  const chunks: { bytes: Uint8Array; count: number }[] = [];
  let start = 0;
  while (start < rows.length || (rows.length === 0 && chunks.length === 0)) {
    let size = Math.min(CHUNK_ROWS, Math.max(rows.length - start, 0));
    for (;;) {
      const compiled = compileRowProgram(program, rows.slice(start, start + size), MAX_MEMORY_PAGES);
      if (compiled.bytes.length <= MAX_MODULE_BYTES || size <= 1) {
        if (compiled.bytes.length > MAX_MODULE_BYTES) throw new ChausarError('SANDBOX_FAILED', 'One row of this table is too large for the light sandbox.');
        inspectWasm(compiled.bytes, MAX_MEMORY_PAGES); // the same inspection every plugin module passes
        chunks.push({ bytes: compiled.bytes, count: size });
        break;
      }
      size = Math.max(1, Math.floor(size / 2));
    }
    start += size;
    if (rows.length === 0) break;
  }
  return chunks;
}

/** Runs a checked row program over a table in the light sandbox. Output values are checked as labels before return. */
export async function runRowProgram(program: RowProgram, rows: readonly Record<string, string>[]): Promise<SandboxRun> {
  if (rows.length > MAX_TABLE_ROWS) throw new ChausarError('SANDBOX_FAILED', `The light sandbox takes at most ${MAX_TABLE_ROWS} rows at a time.`);
  const chunks = compileChunks(program, rows);
  const outputs = program.outputs.map(out => out.name);
  const result: string[][] = [];
  let memoryPages = 0;
  const digests: string[] = [];
  for (const chunk of chunks) {
    const base64 = Buffer.from(chunk.bytes).toString('base64');
    digests.push(digest(base64));
    const ran = await runWorker(base64, MAX_MEMORY_PAGES);
    if (ran.rows.length !== chunk.count || ran.rows.some(row => !Array.isArray(row) || row.length !== outputs.length || row.some(cell => typeof cell !== 'string'))) {
      throw new ChausarError('SANDBOX_FAILED', 'The light sandbox returned a table of the wrong shape.');
    }
    memoryPages = Math.max(memoryPages, ran.memoryPages);
    result.push(...ran.rows);
  }
  checkLabels(outputs, result);
  return { columns: outputs, rows: result, driver: 'wasm-lite', moduleDigest: digest(digests), memoryPages };
}

function checkLabels(columns: readonly string[], rows: readonly string[][]) {
  rows.forEach((row, index) => row.forEach((cell, column) => {
    const why = labelFinding(cell);
    if (why) {
      throw new ChausarError('SANDBOX_FAILED', `The program made a value that ${why} (row ${index + 1}, column ${columns[column]}). Programs make labels and keys; totals come from the calculator.`);
    }
  }));
}

// ---------------------------------------------------------------------------
// Containers (optional): Docker only where it is present
// ---------------------------------------------------------------------------

/** The real Docker port. It runs only the docker command, with no shell, and caps output and time. */
export function dockerProcess(request: SandboxProcessRequest): Promise<SandboxProcessResponse> {
  return new Promise((resolve, reject) => {
    if (request.command !== 'docker') { reject(new ChausarError('TIER_UNAVAILABLE', 'Only Docker runs through the container port.')); return; }
    let child;
    try { child = spawn('docker', request.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(new ChausarError('TIER_UNAVAILABLE', DOCKER_MISSING)); return; }
    let stdout = '', stderr = '', truncated = false, timedOut = false, settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, request.timeoutMs);
    child.on('error', () => { if (settled) return; settled = true; clearTimeout(timer); reject(new ChausarError('TIER_UNAVAILABLE', DOCKER_MISSING)); });
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > request.maxOutputBytes) { truncated = true; child.kill('SIGKILL'); return; }
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on('close', code => { if (settled) return; settled = true; clearTimeout(timer); resolve({ exitCode: code, stdout, stderr, timedOut, truncated }); });
    child.stdin.on('error', () => {});
    child.stdin.end(request.stdin);
  });
}

export type TierAvailability = { state: CapabilityState; reason: string };

/** Whether the container tier can run here now: Docker present and running, and the Python image already pulled. */
export async function containerAvailability(ports: SandboxPorts | undefined): Promise<TierAvailability> {
  const run = ports?.process ?? dockerProcess;
  let version: SandboxProcessResponse;
  try { version = await run({ command: 'docker', args: ['version', '--format', '{{.Server.Version}}'], stdin: '', timeoutMs: 5000, maxOutputBytes: 4096 }); }
  catch { return { state: 'needs-setup', reason: DOCKER_MISSING }; }
  if (version.exitCode !== 0 || version.timedOut) return { state: 'needs-setup', reason: DOCKER_STOPPED };
  let image: SandboxProcessResponse;
  try { image = await run({ command: 'docker', args: ['image', 'inspect', '--format', '{{.Id}}', PYTHON_IMAGE], stdin: '', timeoutMs: 5000, maxOutputBytes: 4096 }); }
  catch { return { state: 'needs-setup', reason: DOCKER_MISSING }; }
  if (image.exitCode !== 0) return { state: 'needs-setup', reason: DOCKER_IMAGE_MISSING };
  return { state: 'unverified', reason: DOCKER_READY };
}

const AVAILABILITY_TTL_MS = 60_000;
const checked = new WeakMap<object, { at: number; value: Promise<TierAvailability> }>();
const REAL_PORT = {};

/**
 * The container check, reused for a minute per port so a screen that lists capabilities does not start docker on
 * every load. A changed Docker setup shows within a minute.
 */
export function cachedContainerAvailability(ports: SandboxPorts | undefined, nowMs: number): Promise<TierAvailability> {
  const key = ports ?? REAL_PORT;
  const hit = checked.get(key);
  if (hit && nowMs - hit.at < AVAILABILITY_TTL_MS) return hit.value;
  const value = containerAvailability(ports);
  checked.set(key, { at: nowMs, value });
  return value;
}

/** The fixed runner inside the container: it calls the agent's transform(row) once per row and prints JSON. */
export const PYTHON_RUNNER = [
  'import json, sys',
  'request = json.load(sys.stdin)',
  "scope = {'__name__': 'agent'}",
  "exec(compile(request['code'], 'agent.py', 'exec'), scope)",
  "transform = scope.get('transform')",
  "if not callable(transform): raise SystemExit('NO_TRANSFORM')",
  'rows = []',
  "for row in request['rows']:",
  "    value = transform(dict(row['cells']))",
  "    if not isinstance(value, dict): raise SystemExit('NOT_A_DICT')",
  '    rows.append({str(key): str(item) for key, item in value.items()})',
  "sys.stdout.write(json.dumps({'rows': rows}))",
].join('\n');

/** The exact docker arguments: no network, read-only root, every capability dropped, small memory and process caps. */
export function dockerRunArgs(): string[] {
  return [
    'run', '--rm', '-i', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '64', '--memory', '256m', '--cpus', '1', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--env', 'PYTHONDONTWRITEBYTECODE=1', PYTHON_IMAGE, 'python', '-I', '-c', PYTHON_RUNNER,
  ];
}

/** Runs the agent's Python transform(row) over a table in a container. Checks availability first and refuses honestly. */
export async function runPythonTransform(ports: SandboxPorts | undefined, code: string, rows: readonly { id: string; cells: Record<string, string> }[]): Promise<SandboxRun> {
  const available = await containerAvailability(ports);
  if (available.state !== 'unverified' && available.state !== 'available') throw new ChausarError('TIER_UNAVAILABLE', available.reason);
  if (rows.length > MAX_TABLE_ROWS) throw new ChausarError('SANDBOX_FAILED', `The container takes at most ${MAX_TABLE_ROWS} rows at a time.`);
  const run = ports?.process ?? dockerProcess;
  const response = await run({ command: 'docker', args: dockerRunArgs(), stdin: JSON.stringify({ code, rows }), timeoutMs: 30000, maxOutputBytes: WORKER_OUTPUT_BYTES });
  if (response.timedOut) throw new ChausarError('SANDBOX_FAILED', 'The Python code ran past its time limit in the container.');
  if (response.truncated) throw new ChausarError('SANDBOX_FAILED', 'The Python code made more output than allowed.');
  if (response.exitCode !== 0) {
    const known = /\b(NO_TRANSFORM|NOT_A_DICT)\b/.exec(response.stderr)?.[1];
    throw new ChausarError('SANDBOX_FAILED', known === 'NO_TRANSFORM' ? 'The Python code needs a function transform(row) that returns a dict.'
      : known === 'NOT_A_DICT' ? 'transform(row) must return a dict of new columns.' : 'The Python code failed in the container.');
  }
  let parsed: { rows?: unknown };
  try { parsed = JSON.parse(response.stdout); } catch { throw new ChausarError('SANDBOX_FAILED', 'The container returned something Chausar could not read.'); }
  const out = parsed?.rows;
  if (!Array.isArray(out) || out.length !== rows.length) throw new ChausarError('SANDBOX_FAILED', 'The container returned a table of the wrong shape.');
  const columns = out.length ? Object.keys(out[0] as object) : [];
  if (columns.length < 1 || columns.length > 12 || !columns.every(name => /^[a-z][a-z0-9_]{0,30}$/.test(name))) {
    throw new ChausarError('SANDBOX_FAILED', 'transform(row) must return between one and twelve columns with lower case names.');
  }
  const table = out.map(row => {
    const record = row as Record<string, unknown>;
    if (!record || typeof record !== 'object' || Object.keys(record).length !== columns.length || !columns.every(name => typeof record[name] === 'string' && (record[name] as string).length <= MAX_CELL_BYTES)) {
      throw new ChausarError('SANDBOX_FAILED', 'Every row from transform(row) needs the same columns, as short text.');
    }
    return columns.map(name => record[name] as string);
  });
  checkLabels(columns, table);
  return { columns, rows: table, driver: 'docker', moduleDigest: null, memoryPages: 0 };
}
