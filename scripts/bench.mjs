import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// D3: the receipt goes to the run root (CHAUSAR_RUN_ROOT, else the temp folder), never inside the checkout.
import { outputFile } from '../platform/runtime/run-root.mjs';
import { nodeTimingRows, testReceipt } from './receipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); let requestedOutput; let shard = null; let requestedWorkers = null; let weightSources = null; let tier = 'all'; let isolation = 'process';
const usage = 'Usage: node scripts/bench.mjs [--output <file.json>] [--workers=N] [--tier=fast|heavy|all] [--isolation=none] [--shard=I/N, N from 1 to 8] [--list] | --write-weights=<receipt.json>[,<receipt.json>...]';
const seen = new Set(); let list = false;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  // --list prints the files this run would pick (and the shard plan) and runs nothing.
  if (argument === '--list') { if (list) throw new Error(usage); list = true; continue; }
  const option = argument.split('=', 1)[0];
  if (!['--output', '--shard', '--workers', '--write-weights', '--tier', '--isolation'].includes(option) || seen.has(option)) throw new Error(usage);
  seen.add(option);
  const value = argument.includes('=') ? argument.slice(option.length + 1) : args[++index];
  if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error(usage);
  if (option === '--output') requestedOutput = value;
  else if (option === '--workers') {
    if (!/^[1-9]\d?$/.test(value) || Number(value) > 64) throw new Error('Workers must be a whole number from 1 to 64.');
    requestedWorkers = Number(value);
  } else if (option === '--write-weights') weightSources = value.split(',');
  else if (option === '--isolation') {
    if (!['none', 'process'].includes(value)) throw new Error('Isolation must be none or process.');
    isolation = value;
  } else if (option === '--tier') {
    if (!['fast', 'heavy', 'all'].includes(value)) throw new Error('The tier must be fast, heavy or all.');
    tier = value;
  } else {
    if (!/^[1-8]\/[1-8]$/.test(value) || Number(value[0]) > Number(value[2])) throw new Error('Benchmark shard must be I/N with N from 1 to 8 and I from 1 to N, such as 2/3.');
    const [shardIndex, shardTotal] = value.split('/').map(Number);
    shard = { index: shardIndex, total: shardTotal };
  }
}
if (weightSources && seen.size > 1) throw new Error(usage);
const weightsPath = resolve(root, 'platform/tests/test-weights.json');
if (weightSources) {
  // D2: refresh the shard weights from one or more receipts' fileTimings (the shards of one full run, or a full run).
  const weights = {};
  for (const source of weightSources) {
    // D3: receipts live in the run root (or wherever a run wrote them); the weights file is the one write in the checkout.
    if (!source.endsWith('.json')) throw new Error('Weights come from benchmark receipts: JSON files.');
    const receipt = JSON.parse(await readFile(resolve(source), 'utf8'));
    if (receipt.schema !== 'chausar.factory-bench.v1' || !receipt.fileTimings || typeof receipt.fileTimings !== 'object') throw new Error(`${source} is not a benchmark receipt with fileTimings.`);
    for (const [file, seconds] of Object.entries(receipt.fileTimings)) if (typeof seconds === 'number' && seconds >= 0) weights[file] = Math.max(weights[file] ?? 0, 0.1, Math.round(seconds * 10) / 10);
  }
  const sorted = Object.fromEntries(Object.keys(weights).sort().map(file => [file, weights[file]]));
  await writeFile(weightsPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ weights: relative(root, weightsPath).replaceAll('\\', '/'), files: Object.keys(sorted).length })}\n`);
  process.exit(0);
}
// D3: no --output means <run root>/engine-tests/factory-bench.json; a given path is any .json file outside the checkout.
const destination = outputFile(requestedOutput, { name: 'engine-tests', file: 'factory-bench.json' });
const discoveryPattern = 'platform/tests/*.test.ts';
const discoveredFiles = [];
for await (const file of glob(discoveryPattern, { cwd: root })) discoveredFiles.push(file.replaceAll('\\', '/'));
discoveredFiles.sort();
// D2: platform/tests/tiers.json names the heavy files (over 20 s). --tier=fast runs every other file, --tier=heavy only
// those, --tier=all (the default) every file. A name there that no longer exists fails the run, so the list stays true.
let tiers = { heavy: [], isolated: [] };
try { tiers = JSON.parse(await readFile(resolve(root, 'platform/tests/tiers.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const file of [...(tiers.heavy ?? []), ...(tiers.isolated ?? [])]) {
  if (!discoveredFiles.includes(file)) throw new Error(`platform/tests/tiers.json names a test file that does not exist: ${file}`);
}
const tierFiles = tier === 'all' ? discoveredFiles : discoveredFiles.filter(file => (tier === 'heavy') === (tiers.heavy ?? []).includes(file));
if (tierFiles.length === 0) throw new Error(`The ${tier} tier has no test files.`);
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
  const ordered = tierFiles.slice().sort((left, right) => weightOf(right) - weightOf(left) || (left < right ? -1 : left > right ? 1 : 0));
  for (const file of ordered) {
    const lightest = groups.reduce((best, group) => (group.estimatedSeconds < best.estimatedSeconds ? group : best));
    lightest.files.push(file); lightest.estimatedSeconds += weightOf(file);
  }
  for (const group of groups) { group.files.sort(); group.estimatedSeconds = Math.round(group.estimatedSeconds * 10) / 10; }
  const covered = groups.flatMap(group => group.files);
  if (new Set(covered).size !== tierFiles.length || JSON.stringify(covered.slice().sort()) !== JSON.stringify(tierFiles)) {
    throw new Error('The shard plan must cover every discovered test file exactly once.');
  }
  // An empty shard would hand Node no files, and Node would then run its own discovery: refuse instead.
  if (groups[shard.index - 1].files.length === 0) throw new Error(`Shard ${shard.index}/${shard.total} has no test files: there are fewer test files than shards.`);
  selectedFiles = groups[shard.index - 1].files;
  plan = { name: 'time-balanced-v1', weights: 'platform/tests/test-weights.json', defaultSeconds: 1, groups };
} else if (tier !== 'all') selectedFiles = tierFiles;
// Every receipt retains the complete discovery universe; a shard receipt also records its exact files and every group.
const testFiles = { pattern: discoveryPattern, discovered: discoveredFiles,
  inventorySha256: createHash('sha256').update(JSON.stringify(discoveredFiles)).digest('hex'),
  selection: plan ? 'time-balanced-plan' : selectedFiles ? 'tier' : 'all-discovered-files',
  ...(selectedFiles ? { selectedFiles } : {}), ...(plan ? { plan } : {}) };
if (list) {
  process.stdout.write(`${JSON.stringify({ tier, shard, selection: testFiles.selection, files: selectedFiles ?? discoveredFiles, ...(plan ? { plan: plan.groups.map(group => ({ index: group.index, files: group.files.length, estimatedSeconds: group.estimatedSeconds })) } : {}) }, null, 2)}\n`);
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
// Each run has a twenty-minute deadline; the worker count above bounds the files running at once.
// Run every test in each selected file; no case filters or skip patterns.
// A second reporter (D2) adds up each file's top-level test time into a lines file beside the receipt; the receipt
// keeps it as fileTimings and the lines file is removed.
// D2 task 6: --isolation=none runs the selected files in one process (Node's --test-isolation=none), except the files
// tiers.json lists as isolated (they set process.env, chdir, assign globalThis or mock timers), which then run in a
// second invocation with a process each. Both feed the same receipt. Without the flag nothing changes.
await mkdir(dirname(destination), { recursive: true });
const inRepository = path => relative(root, path).replaceAll('\\', '/');
const commandFor = (files, timings, shared) => ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
  '--test-reporter=./scripts/test-timing-reporter.mjs', `--test-reporter-destination=${timings}`,
  ...(shared ? ['--test-isolation=none'] : []), `--test-concurrency=${workers}`, ...files];
const phases = [];
if (isolation === 'none') {
  const chosen = selectedFiles ?? tierFiles;
  const separate = chosen.filter(file => (tiers.isolated ?? []).includes(file)), together = chosen.filter(file => !separate.includes(file));
  if (together.length) phases.push({ command: commandFor(together, destination.replace(/\.json$/, '.timings.jsonl'), true), timings: destination.replace(/\.json$/, '.timings.jsonl') });
  if (separate.length) phases.push({ command: commandFor(separate, destination.replace(/\.json$/, '.isolated-timings.jsonl'), false), timings: destination.replace(/\.json$/, '.isolated-timings.jsonl') });
} else {
  phases.push({ command: commandFor(selectedFiles ?? [discoveryPattern], destination.replace(/\.json$/, '.timings.jsonl'), false), timings: destination.replace(/\.json$/, '.timings.jsonl') });
}
const command = phases[0].command; const isolatedCommand = phases[1]?.command ?? null;
const fullSuite = shard === null && tier === 'all';
const scopeParts = [...(tier === 'all' ? [] : [`${tier} tier`]), ...(shard ? [`shard ${shard.index}/${shard.total}`] : [])];
const deadlineAt = Date.now() + 20 * 60 * 1000;
const runPhase = (args) => new Promise((fulfill) => {
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let truncated = false; let settled = false; let timeout = false;
  const finish = (exitCode, signal, error) => { if (settled) return; settled = true; clearTimeout(deadline); fulfill({ stdout, stderr, truncated, timeout, exitCode, signal, error }); };
  const capture = (current, chunk) => { if (current.length + chunk.length > 16 * 1024 * 1024) { truncated = true; return current; } return current + chunk; };
  child.stdout.on('data', data => { stdout = capture(stdout, data.toString()); });
  child.stderr.on('data', data => { stderr = capture(stderr, data.toString()); });
  child.once('error', error => finish(null, null, error.message)); child.once('close', (code, signal) => finish(code, signal));
  const deadline = setTimeout(() => { timeout = true; child.kill(); }, Math.max(0, deadlineAt - Date.now()));
});
const results = [];
for (const phase of phases) { await rm(phase.timings, { force: true }); results.push(await runPhase(phase.command)); }
const outcome = {
  stdout: results.map(result => result.stdout).join('\n'), stderr: results.map(result => result.stderr).join('\n'),
  truncated: results.some(result => result.truncated), timeout: results.some(result => result.timeout),
  exitCode: results.find(result => result.exitCode !== 0)?.exitCode ?? 0, signal: results.find(result => result.signal)?.signal ?? null,
  error: results.find(result => result.error)?.error,
};
// Counts come from each run's own TAP summary and are added together.
const counts = {};
for (const name of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
  const each = results.map(result => { const matches = [...result.stdout.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, 'gm'))]; return matches.length ? Number(matches.at(-1)[1]) : null; });
  counts[name] = each.every(value => value !== null) ? each.reduce((sum, value) => sum + value, 0) : null;
}
const hasSummary = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].every(name => Number.isSafeInteger(counts[name]));
const fileTimings = {}; const rows = [];
for (const phase of phases) {
  const text = await readFile(phase.timings, 'utf8').catch(() => '');
  for (const line of text.split('\n').filter(Boolean)) {
    const { file, ms } = JSON.parse(line);
    fileTimings[inRepository(file)] = Math.round(ms) / 1000;
  }
  rows.push(...nodeTimingRows(text, inRepository));
  await rm(phase.timings, { force: true });
}
const passed = outcome.exitCode === 0 && hasSummary && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0 && !outcome.timeout && !outcome.truncated;
// D11: the common receipt part (scripts/receipt.mjs: format, tool, files, totals) beside the bench's own fields.
const common = testReceipt({ tool: 'engine-tests', startedAt, finishedAt: new Date().toISOString(), shard, files: rows });
const report = {
  schema: 'chausar.factory-bench.v1', ...common, nodeVersion: process.version,
  command: ['node', ...command], scope: scopeParts.length ? `Repository open tests (${scopeParts.join(', ')})` : 'Repository open tests', counts, passed,
  tier, isolation, isolatedCommand: isolatedCommand ? ['node', ...isolatedCommand] : null, fullSuite, workers, tempFreeBytes, testFiles, fileTimings,
  exitCode: outcome.exitCode, signal: outcome.signal ?? null, timeout: outcome.timeout, outputTruncated: outcome.truncated,
  productionQualified: false,
  qualification: { openTests: passed ? 'passed' : 'failed', testRunComplete: hasSummary && counts.skipped === 0 && counts.todo === 0, specificationCoverageCertified: false, hiddenBusinessAcceptance: 'not-run', sealedBusinessAcceptance: 'not-run', releaseSigning: 'not-run', realConnectorQualification: 'not-run' },
  ...(outcome.error ? { runnerError: outcome.error } : {}),
  stdout: outcome.stdout, stderr: outcome.stderr,
};
await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ passed, counts, report: destination.replaceAll('\\', '/'), shard, fullSuite, productionQualified: false })}\n`);
process.exitCode = passed ? 0 : 1;
