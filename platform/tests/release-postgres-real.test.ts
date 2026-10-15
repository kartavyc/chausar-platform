import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { verifyBundledPostgres } from '../../scripts/release/verify-postgres-linux.ts';

/*
 * Real-binary run of BundledPostgres. Offline by default: it runs only when CHAUSAR_REAL_POSTGRES_RUNTIME names a
 * staged runtime root (node scripts/release/stage-runtime.ts --platform linux --arch x64 --out <dir>), and adds the
 * upgrade path when CHAUSAR_REAL_POSTGRES_OLD_BIN names an older major's bin folder (for example
 * /usr/lib/postgresql/16/bin), or CHAUSAR_REAL_POSTGRES_OLD_RUNTIME names a staged retained runtime (for example
 * <runtime>/postgres-16, staged from the postgres-16 pin with its bin, lib and share). PostgreSQL refuses to run as
 * root, so as root this test is skipped; run it as an ordinary account, for example `runuser -u postgres -- node --test platform/tests/release-postgres-real.test.ts`.
 */

const runtimeRoot = process.env.CHAUSAR_REAL_POSTGRES_RUNTIME?.trim() || '';
const oldBin = process.env.CHAUSAR_REAL_POSTGRES_OLD_BIN?.trim() || null;
const oldRuntime = process.env.CHAUSAR_REAL_POSTGRES_OLD_RUNTIME?.trim() || null;
const skip = !runtimeRoot ? 'set CHAUSAR_REAL_POSTGRES_RUNTIME to a staged runtime root to run the real PostgreSQL checks'
  : process.platform !== 'linux' ? 'the real PostgreSQL checks run on Linux'
  : process.getuid?.() === 0 ? 'PostgreSQL refuses to run as root; run this test as an ordinary account (runuser -u <name> -- node --test ...)'
  : false;

test('real bundled PostgreSQL: initdb, start, select 1, stop, port reuse, foreign lock, kill -9 recovery, newer data and upgrade', { skip, timeout: 600_000 }, async () => {
  assert.ok(isAbsolute(runtimeRoot), 'CHAUSAR_REAL_POSTGRES_RUNTIME must be an absolute path');
  assert.ok(oldBin === null || isAbsolute(oldBin), 'CHAUSAR_REAL_POSTGRES_OLD_BIN must be an absolute path');
  assert.ok(oldRuntime === null || (isAbsolute(oldRuntime) && oldBin === null), 'CHAUSAR_REAL_POSTGRES_OLD_RUNTIME must be an absolute path, used instead of the old bin folder');
  const receipt = await verifyBundledPostgres({ runtimeRoot, oldBin, oldRuntime, portRange: [56600, 56699] });
  const failed = receipt.steps.filter(step => !step.ok).map(step => `${step.name}: ${step.error}`);
  assert.deepEqual(failed, [], failed.join('\n'));
  const names = receipt.steps.map(step => step.name);
  const expected = ['unprivileged-account', 'initdb-start-select-1', 'foreign-lock-refused', 'orderly-stop', 'restart-reuses-port', 'crash-recovery-kill-9', 'crash-recovery-busy-backend', 'stop-after-recovery', 'newer-data-refused'];
  assert.deepEqual(names, oldBin || oldRuntime ? [...expected, 'upgrade-prepare-old-cluster', 'upgrade-refusals', 'upgrade-with-vault-copy'] : expected);
  const detail = (name: string) => receipt.steps.find(step => step.name === name)?.detail ?? {};
  assert.equal(detail('crash-recovery-kill-9').walReplayLogged, true, 'the restart after kill -9 replayed WAL');
  assert.equal(detail('crash-recovery-kill-9').rowsAfterRecovery, 1001, 'committed rows survive the kill');
  assert.equal(detail('restart-reuses-port').port, detail('initdb-start-select-1').port);
  assert.equal(detail('foreign-lock-refused').refusal, 'POSTGRES_DATA_IN_USE');
  assert.equal(detail('newer-data-refused').refusal, 'POSTGRES_DATA_NEWER');
  assert.ok((detail('crash-recovery-busy-backend').titledWithClusterName as unknown[]).length > 0, 'orphaned backends carry the cluster name in their titles');
  if (oldBin || oldRuntime) {
    const upgrade = detail('upgrade-with-vault-copy');
    assert.equal(upgrade.link, false);
    assert.equal(upgrade.rows, 500);
    assert.equal(upgrade.retainedPgVersion, upgrade.from);
    assert.deepEqual(upgrade.dataRootEntries, ['chausar-cluster.json', 'cluster', `cluster.pre-${upgrade.to}`, 'database-password']);
  }
  assert.equal(receipt.ok, true);
});
