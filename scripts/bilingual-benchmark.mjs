import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { runBilingualBenchmark } from '../platform/benchmarks/bilingual/runner.ts';
import { outputFile } from '../platform/runtime/run-root.mjs';

const args = process.argv.slice(2);
let requestedOutput;
if (args.length === 2 && args[0] === '--output') requestedOutput = args[1];
else if (args.length === 1 && args[0].startsWith('--output=')) requestedOutput = args[0].slice(9);
else if (args.length) throw new Error('Usage: node scripts/bilingual-benchmark.mjs [--output <file.json>]');
// D3: the report goes to the run root (<root>/bilingual-benchmark/bilingual-benchmark.json) or any .json path outside
// the checkout, checked before anything is created; the check follows an existing link to where it really leads.
const destination = outputFile(requestedOutput, { name: 'bilingual-benchmark', file: 'bilingual-benchmark.json' });
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
  semanticRunSha256: report.fingerprints.semanticRunSha256, report: destination.replaceAll('\\', '/'), modelDispatches: 0, productionQualified: false }) + '\n');
process.exitCode = report.passed ? 0 : 1;
