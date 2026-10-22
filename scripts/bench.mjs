import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); let requestedOutput = 'results/factory-bench.json'; let shard = null;
const usage = 'Usage: node scripts/bench.mjs [--output results/factory-bench.json] [--shard=1/2|--shard=2/2|--shard=1/4|--shard=2/4|--shard=3/4|--shard=4/4|--shard=1/5|--shard=2/5|--shard=3/5|--shard=4/5|--shard=5/5|--shard=1/6|--shard=2/6|--shard=3/6|--shard=4/6|--shard=5/6|--shard=6/6]';
const seen = new Set();
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  const option = argument.split('=', 1)[0];
  if (!['--output', '--shard'].includes(option) || seen.has(option)) throw new Error(usage);
  seen.add(option);
  const value = argument.includes('=') ? argument.slice(option.length + 1) : args[++index];
  if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error(usage);
  if (option === '--output') requestedOutput = value;
  else {
    if (!/^(?:[12]\/2|[1-4]\/4|[1-5]\/5|[1-6]\/6)$/.test(value)) throw new Error('Benchmark shard must be exactly 1/2, 2/2, 1/4, 2/4, 3/4, 4/4, 1/5 to 5/5, or 1/6 to 6/6.');
    const [shardIndex, shardTotal] = value.split('/').map(Number);
    shard = { index: shardIndex, total: shardTotal };
  }
}
const destination = resolve(root, requestedOutput); const inside = relative(root, destination);
if (!requestedOutput || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || !destination.endsWith('.json')) throw new Error('Benchmark output must be a JSON file within this repository.');
const discoveryPattern = 'platform/tests/*.test.ts';
const discoveredFiles = [];
for await (const file of glob(discoveryPattern, { cwd: root })) discoveredFiles.push(file.replaceAll('\\', '/'));
discoveredFiles.sort();
let selectedFiles = null; let plan = null;
if (shard?.total === 5 || shard?.total === 6) {
  // The planned shards keep the long independent activation suite on its own shard and spread every other file
  // round-robin over the ordinary groups: four groups in the five-shard plan, five in the six-shard plan. The
  // six-shard plan exists because the open suite grew (216 to 272 files in October 2026) and one of four groups
  // reached the ten-minute deadline on Windows; a fifth group keeps every shard well inside it.
  const planned = shard.total === 5 ? 'Five' : 'Six';
  const ordinaryTotal = shard.total - 1;
  const dedicatedFile = 'platform/tests/workspace-activation-independent-public-acceptance.test.ts';
  if (!discoveredFiles.includes(dedicatedFile)) throw new Error(`${planned}-shard plan requires the dedicated independent activation test file.`);
  const ordinaryFiles = discoveredFiles.filter(file => file !== dedicatedFile);
  const groups = Array.from({ length: ordinaryTotal }, (_, index) => ordinaryFiles.filter((_, position) => position % ordinaryTotal === index));
  groups.push([dedicatedFile]);
  const coveredFiles = groups.flat();
  if (groups.some(files => files.length === 0) || new Set(coveredFiles).size !== discoveredFiles.length ||
      JSON.stringify(coveredFiles.slice().sort()) !== JSON.stringify(discoveredFiles)) {
    throw new Error(`${planned}-shard plan must provide nonempty, disjoint groups covering the complete discovered inventory.`);
  }
  selectedFiles = groups[shard.index - 1];
  plan = { name: shard.total === 5 ? 'four-stable-groups-plus-independent-activation-v1' : 'five-stable-groups-plus-independent-activation-v1',
    ordinaryShardTotal: ordinaryTotal, dedicatedFile, groups: groups.map((files, index) => ({ index: index + 1, files })) };
}
// Every receipt retains the complete discovery universe. The planned five-way and six-way splits also record their
// exact selected files and every complementary group. Legacy Node sharding deliberately does not claim to identify
// the files each shard ran.
const testFiles = { pattern: discoveryPattern, discovered: discoveredFiles,
  inventorySha256: createHash('sha256').update(JSON.stringify(discoveredFiles)).digest('hex'),
  selection: plan ? (shard.total === 5 ? 'explicit-stable-five-shard-plan' : 'explicit-stable-six-shard-plan') : shard ? 'node-test-shard' : 'all-discovered-files',
  ...(plan ? { selectedFiles, plan } : {}) };
const startedAt = new Date().toISOString();
// Bound simultaneous vault/KDF fixtures consistently with local qualification.
// Each shard retains the ten-minute deadline and single-worker resource bound.
// Run every test in each selected file; no case filters or skip patterns.
const command = ['--test', '--test-reporter=tap', '--test-concurrency=1',
  ...(selectedFiles ?? [...(shard ? [`--test-shard=${shard.index}/${shard.total}`] : []), discoveryPattern])];
const fullSuite = shard === null;
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
const passed = outcome.exitCode === 0 && hasSummary && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0 && !outcome.timeout && !outcome.truncated;
const report = {
  schema: 'chausar.factory-bench.v1', startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version,
  command: ['node', ...command], scope: fullSuite ? 'Repository open tests' : `Repository open tests (shard ${shard.index}/${shard.total})`, counts, passed,
  shard, fullSuite, testFiles,
  exitCode: outcome.exitCode, signal: outcome.signal ?? null, timeout: outcome.timeout, outputTruncated: outcome.truncated,
  productionQualified: false,
  qualification: { openTests: passed ? 'passed' : 'failed', testRunComplete: hasSummary && counts.skipped === 0 && counts.todo === 0, specificationCoverageCertified: false, hiddenBusinessAcceptance: 'not-run', sealedBusinessAcceptance: 'not-run', releaseSigning: 'not-run', realConnectorQualification: 'not-run' },
  ...(outcome.error ? { runnerError: outcome.error } : {}),
  stdout: outcome.stdout, stderr: outcome.stderr,
};
await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ passed, counts, report: inside.replaceAll('\\', '/'), shard, fullSuite, productionQualified: false })}\n`);
process.exitCode = passed ? 0 : 1;
