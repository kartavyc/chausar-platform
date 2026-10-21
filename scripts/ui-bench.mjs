// Runs the Ink frontend's tests (vitest, app/ui) the way the open suite runs the engine's (scripts/bench.mjs): every
// test in every file, and the run fails on a failed, skipped or todo test, not only on a failure. Writes a small
// receipt to results/ui-tests.json (or --output <path inside the repository>).
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/ui-bench.mjs [--output results/ui-tests.json]';
let requested = 'results/ui-tests.json';
if (args.length) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('--')) throw new Error(usage);
  requested = args[1];
}
const destination = resolve(root, requested); const inside = relative(root, destination);
if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || !destination.endsWith('.json')) {
  throw new Error('The UI test receipt must be a JSON file within this repository.');
}
const raw = resolve(root, 'results', 'ui-tests.vitest.json');
await mkdir(dirname(raw), { recursive: true });
await mkdir(dirname(destination), { recursive: true });

const startedAt = new Date().toISOString();
const command = [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'app/ui/vitest.config.ts',
  '--reporter=default', '--reporter=json', `--outputFile.json=${raw}`];
const exitCode = await new Promise((fulfill) => {
  const child = spawn(process.execPath, command, { cwd: root, windowsHide: true, stdio: 'inherit' });
  child.once('error', () => fulfill(null)); child.once('close', code => fulfill(code));
});

let counts = null;
try {
  const report = JSON.parse(await readFile(raw, 'utf8'));
  counts = { suites: report.numTotalTestSuites, tests: report.numTotalTests, pass: report.numPassedTests, fail: report.numFailedTests,
    skipped: report.numPendingTests, todo: report.numTodoTests };
} catch { counts = null; }
const passed = exitCode === 0 && counts !== null && counts.tests > 0 && counts.fail === 0 && counts.skipped === 0 && counts.todo === 0;
const receipt = { schema: 'chausar.ui-tests.v1', startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version,
  command: ['node', ...command.map(part => part.replace(root + (process.platform === 'win32' ? '\\' : '/'), '').replaceAll('\\', '/'))], counts, passed };
await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ passed, counts, report: relative(root, destination).replaceAll('\\', '/') }));
if (!passed) process.exitCode = 1;
