// D11a task 9: platform/runtime/README.md is the map of the engine. Rule: every top-level folder of platform/runtime and
// of platform/runtime/venture is named in it (as `name/`), and it names the entry points, the boundary rule and where
// the flags live. A new folder without a line in the map fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const folders = (path: string) => readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const readme = () => readFileSync(new URL('../runtime/README.md', import.meta.url), 'utf8');

test('every top-level folder of platform/runtime and platform/runtime/venture is named in the map', () => {
  const text = readme();
  const missing = [...folders(runtime).map(name => `\`${name}/\``), ...folders(`${runtime}venture`).map(name => `\`venture/${name}/\``)].filter(name => !text.includes(name));
  assert.deepEqual(missing, []);
});

test('the map names the entry points, the boundary rule, where flags live and how a method is added', () => {
  const text = readme();
  for (const needle of ['`worker.ts`', '`server.ts`', '`hosted/server.ts`', 'scripts/check-boundaries.mjs', '`config/env.ts`', 'scripts/env-docs.mjs', '## Adding a method']) assert.ok(text.includes(needle), needle);
  assert.doesNotMatch(text, /—/);
});
