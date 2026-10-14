import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const checkout = fileURLToPath(new URL('../../../../', import.meta.url));
const inventoryFile = resolve(checkout, 'app/ui/design-screen-inventory.json');
const generatorFile = resolve(checkout, 'scripts/generate-design-inventory.mjs');
const inputRoot = process.env.UI_DESIGN_INPUTS ? resolve(process.env.UI_DESIGN_INPUTS) : resolve(checkout, 'inputs');
// The design's original markdown sources are not committed; these checks need them.
const sourcesAbsent = existsSync(resolve(inputRoot, 'screens.md')) ? false : 'design markdown sources are not in this checkout; set UI_DESIGN_INPUTS';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function checkFixture(bytes: Buffer) {
  const temporaryRoot = resolve(tmpdir());
  const fixture = mkdtempSync(join(temporaryRoot, 'chausar-inventory-qualification-'));
  try {
    const generator = join(fixture, 'scripts/generate-design-inventory.mjs');
    const inventory = join(fixture, 'app/ui/design-screen-inventory.json');
    mkdirSync(dirname(generator), { recursive: true });
    mkdirSync(dirname(inventory), { recursive: true });
    copyFileSync(generatorFile, generator);
    writeFileSync(inventory, bytes);
    return spawnSync(process.execPath, [generator, '--check'], {
      cwd: fixture,
      env: { ...process.env, UI_DESIGN_INPUTS: inputRoot },
      encoding: 'utf8',
      windowsHide: true,
    });
  } finally {
    const within = relative(temporaryRoot, resolve(fixture));
    assert.ok(within.startsWith('chausar-inventory-qualification-') && !within.includes(sep) && !isAbsolute(within), 'cleanup stays in the created temporary fixture');
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('canonical LF inventory passes the unchanged generator raw-byte check', { skip: sourcesAbsent }, () => {
  const bytes = readFileSync(inventoryFile);
  const text = bytes.toString('utf8');
  assert.equal(text.includes('\r'), false, 'the qualified source is canonical LF');
  assert.equal(text.endsWith('\n'), true);
  const result = checkFixture(bytes);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches all four source documents/);
});

test('CRLF is exactly equivalent after LF normalization, but still fails the unchanged raw-byte check', { skip: sourcesAbsent }, () => {
  const canonical = readFileSync(inventoryFile);
  const crlf = Buffer.from(canonical.toString('utf8').replaceAll('\n', '\r\n'));
  assert.notEqual(sha256(crlf), sha256(canonical), 'raw identities remain distinct');
  assert.equal(crlf.toString('utf8').replaceAll('\r\n', '\n'), canonical.toString('utf8'));
  assert.deepEqual(JSON.parse(crlf.toString('utf8')), JSON.parse(canonical.toString('utf8')));
  const result = checkFixture(crlf);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, 'the checker was not weakened to normalize input');
  assert.match(result.stderr, /Design inventory is stale/);
});

test('a semantic mutation with canonical LF also fails the unchanged generator', { skip: sourcesAbsent }, () => {
  const inventory: { authority: string } = JSON.parse(readFileSync(inventoryFile, 'utf8'));
  inventory.authority = 'synthetic-unapproved-authority';
  const mutated = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`);
  const result = checkFixture(mutated);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Design inventory is stale/);
});
