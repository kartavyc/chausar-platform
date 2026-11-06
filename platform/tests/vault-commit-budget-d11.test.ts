import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runRoot } from '../runtime/run-root.mjs';

test('the vault budget curve measures five real opens, one-field commits and closes at every size', { timeout: 180_000 }, async () => {
  const { measureVaultCurve } = await import('../../scripts/vault-budget.ts');
  const curve = await measureVaultCurve();
  assert.deepEqual(curve.rows.map(row => row.records), [1_000, 10_000, 50_000]);
  assert.equal(curve.runs, 5);
  for (const row of curve.rows) {
    assert.equal(row.samples.length, 5);
    for (const metric of ['openMs', 'commitMs', 'closeMs'] as const) {
      assert.ok(row.median[metric] > 0);
      assert.ok(row.samples.every(sample => sample[metric] > 0));
    }
  }
  const directory = runRoot('vault-budget'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'curve.json'), JSON.stringify(curve, null, 2) + '\n');
});
