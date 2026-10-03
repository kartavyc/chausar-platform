import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Engine} from '../runtime/engine.ts';
import {PostgresSnapshotAdapter, type PostgresOptions} from '../runtime/postgres.ts';
import {Vault} from '../runtime/vault.ts';
import {ChausarError, hash} from '../runtime/contracts.ts';

// Protocol regressions only: no native database, file/Vault opening, password
// derivation or provider. The real native prepared row is independently probed
// by the separate public transfer worker before the same four HTTP refusals.
for (const operation of ['create', 'open', 'recover', 'restore'] as const) {
  test(`ordinary prepared PostgreSQL ${operation} refuses before Vault/credential/backup intake`, async t => {
    const directory = join(tmpdir(), 'chausar-synthetic-preflight-no-files', operation);
    let loads = 0, closes = 0, vaultCalls = 0;
    const adapter = {kind: 'postgres',
      async load() {loads++; throw new ChausarError('POSTGRES_TARGET_NOT_COMMITTED', 'Synthetic prepared authority admission refusal.');},
      async close() {closes++;},
    } as unknown as PostgresSnapshotAdapter;
    t.mock.method(PostgresSnapshotAdapter, 'connect', async (options: PostgresOptions) => {
      assert.equal(options.vaultSlot, hash(join(directory, 'main'))); return adapter;
    });
    t.mock.method(Vault, operation, async () => {vaultCalls++; throw new Error('Vault intake must not occur before ordinary native admission.');});
    const engine = new Engine({directory, storage: 'postgres', postgresUrl: 'postgresql://synthetic:unused@127.0.0.1:35432/synthetic_unopened'});
    const payload = operation === 'create' ? {name: 'Synthetic prepared refusal', pack: 'retail', passphrase: 'Synthetic unused valid credential'}
      : operation === 'recover' ? {passphrase: 'Synthetic unused valid credential', recoveryCode: 'Synthetic unread before admission'}
      : operation === 'restore' ? {folder: 'main', backupFile: 'unread-preflight.backup', passphrase: 'Synthetic unused valid credential'}
      : {passphrase: 'Synthetic unused valid credential'};
    try {
      await assert.rejects(engine.request('workspace.' + operation, payload), {code: 'POSTGRES_TARGET_NOT_COMMITTED'});
      assert.equal(loads, 1); assert.equal(closes, 1); assert.equal(vaultCalls, 0); assert.equal(engine.vault, null);
    } finally {await engine.close();}
    // restore's syntactically valid managed file intentionally does not exist.
    // This proves ordering before file read/decryption, not backup correctness.
  });
}
