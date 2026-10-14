// Rewrites the renderer's laneRefusalCodes (app/ui/src/bridge/client.ts) from the preload's
// laneRefusals lines (app/desktop/preload.cjs), which stay the gate. The sandboxed preload cannot
// import a shared file, so the renderer keeps its own copy; desktop-bridge-error.test.ts checks they agree.
// Usage: node scripts/sync-lane-refusals.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const preload = await readFile(new URL('app/desktop/preload.cjs', root), 'utf8');
const clientUrl = new URL('app/ui/src/bridge/client.ts', root);
const client = await readFile(clientUrl, 'utf8');

const block = preload.slice(preload.indexOf('const laneRefusals = ['));
const codes = [...new Set([...block.slice(0, block.indexOf('];')).matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(match => match[1]))];
if (codes.length === 0) throw new Error('No laneRefusals block found in the preload.');

const lines = []; let line = ' ';
for (const code of codes.map(code => `'${code}',`)) {
  if (line.length + code.length + 1 > 115) { lines.push(line); line = ' '; }
  line += ` ${code}`;
}
lines.push(line);
const body = lines.join('\n').replace(/,$/, '');

const opening = 'export const laneRefusalCodes: readonly string[] = [\n';
const start = client.indexOf(opening);
const end = client.indexOf('\n];', start);
if (start < 0 || end < 0) throw new Error('No laneRefusalCodes list found in the renderer client.');
const next = client.slice(0, start + opening.length) + body + client.slice(end);

if (process.argv.includes('--check')) {
  if (next !== client) { console.error('laneRefusalCodes is out of date: run node scripts/sync-lane-refusals.mjs'); process.exit(1); }
  console.log(`laneRefusalCodes matches the preload (${codes.length} codes).`);
} else if (next !== client) {
  await writeFile(clientUrl, next);
  console.log(`laneRefusalCodes rewritten from the preload (${codes.length} codes).`);
} else console.log(`laneRefusalCodes already matches the preload (${codes.length} codes).`);
