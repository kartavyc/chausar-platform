import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); let requestedOutput = 'results/factory-bench.json'; let shard = null; let requestedWorkers = null; let weightSources = null;
const usage = 'Usage: node scripts/bench.mjs [--output results/factory-bench.json] [--workers=N] [--shard=I/N, N from 1 to 8] [--list] | --write-weights=<receipt.json>[,<receipt.json>...]';
const seen = new Set(); let list = false;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  // --list prints the files this run would pick (and the shard plan) and runs nothing.
  if (argument === '--list') { if (list) throw new Error(usage); list = true; continue; }
  const option = argument.split('=', 1)[0];
  if (!['--output', '--shard', '--workers', '--write-weights'].includes(option) || seen.has(option)) throw new Error(usage);
  seen.add(option);
  const value = argument.includes('=') ? argument.slice(option.length + 1) : args[++index];
  if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error(usage);
  if (option === '--output') requestedOutput = value;
  else if (option === '--workers') {
    if (!/^[1-9]\d?$/.test(value) || Number(value) > 64) throw new Error('Workers must be a whole number from 1 to 64.');
    requestedWorkers = Number(value);
  } else if (option === '--write-weights') weightSources = value.split(',');
  else {
    if (!/^[1-8]\/[1-8]$/.test(value) || Number(value[0]) > Number(value[2])) throw new Error('Benchmark shard must be I/N with N from 1 to 8 and I from 1 to N, such as 2/3.');
    const [shardIndex, shardTotal] = value.split('/').map(Number);
    shard = { index: shardIndex, total: shardTotal };
  }
}
if (weightSources && seen.size > 1) throw new Error(usage);
const insideRepository = (path) => {
  const target = resolve(root, path), inner = relative(root, target);
  if (!path || isAbsolute(inner) || inner === '..' || inner.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || !target.endsWith('.json')) return null;
  return { target, inner };
};
const weightsPath = resolve(root, 'platform/tests/test-weights.json');
if (weightSources) {
  // D2: refresh the shard weights from one or more receipts' fileTimings (the shards of one full run, or a full run).
  const weights = {};
  for (const source of weightSources) {
    const found = insideRepository(source);
    if (!found) throw new Error('Weights come from benchmark receipts: JSON files within this repository.');
    const receipt = JSON.parse(await readFile(found.target, 'utf8'));
    if (receipt.schema !== 'chausar.factory-bench.v1' || !receipt.fileTimings || typeof receipt.fileTimings !== 'object') throw new Error(`${source} is not a benchmark receipt with fileTimings.`);
    for (const [file, seconds] of Object.entries(receipt.fileTimings)) if (typeof seconds === 'number' && seconds >= 0) weights[file] = Math.max(0.1, Math.round(seconds * 10) / 10);
  }
  const sorted = Object.fromEntries(Object.keys(weights).sort().map(file => [file, weights[file]]));
  await writeFile(weightsPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ weights: relative(root, weightsPath).replaceAll('\\', '/'), files: Object.keys(sorted).length })}\n`);
  process.exit(0);
}
const output = insideRepository(requestedOutput);
if (!output) throw new Error('Benchmark output must be a JSON file within this repository.');
const { target: destination, inner: inside } = output;
const discoveryPattern = 'platform/tests/*.test.ts';
const discoveredFiles = [];
for await (const file of glob(discoveryPattern, { cwd: root })) discoveredFiles.push(file.replaceAll('\\', '/'));
discoveredFiles.sort();
// D2: one time-balanced plan for any shard count from 1 to 8. Each file weighs its seconds in
// platform/tests/test-weights.json (`--write-weights` refreshes it; a file missing there counts 1 s). Files are placed
// heaviest first, ties by name, each on the lightest shard so far (ties: the lower shard), so the plan is the same on
// every run and every computer.
let weights = {};
try { weights = JSON.parse(await readFile(weightsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const weightOf = file => (typeof weights[file] === 'number' && weights[file] >= 0 ? weights[file] : 1);
let selectedFiles = null; let plan = null;
if (shard) {
  const groups = Array.from({ length: shard.total }, (_, index) => ({ index: index + 1, files: [], estimatedSeconds: 0 }));
  const ordered = discoveredFiles.slice().sort((left, right) => weightOf(right) - weightOf(left) || (left < right ? -1 : left > right ? 1 : 0));
  for (const file of ordered) {
    const lightest = groups.reduce((best, group) => (group.estimatedSeconds < best.estimatedSeconds ? group : best));
    lightest.files.push(file); lightest.estimatedSeconds += weightOf(file);
  }
  for (const group of groups) { group.files.sort(); group.estimatedSeconds = Math.round(group.estimatedSeconds * 10) / 10; }
  const covered = groups.flatMap(group => group.files);
  if (new Set(covered).size !== discoveredFiles.length || JSON.stringify(covered.slice().sort()) !== JSON.stringify(discoveredFiles)) {
    throw new Error('The shard plan must cover every discovered test file exactly once.');
  }
  // An empty shard would hand Node no files, and Node would then run its own discovery: refuse instead.
  if (groups[shard.index - 1].files.length === 0) throw new Error(`Shard ${shard.index}/${shard.total} has no test files: there are fewer test files than shards.`);
  selectedFiles = groups[shard.index - 1].files;
  plan = { name: 'time-balanced-v1', weights: 'platform/tests/test-weights.json', defaultSeconds: 1, groups };
}
// Every receipt retains the complete discovery universe; a shard receipt also records its exact files and every group.
const testFiles = { pattern: discoveryPattern, discovered: discoveredFiles,
  inventorySha256: createHash('sha256').update(JSON.stringify(discoveredFiles)).digest('hex'),
  selection: plan ? 'time-balanced-plan' : 'all-discovered-files',
  ...(plan ? { selectedFiles, plan } : {}) };
if (list) {
  process.stdout.write(`${JSON.stringify({ shard, selection: testFiles.selection, files: selectedFiles ?? discoveredFiles, ...(plan ? { plan: plan.groups.map(group => ({ index: group.index, files: group.files.length, estimatedSeconds: group.estimatedSeconds })) } : {}) }, null, 2)}\n`);
  process.exit(0);
}
// D2: the test files run side by side. More workers make more vault and job folders in the OS temp folder at once, so
// the free space there is checked first: under 2 GB nothing runs, under 6 GB at most two workers run.
// CHAUSAR_BENCH_FREE_BYTES (read here only) lets the bench's own test fake the number.
const GIB = 1024 ** 3;
const temporary = tmpdir();
const tempFreeBytes = process.env.CHAUSAR_BENCH_FREE_BYTES !== undefined ? Number(process.env.CHAUSAR_BENCH_FREE_BYTES)
  : await statfs(temporary).then(stats => stats.bavail * stats.bsize);
const drive = process.platform === 'win32' ? parse(temporary).root.replace(/[\\/]+$/, '') : temporary;
const gigabytes = (tempFreeBytes / GIB).toFixed(1);
if (!(tempFreeBytes >= 2 * GIB)) {
  process.stderr.write(`Free space on ${drive} is ${gigabytes} GB. The engine tests need at least 2 GB in the temp folder.\n`);
  process.exit(2);
}
let workers = requestedWorkers ?? (process.env.CI ? 3 : Math.max(1, availableParallelism() - 1));
if (tempFreeBytes < 6 * GIB && workers > 2) {
  workers = 2;
  process.stderr.write(`Free space on ${drive} is ${gigabytes} GB, so the engine tests run with 2 workers.\n`);
}
const startedAt = new Date().toISOString();
// Each shard has a twenty-minute deadline; the worker count above bounds the files running at once.
// Run every test in each selected file; no case filters or skip patterns.
// A second reporter (D2) adds up each file's top-level test time into a lines file beside the receipt; the receipt
// keeps it as fileTimings and the lines file is removed.
const timingsPath = destination.replace(/\.json$/, '.timings.jsonl');
const timingsInside = relative(root, timingsPath).replaceAll('\\', '/');
await mkdir(dirname(destination), { recursive: true }); await rm(timingsPath, { force: true });
const command = ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
  '--test-reporter=./scripts/test-timing-reporter.mjs', `--test-reporter-destination=${timingsInside}`, `--test-concurrency=${workers}`,
  ...(selectedFiles ?? [discoveryPattern])];
const fullSuite = shard === null;
const outcome = await new Promise((fulfill) => {
  const child = spawn(process.execPath, command, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let truncated = false; let settled = false; let timeout = false;
  const finish = (exitCode, signal, error) => { if (settled) return; settled = true; clearTimeout(deadline); fulfill({ stdout, stderr, truncated, timeout, exitCode, signal, error }); };
  const capture = (current, chunk) => { if (current.length + chunk.length > 16 * 1024 * 1024) { truncated = true; return current; } return current + chunk; };
  child.stdout.on('data', data => { stdout = capture(stdout, data.toString()); });
  child.stderr.on('data', data => { stderr = capture(stderr, data.toString()); });
  child.once('error', error => finish(null, null, error.message)); child.once('close', (code, signal) => finish(code, signal));
  const deadline = setTimeout(() => { timeout = true; child.kill(); }, 20 * 60 * 1000);
});
const counts = {};
for (const name of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) { const matches = [...outcome.stdout.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, 'gm'))]; counts[name] = matches.length ? Number(matches.at(-1)[1]) : null; }
const hasSummary = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].every(name => Number.isSafeInteger(counts[name]));
const fileTimings = {};
for (const line of (await readFile(timingsPath, 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
  const { file, ms } = JSON.parse(line);
  fileTimings[relative(root, file).replaceAll('\\', '/')] = Math.round(ms) / 1000;
}
await rm(timingsPath, { force: true });
const passed = outcome.exitCode === 0 && hasSummary && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0 && !outcome.timeout && !outcome.truncated;
const report = {
  schema: 'chausar.factory-bench.v1', startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version,
  command: ['node', ...command], scope: fullSuite ? 'Repository open tests' : `Repository open tests (shard ${shard.index}/${shard.total})`, counts, passed,
  shard, fullSuite, workers, tempFreeBytes, testFiles, fileTimings,
  exitCode: outcome.exitCode, signal: outcome.signal ?? null, timeout: outcome.timeout, outputTruncated: outcome.truncated,
  productionQualified: false,
  qualification: { openTests: passed ? 'passed' : 'failed', testRunComplete: hasSummary && counts.skipped === 0 && counts.todo === 0, specificationCoverageCertified: false, hiddenBusinessAcceptance: 'not-run', sealedBusinessAcceptance: 'not-run', releaseSigning: 'not-run', realConnectorQualification: 'not-run' },
  ...(outcome.error ? { runnerError: outcome.error } : {}),
  stdout: outcome.stdout, stderr: outcome.stderr,
};
await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ passed, counts, report: inside.replaceAll('\\', '/'), shard, fullSuite, productionQualified: false })}\n`);
process.exitCode = passed ? 0 : 1;
