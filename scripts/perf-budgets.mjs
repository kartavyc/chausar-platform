// D2 (IDEAS 18): performance budgets, checked nightly. Measures what exists today, compares each number with its budget
// in platform/tests/baselines/perf-budgets.json plus its tolerance, writes a receipt and exits 1 when a measure is over.
// It never writes a number it did not measure: an entry it cannot measure yet is reported as "not measured" with what it
// waits on, and an entry with no budget yet records the number and a suggested first budget (the number plus 15%).
//
// Usage (from the repo root): node scripts/perf-budgets.mjs [--budgets <file>] [--tiers <file>] [--timings <folder>]
//   [--output results/perf-budgets.json]
// --timings is a folder of bench receipts (searched below it); their fileTimings feed the slow-file check.
// CHAUSAR_PERF_STAND_IN (read by this script only) names a JSON file of stand-in values, so its test runs no measure.
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/perf-budgets.mjs [--budgets <file>] [--tiers <file>] [--timings <folder>] [--output <file.json>]';
const options = { budgets: 'platform/tests/baselines/perf-budgets.json', tiers: 'platform/tests/tiers.json', timings: null, output: 'results/perf-budgets.json' };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const name = args[index].replace(/^--/, '').split('=', 1)[0];
  if (!args[index].startsWith('--') || !(name in options)) throw new Error(usage);
  const value = args[index].includes('=') ? args[index].slice(name.length + 3) : args[++index];
  if (!value || value.startsWith('--')) throw new Error(usage);
  options[name] = value;
}
if (!options.output.endsWith('.json')) throw new Error('The perf receipt must be a .json file.');

const SLOW_FILE_SECONDS = 30;
const standIn = process.env.CHAUSAR_PERF_STAND_IN ? JSON.parse(await readFile(process.env.CHAUSAR_PERF_STAND_IN, 'utf8')) : null;
const median = values => values.slice().sort((left, right) => left - right)[Math.floor(values.length / 2)];

/** Each measure gives { value } or { reason } (why it could not measure now). */
const MEASURES = {
  // Median of five fresh processes, each timing its own import of the engine's server module (source today; D7 swaps
  // in the bundle and lowers the budget).
  'engine-cold-import-ms': async () => {
    const times = [];
    for (let run = 0; run < 5; run++) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        "const started = performance.now(); await import('./platform/runtime/server.ts'); console.log(performance.now() - started);"],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
      if (result.status !== 0) return { reason: `the import failed: ${(result.stderr || '').trim().split('\n').at(-1)}` };
      times.push(Number(result.stdout.trim().split('\n').at(-1)));
    }
    return { value: Math.round(median(times)) };
  },
  // The largest index-*.js in the built UI (D9 lowers it after the split).
  'ui-entry-chunk-bytes': async () => {
    const assets = join(root, 'app/ui/dist/assets');
    const names = await readdir(assets).catch(() => null);
    if (!names) return { reason: 'app/ui/dist is missing: run npm run build:ui first' };
    const sizes = await Promise.all(names.filter(name => /^index-.*\.js$/.test(name)).map(async name => (await stat(join(assets, name))).size));
    return sizes.length ? { value: Math.max(...sizes) } : { reason: 'the build has no index-*.js entry chunk' };
  },
  'vault-commit-ms-1k': async () => vaultCommit(1_000),
  'vault-commit-ms-10k': async () => vaultCommit(10_000),
};

/** One commit of a state already holding `records` synthetic activity records, through vault.ts, in a fresh temp folder. */
async function vaultCommit(records) {
  const { Vault } = await import(pathToFileURL(join(root, 'platform/runtime/vault.ts')).href);
  const directory = await mkdtemp(join(tmpdir(), 'chausar-perf-vault-'));
  try {
    const { vault } = await Vault.create({ directory, storage: 'experimental-file', passphrase: 'synthetic perf passphrase only', name: 'Perf budget' });
    await vault.update(state => { for (let index = 0; index < records; index++) state.activity.push({ message: `synthetic record ${index} for the commit budget` }); });
    const times = [];
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      await vault.update(state => { state.activity.push({ message: `one more synthetic record ${run}` }); });
      times.push(performance.now() - started);
    }
    await vault.close();
    return { value: Math.round(median(times)) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function receiptsBelow(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await receiptsBelow(path));
    else if (entry.name.endsWith('.json')) found.push(path);
  }
  return found;
}

/** Any engine test file over 30 s in the newest receipts that is not in the heavy tier fails by name. */
async function slowFiles() {
  if (!options.timings) return { reason: 'no engine receipts were given (--timings)' };
  const timings = {};
  for (const path of await receiptsBelow(resolve(root, options.timings))) {
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    if (receipt?.schema === 'chausar.factory-bench.v1' && receipt.fileTimings) Object.assign(timings, receipt.fileTimings);
  }
  if (!Object.keys(timings).length) return { reason: 'the engine receipts hold no fileTimings' };
  const heavy = new Set(JSON.parse(await readFile(resolve(root, options.tiers), 'utf8')).heavy ?? []);
  const files = Object.keys(timings).filter(file => timings[file] > SLOW_FILE_SECONDS && !heavy.has(file)).sort();
  return { value: files.length, files, seconds: Object.fromEntries(files.map(file => [file, timings[file]])) };
}

const budgets = JSON.parse(await readFile(resolve(root, options.budgets), 'utf8'));
for (const name of Object.keys(budgets)) {
  if (!(name in MEASURES) && name !== 'slow-test-files' && budgets[name].measured !== false) {
    process.stderr.write(`${name} is not a measure perf-budgets.mjs knows.\n`);
    process.exit(2);
  }
}

const entries = [];
for (const [name, spec] of Object.entries(budgets)) {
  const { budget = null, unit, tolerancePercent = 15 } = spec;
  if (spec.measured === false) {
    entries.push({ name, status: 'not-measured', value: null, budget: null, limit: null, unit, reason: `waits on ${spec.waitsOn}` });
    continue;
  }
  const measured = name === 'slow-test-files' ? await slowFiles()
    : standIn ? (name in standIn ? { value: standIn[name] } : { reason: 'no stand-in value' }) : await MEASURES[name]();
  if (!('value' in measured)) { entries.push({ name, status: 'not-measured', value: null, budget, limit: null, unit, reason: measured.reason }); continue; }
  const extra = measured.files ? { files: measured.files, seconds: measured.seconds } : {};
  if (budget === null) {
    entries.push({ name, status: 'no-budget', value: measured.value, budget: null, limit: null, unit, suggestedBudget: Math.ceil(measured.value * 1.15), ...extra });
    continue;
  }
  const limit = Math.floor(budget * (100 + tolerancePercent) / 100);
  entries.push({ name, status: measured.value <= limit ? 'pass' : 'over', value: measured.value, budget, limit, unit, ...extra });
}

for (const entry of entries) {
  if (entry.status === 'not-measured') console.log(`${entry.name}: not measured (${entry.reason})`);
  else if (entry.status === 'no-budget') console.log(`${entry.name}: ${entry.value} ${entry.unit}, no budget yet (suggested first budget ${entry.suggestedBudget} ${entry.unit})`);
  else if (entry.name === 'slow-test-files') {
    if (entry.status === 'pass') console.log('slow-test-files: no file over 30 s outside the heavy tier');
    for (const file of entry.files ?? []) console.log(`${file} takes ${entry.seconds[file]} s and is not in the heavy tier (platform/tests/tiers.json)`);
  } else if (entry.status === 'over') {
    const tolerance = budgets[entry.name].tolerancePercent ?? 15;
    console.log(`${entry.name}: ${entry.value} ${entry.unit} is over its budget of ${entry.budget} ${entry.unit} plus ${tolerance}% (${entry.limit} ${entry.unit})`);
  } else console.log(`${entry.name}: ${entry.value} ${entry.unit}, within ${entry.limit} ${entry.unit}`);
}

const vaultSource = await readFile(join(root, 'platform/runtime/vault.ts'), 'utf8').catch(() => '');
const passed = entries.every(entry => entry.status !== 'over');
const receipt = { schema: 'chausar.perf-budgets.v1', at: new Date().toISOString(), nodeVersion: process.version, platform: process.platform,
  architecture: process.arch, standIn: Boolean(standIn), entries, passed,
  notes: { vaultSnapshotCeiling: /const MAX_BYTES = ([^;]+);/.exec(vaultSource)?.[1] ?? 'not found' } };
const destination = resolve(root, options.output);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
process.exitCode = passed ? 0 : 1;
