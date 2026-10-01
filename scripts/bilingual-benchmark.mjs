import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runBilingualBenchmark } from '../platform/benchmarks/bilingual/runner.ts';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
let requestedOutput = 'results/bilingual-benchmark.json';
if (args.length === 2 && args[0] === '--output') requestedOutput = args[1];
else if (args.length === 1 && args[0].startsWith('--output=')) requestedOutput = args[0].slice(9);
else if (args.length) throw new Error('Usage: node scripts/bilingual-benchmark.mjs [--output results/bilingual-benchmark.json]');
const destination = resolve(root, requestedOutput), child = relative(root, destination);
if (!requestedOutput || isAbsolute(requestedOutput) || !child || isAbsolute(child) || child === '..' || child.startsWith('..' + sep)
  || !child.endsWith('.json') || ['.git', '.agents', '.codex'].includes(child.split(sep)[0].toLowerCase())) throw new Error('Benchmark output must be a relative JSON path inside this source copy.');
// Check the existing destination ancestry before creating directories: an outside symlink is not an owned output directory.
let ancestor = dirname(destination);
for (;;) {
  try { ancestor = await realpath(ancestor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
}
const ancestry = relative(root, ancestor);
if (isAbsolute(ancestry) || ancestry === '..' || ancestry.startsWith('..' + sep)) throw new Error('Benchmark output ancestry escapes this source copy.');
// Source and report paths may be on another drive. Disposable workspaces use the
// existing canonical temporary parent, checked before any directory is created.
const temporaryRoot = await realpath(tmpdir()), scratchPrefix = 'chausar-bilingual-cli-';
if (process.platform === 'win32' && !/^C:[\\/]/i.test(temporaryRoot)) throw new Error('Windows synthetic benchmark scratch must stay on C.');
const scratchRoot = await mkdtemp(join(temporaryRoot, scratchPrefix));
let report;
try {
  report = await runBilingualBenchmark({ scratchRoot });
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
} finally {
  const target = await realpath(scratchRoot), scratchChild = relative(temporaryRoot, target);
  if (target !== resolve(scratchRoot) || dirname(target) !== temporaryRoot || !scratchChild || isAbsolute(scratchChild)
    || scratchChild === '..' || scratchChild.startsWith('..' + sep) || scratchChild.includes(sep) || !basename(target).startsWith(scratchPrefix)) {
    throw new Error('Refusing cleanup outside the exact owned synthetic temporary parent and prefix.');
  }
  await rm(target, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify({ passed: report.passed, score: report.score, byLanguage: report.byLanguage, byTrack: report.byTrack,
  semanticRunSha256: report.fingerprints.semanticRunSha256, report: child.replaceAll('\\', '/'), modelDispatches: 0, productionQualified: false }) + '\n');
process.exitCode = report.passed ? 0 : 1;
