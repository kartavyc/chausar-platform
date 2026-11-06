#!/usr/bin/env node
// D11e: a captured run, checked or compared. Developer-only; captures are made on sample businesses.
//   --check              reads the capture, checks its format and label, scans it again for secrets, and prints what
//                        it holds (model calls by purpose, driver lines, fetches, clock readings, records).
//   --records <file>     compares the capture's records with the records a replay made (a JSON list), after ids, times
//                        and digests are named by first appearance; one line per difference, exit 1 when any differ.
// With no mode, run the recorded engine request in a fresh sample vault, with captured IO only.
// Usage: node scripts/replay-run.mjs <capture.json> --check | --records <records.json>
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/replay-run.mjs <capture.json> --check | --records <records.json>';
const [file, mode, other, ...rest] = process.argv.slice(2);
if (!file || rest.length || !((!mode && !other) || (mode === '--check' && !other) || (mode === '--records' && other))) { process.stderr.write(`${usage}\n`); process.exit(2); }

const { readRunCapture, diffRecords } = await import(pathToFileURL(join(root, 'platform/runtime/venture/replay/replay-run.ts')).href);
const { secretFindings } = await import(pathToFileURL(join(root, 'platform/runtime/venture/core/secrets.ts')).href);
try {
  const text = await readFile(resolve(file), 'utf8');
  const found = secretFindings(text);
  if (found.length) throw new Error(`The capture holds a secret (${[...new Set(found)].join(', ')}); delete it and capture again.`);
  const capture = readRunCapture(JSON.parse(text));
  if (mode === '--check') {
    const count = kind => capture.events.filter(event => event.kind === kind).length;
    const purposes = [...new Set(capture.events.filter(event => event.kind === 'model').map(event => event.purpose))];
    process.stdout.write(`${capture.format}, captured ${capture.capturedAt}: ${count('model')} model calls (${purposes.join(', ') || 'none'}), ${count('driver')} driver lines, ${count('fetch')} fetches, ${count('clock')} clock readings, ${capture.records.length} records.\n`);
  } else if (!mode) {
    const { replayEngineRun } = await import(pathToFileURL(join(root, 'platform/runtime/venture/replay/engine-run.ts')).href);
    const { differences } = await replayEngineRun(capture);
    if (differences.length) { process.stdout.write(differences.join('\n') + '\n'); process.exitCode = 1; }
    else process.stdout.write('The replayed engine records match the capture.\n');
  } else {
    const replayed = JSON.parse(await readFile(resolve(other), 'utf8'));
    if (!Array.isArray(replayed)) throw new Error(`${other} is not a JSON list of records.`);
    const lines = diffRecords(capture.records, replayed);
    if (lines.length) { process.stdout.write(`${lines.length} difference${lines.length === 1 ? '' : 's'}:\n${lines.map(line => `  ${line}`).join('\n')}\n`); process.exitCode = 1; }
    else process.stdout.write('The replayed records match the capture.\n');
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
