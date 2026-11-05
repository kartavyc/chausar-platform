// D1: the engine, the desktop shell and the companion run by type stripping, so their TypeScript must be erasable.
// The root tsconfig says so with erasableSyntaxOnly, and tsc then refuses enum and constructor parameter properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));

test('the root tsconfig asks for erasable syntax only', async () => {
  const config = JSON.parse(await readFile(join(repo, 'tsconfig.json'), 'utf8'));
  assert.equal(config.compilerOptions.erasableSyntaxOnly, true);
});

test('a project that extends the root tsconfig refuses enum and parameter properties (TS1294)', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-erasable-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
    extends: join(repo, 'tsconfig.json').replaceAll('\\', '/'),
    compilerOptions: { types: [] },
    include: ['*.ts'],
  }));
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(dir, 'kind.ts'), 'export enum Kind { A }\n');
  await writeFile(join(dir, 'holder.ts'), 'export class Holder {\n  constructor(private x: number) {}\n  get value(): number { return this.x; }\n}\n');
  const result = spawnSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', dir], { encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, output);
  assert.match(output, /kind\.ts.*TS1294/);
  assert.match(output, /holder\.ts.*TS1294/);
});
