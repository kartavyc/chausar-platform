// D1: Biome is the one formatter (W6-ALL-IDEAS section 7). This batch adds it and its settings; the one whole-repo
// formatting commit and the lint job's format check come last, on the final tip, so they cannot conflict with the stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const config = JSON.parse(await readFile(new URL('../../biome.json', import.meta.url), 'utf8').catch(() => '{}'));

test('Biome is pinned, and the format scripts call it', () => {
  assert.match(pkg.devDependencies['@biomejs/biome'] ?? '', /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.scripts.format, 'biome format --write');
  assert.equal(pkg.scripts['format:check'], 'biome format');
});

test('biome.json formats code only: the house style, no linter, and never JSON or fixtures (some are byte for byte)', () => {
  assert.equal(config.formatter?.enabled, true);
  assert.equal(config.formatter.indentStyle, 'space');
  assert.equal(config.formatter.indentWidth, 2);
  assert.equal(config.javascript?.formatter?.quoteStyle, 'single');
  assert.equal(config.javascript.formatter.semicolons, 'always');
  assert.equal(config.linter?.enabled, false, 'knip and the tests are the checks; Biome only formats');
  assert.equal(config.json?.formatter?.enabled, false);
  assert.equal(config.css?.formatter?.enabled, false, 'CSS stays as the design tokens are written');
  assert.ok(config.files?.includes?.includes('!**/fixtures'));
  assert.equal(config.vcs?.useIgnoreFile, true, 'git-ignored output (results, data, dist) is never formatted');
});

test('the pinned Biome formats a sample with these settings', () => {
  const bin = fileURLToPath(new URL('../../node_modules/@biomejs/biome/bin/biome', import.meta.url));
  const result = spawnSync(process.execPath, [bin, 'format', '--stdin-file-path=sample.ts'], {
    cwd: repo, encoding: 'utf8', input: 'const a = {b: "c", d: [1,2]}\nexport function f(x: number) { return (y: number) => x + y + a.d.length }\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.replace(/\r\n/g, '\n'), "const a = { b: 'c', d: [1, 2] };\nexport function f(x: number) {\n  return (y: number) => x + y + a.d.length;\n}\n");
});
