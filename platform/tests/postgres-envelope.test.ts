import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../runtime/vault.ts';
import { PostgresSnapshotAdapter, type PostgresPool } from '../runtime/postgres.ts';

// A protocol fixture, never native PostgreSQL evidence: PostgreSQL JSONB does
// not preserve object insertion order. The actual hard gate independently
// exercises server storage, reopening and authenticated encrypted backups.
function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => [key, jsonbOrder(child)]));
  return value;
}
function protocolFixture() {
  let envelope: any;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT revision, envelope')) return { rows: envelope ? [{ revision: String(envelope.revision), envelope: jsonbOrder(envelope) }] : [] };
    if (sql.startsWith('SELECT revision FROM')) return { rows: envelope ? [{ revision: String(envelope.revision) }] : [] };
    if (/^(INSERT INTO|UPDATE) public\.chausar_vault_authority/.test(sql)) envelope = JSON.parse(String(values![2]));
    return { rows: [] };
  };
  const pool: PostgresPool = { query, async connect() { return { query, release() {} }; }, async end() {} };
  return { pool, current: () => envelope };
}
const credential = 'Public synthetic JSONB regression credential';
async function directoryFor(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-postgres-envelope-test-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}

test('PostgreSQL JSONB protocol fixture preserves authenticated vault reopening despite nested key reordering', async t => {
  const directory = await directoryFor(t), fixture = protocolFixture();
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'jsonb-order-fixture');
  const { vault } = await Vault.create({ directory, storage: adapter, passphrase: credential, name: 'Synthetic order regression' });
  t.after(() => vault.close());
  await vault.update(state => { state.activity.push({ message: 'Committed synthetic value' }); });
  assert.deepEqual(Object.keys(fixture.current().passphrase), ['salt', 'kdf', 'ciphertext']);
  assert.deepEqual(Object.keys(jsonbOrder(fixture.current()).passphrase), ['kdf', 'salt', 'ciphertext']);
  await vault.close();
  const reopened = await Vault.open({ directory, storage: adapter, passphrase: credential });
  t.after(() => reopened.close());
  assert.equal(reopened.read().revision, 1);
  assert.equal(reopened.read().activity[0].message, 'Committed synthetic value');
  await reopened.close();

  // Recovery metadata is authenticated even when unlocking with the passphrase.
  const tag = fixture.current().recovery.ciphertext.tag;
  fixture.current().recovery.ciphertext.tag = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
  await assert.rejects(Vault.open({ directory, storage: adapter, passphrase: credential }), { code: 'UNLOCK_FAILED' });
});

test('PostgreSQL JSONB normalization refuses unknown authenticated wrapper fields rather than discarding them', async t => {
  const directory = await directoryFor(t), fixture = protocolFixture();
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'jsonb-shape-fixture');
  const { vault } = await Vault.create({ directory, storage: adapter, passphrase: credential, name: 'Synthetic shape regression' });
  t.after(() => vault.close()); await vault.close();
  fixture.current().recovery.extra = 'Unexpected authenticated field';
  await assert.rejects(adapter.load(), { code: 'CORRUPT_VAULT' });
  await assert.rejects(Vault.open({ directory, storage: adapter, passphrase: credential }), { code: 'UNLOCK_FAILED' });
});
