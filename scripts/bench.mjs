import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); let requestedOutput = 'results/factory-bench.json';
if (args.length) {
  if (args.length === 2 && args[0] === '--output') requestedOutput = args[1];
  else if (args.length === 1 && args[0].startsWith('--output=')) requestedOutput = args[0].slice(9);
  else throw new Error('Usage: node scripts/bench.mjs [--output results/factory-bench.json]');
}
const destination = resolve(root, requestedOutput); const inside = relative(root, destination);
if (!requestedOutput || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || !destination.endsWith('.json')) throw new Error('Benchmark output must be a JSON file within this repository.');
const startedAt = new Date().toISOString();
// Bound simultaneous vault/KDF fixtures consistently with local qualification.
// The Windows runner exhausted the unchanged ten-minute limit at default concurrency.
const command = ['--test', '--test-reporter=tap', '--test-concurrency=1', 'platform/tests/*.test.ts'];
const outcome = await new Promise((fulfill) => {
  const child = spawn(process.execPath, command, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let truncated = false; let settled = false; let timeout = false;
  const finish = (exitCode, signal, error) => { if (settled) return; settled = true; clearTimeout(deadline); fulfill({ stdout, stderr, truncated, timeout, exitCode, signal, error }); };
  const capture = (current, chunk) => { if (current.length + chunk.length > 16 * 1024 * 1024) { truncated = true; return current; } return current + chunk; };
  child.stdout.on('data', data => { stdout = capture(stdout, data.toString()); });
  child.stderr.on('data', data => { stderr = capture(stderr, data.toString()); });
  child.once('error', error => finish(null, null, error.message)); child.once('close', (code, signal) => finish(code, signal));
  const deadline = setTimeout(() => { timeout = true; child.kill(); }, 10 * 60 * 1000);
});
const counts = {};
for (const name of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) { const matches = [...outcome.stdout.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, 'gm'))]; counts[name] = matches.length ? Number(matches.at(-1)[1]) : null; }
const hasSummary = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].every(name => Number.isSafeInteger(counts[name]));
const passed = outcome.exitCode === 0 && hasSummary && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && !outcome.timeout && !outcome.truncated;
const report = {
  schema: 'chausar.factory-bench.v1', startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version,
  command: ['node', ...command], scope: 'Repository open tests', counts, passed,
  exitCode: outcome.exitCode, signal: outcome.signal ?? null, timeout: outcome.timeout, outputTruncated: outcome.truncated,
  productionQualified: false,
  qualification: { openTests: passed ? 'passed' : 'failed', testRunComplete: hasSummary && counts.skipped === 0 && counts.todo === 0, specificationCoverageCertified: false, hiddenBusinessAcceptance: 'not-run', sealedBusinessAcceptance: 'not-run', releaseSigning: 'not-run', realConnectorQualification: 'not-run' },
  ...(outcome.error ? { runnerError: outcome.error } : {}),
  stdout: outcome.stdout, stderr: outcome.stderr,
};
await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ passed, counts, report: inside.replaceAll('\\', '/'), productionQualified: false })}\n`);
process.exitCode = passed ? 0 : 1;
