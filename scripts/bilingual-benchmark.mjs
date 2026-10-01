import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
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
const scratchRoot = resolve(root, 'test-results', 'bilingual-benchmark-scratch');
let scratchAncestor = dirname(scratchRoot);
for (;;) {
  try { scratchAncestor = await realpath(scratchAncestor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; const parent = dirname(scratchAncestor); if (parent === scratchAncestor) throw error; scratchAncestor = parent; }
}
const scratchAncestry = relative(root, scratchAncestor);
if (isAbsolute(scratchAncestry) || scratchAncestry === '..' || scratchAncestry.startsWith('..' + sep)) throw new Error('Benchmark scratch ancestry escapes this source copy.');
await mkdir(scratchRoot, { recursive: true });
const actualScratch = await realpath(scratchRoot), scratchChild = relative(root, actualScratch);
if (!scratchChild || isAbsolute(scratchChild) || scratchChild === '..' || scratchChild.startsWith('..' + sep)) throw new Error('Benchmark scratch escapes this source copy.');
const report = await runBilingualBenchmark({ scratchRoot: actualScratch });
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ passed: report.passed, score: report.score, byLanguage: report.byLanguage, byTrack: report.byTrack,
  semanticRunSha256: report.fingerprints.semanticRunSha256, report: child.replaceAll('\\', '/'), modelDispatches: 0, productionQualified: false }) + '\n');
process.exitCode = report.passed ? 0 : 1;
