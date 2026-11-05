// D11a task 8: one place for each flag. platform/runtime/config/env.ts lists every CHAUSAR_* name the code reads (its
// meaning, default and readers); scripts/env-docs.mjs writes .env.example (the ones someone running Chausar from source
// sets) and docs/configuration.md (all of them), and --check fails when either is stale or when source names a
// CHAUSAR_* variable the list lacks.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, ENV_READERS, NOT_ENV } from '../runtime/config/env.ts';

const SCRIPT = fileURLToPath(new URL('../../scripts/env-docs.mjs', import.meta.url));

test('every entry has a name, a meaning, a default and readers; names are unique and sorted', () => {
  assert.ok(ENV.length >= 60, `${ENV.length} entries`);
  const names = ENV.map(entry => entry.name);
  assert.deepEqual(names, [...names].sort(), 'sorted by name');
  assert.equal(new Set(names).size, names.length, 'unique');
  for (const entry of ENV) {
    assert.match(entry.name, /^CHAUSAR_[A-Z0-9]+(?:_[A-Z0-9]+)*$/, entry.name);
    assert.ok(entry.meaning.length > 10 && !/—/.test(entry.meaning), `${entry.name}: meaning`);
    assert.equal(typeof entry.default, 'string', `${entry.name}: default`);
    assert.ok(entry.readers.length > 0 && entry.readers.every(reader => ENV_READERS.includes(reader)), `${entry.name}: readers`);
  }
  for (const name of NOT_ENV) assert.equal(names.includes(name), false, `${name} is a code constant, not a variable`);
});

test('the real tree is clean: every CHAUSAR_* name in source is listed, and both generated files are current', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

async function tree(t: TestContext, extra: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-env-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const copy = async (path: string, text?: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text ?? await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
  };
  for (const path of ['scripts/env-docs.mjs', 'platform/runtime/config/env.ts']) await copy(path);
  for (const [path, text] of Object.entries(extra)) await copy(path, text);
  return (...args: string[]) => spawnSync(process.execPath, [join(root, 'scripts', 'env-docs.mjs'), ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
}

test('a source file that reads an unlisted CHAUSAR_* name fails the check by name; tests and code constants do not count', async t => {
  const run = await tree(t, {
    'platform/runtime/new-flag.ts': "export const on = process.env.CHAUSAR_SHINY_NEW === '1';\nexport const known = process.env.CHAUSAR_PORT;\n",
    'app/desktop/also.cjs': "const x = env['CHAUSAR_OTHER_NEW'];\n",
    'platform/tests/reads.test.ts': "process.env.CHAUSAR_ONLY_IN_TESTS = '1';\n",
    'platform/runtime/ua.ts': "export const CHAUSAR_USER_AGENT = 'Chausar';\n",
  });
  assert.equal(run('--write').status, 0, 'writes the two files');
  const result = run('--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHAUSAR_SHINY_NEW \(platform\/runtime\/new-flag\.ts\)/);
  assert.match(result.stderr, /CHAUSAR_OTHER_NEW \(app\/desktop\/also\.cjs\)/);
  assert.doesNotMatch(result.stderr, /CHAUSAR_ONLY_IN_TESTS|CHAUSAR_USER_AGENT|CHAUSAR_PORT/);
});

test('a stale or missing generated file fails the check, and --write makes it current', async t => {
  const run = await tree(t, {});
  const missing = run('--check');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /\.env\.example is not current/);
  assert.match(missing.stderr, /docs\/configuration\.md is not current/);
  assert.equal(run('--write').status, 0);
  assert.equal(run('--check').status, 0);
  assert.equal(run().status, 2, 'no mode: usage');
});

test('the generated files: .env.example holds only the from-source names with no secret value, the docs every name', async () => {
  const example = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  const docs = await readFile(new URL('../../docs/configuration.md', import.meta.url), 'utf8');
  for (const entry of ENV) {
    assert.ok(docs.includes(`\`${entry.name}\``), `docs name ${entry.name}`);
    assert.equal(new RegExp(`^${entry.name}=`, 'm').test(example), Boolean(entry.example), `.env.example and ${entry.name}`);
    if (entry.secret && entry.example) assert.match(example, new RegExp(`^${entry.name}=\\r?$`, 'm'), `${entry.name} is a secret: no value`);
  }
  assert.doesNotMatch(docs, /—/);
});

test('the CI lint job runs the check', async () => {
  const workflow = (await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(workflow, /^ {8}run: node scripts\/env-docs\.mjs --check$/m);
});
