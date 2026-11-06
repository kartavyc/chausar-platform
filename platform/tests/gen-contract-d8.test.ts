import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGenerated, generateContract } from '../../scripts/gen-contract.mjs';

test('generated method artifacts are current and report a missing method by name', async () => {
  assert.deepEqual(await checkGenerated(), []);
  const directory = await mkdtemp(join(tmpdir(), 'chausar-contract-generator-'));
  try {
    await generateContract({ outputRoot: directory });
    const path = join(directory, 'app/desktop/ipc-methods.cjs');
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace('  "workspace.status",\n', ''));
    const differences = await checkGenerated({ outputRoot: directory });
    assert.ok(differences.some(line => line.includes('workspace.status')), differences.join('\n'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
