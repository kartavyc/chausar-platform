// Runs the Ink frontend's tests (vitest, app/ui) the way the open suite runs the engine's (scripts/bench.mjs): every
// test in every file, and the run fails on a failed, skipped or todo test, not only on a failure. Writes a small
// receipt, ui-tests.json, to the run root (CHAUSAR_RUN_ROOT/ui-tests, else the temp folder's chausar-runs/<date>-ui-tests), with vitest's
// raw report beside it (or --output <file.json>, anywhere outside the checkout; D3).
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputFile } from '../platform/runtime/run-root.mjs';
import { testReceipt, vitestRows } from './receipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/ui-bench.mjs [--output <file.json>] [--shard=I/N, N from 1 to 8]';
let requested; let shard = null;
const seen = new Set();
for (let index = 0; index < args.length; index++) {
  const option = args[index].split('=', 1)[0];
  if (!['--output', '--shard'].includes(option) || seen.has(option)) throw new Error(usage);
  seen.add(option);
  const value = args[index].includes('=') ? args[index].slice(option.length + 1) : args[++index];
  if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error(usage);
  if (option === '--output') requested = value;
  else {
    // D2: vitest's own --shard splits the test files; the raw report and the receipt say which shard ran.
    if (!/^[1-8]\/[1-8]$/.test(value) || Number(value[0]) > Number(value[2])) throw new Error('The UI shard must be I/N with N from 1 to 8 and I from 1 to N, such as 2/3.');
    shard = { index: Number(value[0]), total: Number(value[2]) };
  }
}
const destination = outputFile(requested, { name: 'ui-tests', file: 'ui-tests.json' });
const raw = join(dirname(destination), shard ? `ui-tests.shard-${shard.index}-of-${shard.total}.vitest.json` : 'ui-tests.vitest.json');
await mkdir(dirname(raw), { recursive: true });
await mkdir(dirname(destination), { recursive: true });

const startedAt = new Date().toISOString();
const command = [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'app/ui/vitest.config.ts',
  '--reporter=default', '--reporter=json', `--outputFile.json=${raw}`, ...(shard ? [`--shard=${shard.index}/${shard.total}`] : [])];
const exitCode = await new Promise((fulfill) => {
  const child = spawn(process.execPath, command, { cwd: root, windowsHide: true, stdio: 'inherit' });
  child.once('error', () => fulfill(null)); child.once('close', code => fulfill(code));
});

let counts = null; let rows = [];
const inRepository = path => relative(root, resolve(root, path)).replaceAll('\\', '/');
try {
  const report = JSON.parse(await readFile(raw, 'utf8'));
  rows = vitestRows(report, inRepository);
  counts = { suites: report.numTotalTestSuites, tests: report.numTotalTests, pass: report.numPassedTests, fail: report.numFailedTests,
    skipped: report.numPendingTests, todo: report.numTodoTests };
} catch { counts = null; }
const passed = exitCode === 0 && counts !== null && counts.tests > 0 && counts.fail === 0 && counts.skipped === 0 && counts.todo === 0;
const finishedAt = new Date().toISOString();
// D11: the common receipt part (scripts/receipt.mjs) beside this receipt's own fields.
const receipt = { schema: 'chausar.ui-tests.v1', ...testReceipt({ tool: 'ui-tests', startedAt, finishedAt, shard, files: rows }), nodeVersion: process.version,
  command: ['node', ...command.map(part => part.replace(root + (process.platform === 'win32' ? '\\' : '/'), '').replaceAll('\\', '/'))], counts, passed };
await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ passed, counts, report: destination.replaceAll('\\', '/') }));
if (!passed) process.exitCode = 1;
