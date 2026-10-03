import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { PostgresSnapshotAdapter, type PostgresOptions, type PostgresPool } from '../runtime/postgres.ts';
import type { KeychainHook, VaultEnvelope } from '../runtime/vault.ts';

const passphrase = 'Public synthetic Engine protocol passphrase';
const postgresUrl = 'postgresql://synthetic:public-synthetic-password@127.0.0.1:15432/synthetic';
type Row = { revision: number; envelope: VaultEnvelope };
type Event = { transaction: number; kind: 'BEGIN' | 'LOCK' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'COMMIT' | 'ROLLBACK' | 'RELEASE'; slot?: string };

/** Synthetic SQL protocol only. A transaction publishes its row map at COMMIT;
 * it never starts PostgreSQL or substitutes a Vault/Engine deletion hook. */
function protocolPool() {
  let rows = new Map<string, Row>(), nextTransaction = 0;
  const events: Event[] = [];
  let deleteCommitFailure: Error | undefined;
  const result = (row?: Row) => ({ rows: row ? [{ revision: String(row.revision), envelope: structuredClone(row.envelope) }] : [] });
  const pool: PostgresPool = {
    async query(sql, values) {
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS public.chausar_vault_authority')) return { rows: [] };
      assert.equal(sql, 'SELECT revision, envelope FROM public.chausar_vault_authority WHERE slot = $1');
      return result(rows.get(String(values![0])));
    },
    async connect() {
      const transaction = ++nextTransaction;
      let draft: Map<string, Row> | undefined, deletedSlot: string | undefined;
      return {
        async query(sql, values) {
          if (sql === 'BEGIN') {
            assert.equal(draft, undefined); draft = structuredClone(rows);
            events.push({ transaction, kind: 'BEGIN' }); return { rows: [] };
          }
          assert.ok(draft, 'Protocol writes require a transaction.');
          if (sql === 'SELECT pg_advisory_xact_lock(hashtext($1))') {
            assert.match(String(values![0]), /^chausar-vault:[a-f0-9]{64}$/);
            events.push({ transaction, kind: 'LOCK' }); return { rows: [] };
          }
          if (sql === 'COMMIT') {
            events.push({ transaction, kind: 'COMMIT', ...(deletedSlot ? { slot: deletedSlot } : {}) });
            if (deletedSlot && deleteCommitFailure) throw deleteCommitFailure;
            rows = draft; draft = undefined; return { rows: [] };
          }
          if (sql === 'ROLLBACK') {
            events.push({ transaction, kind: 'ROLLBACK' }); draft = undefined; return { rows: [] };
          }
          const slot = String(values![0]);
          if (sql === 'SELECT revision FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE') {
            events.push({ transaction, kind: 'SELECT', slot }); return result(draft.get(slot));
          }
          if (sql.startsWith('INSERT INTO public.chausar_vault_authority ')) {
            assert.equal(draft.has(slot), false); events.push({ transaction, kind: 'INSERT', slot });
          } else if (sql.startsWith('UPDATE public.chausar_vault_authority ')) {
            assert.equal(draft.get(slot)?.revision, values![3]); events.push({ transaction, kind: 'UPDATE', slot });
          } else if (sql === 'DELETE FROM public.chausar_vault_authority WHERE slot = $1') {
            deletedSlot = slot; draft.delete(slot); events.push({ transaction, kind: 'DELETE', slot }); return { rows: [] };
          } else throw new Error(`Unexpected synthetic protocol statement: ${sql}`);
          draft.set(slot, { revision: Number(values![1]), envelope: JSON.parse(String(values![2])) });
          return { rows: [] };
        },
        release() { assert.equal(draft, undefined); events.push({ transaction, kind: 'RELEASE' }); },
      };
    },
    async end() { throw new Error('The managed synthetic pool must not be closed by fromPool.'); },
  };
  return { pool, events, current: () => structuredClone(rows), failDeleteCommit(error?: Error) { deleteCommitFailure = error; } };
}

/** Retains synthetic keys to exercise actual custody, rather than inferring
 * removal from a counter. Keys never leave this local test double. */
class SyntheticKeychain implements KeychainHook {
  readonly custody = new Map<string, Uint8Array>();
  readonly removals: string[] = [];
  readonly beforeRemove: (vaultId: string) => void;
  constructor(beforeRemove: (vaultId: string) => void = () => {}) { this.beforeRemove = beforeRemove; }
  async store(vaultId: string, key: Uint8Array) {
    assert.equal(key.length, 32); assert.equal(this.custody.has(vaultId), false);
    this.custody.set(vaultId, Uint8Array.from(key));
  }
  async remove(vaultId: string) {
    this.beforeRemove(vaultId);
    const key = this.custody.get(vaultId); assert.ok(key, 'Removal must address actual registered synthetic custody.');
    key.fill(0); this.custody.delete(vaultId); this.removals.push(vaultId);
  }
  clear() { for (const key of this.custody.values()) key.fill(0); this.custody.clear(); }
}

async function fixture(t: TestContext, beforeRemove?: (vaultId: string) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-engine-keychain-postgres-'));
  const protocol = protocolPool(), keychain = new SyntheticKeychain(beforeRemove), engines: Engine[] = [];
  const connections: string[] = [];
  t.mock.method(PostgresSnapshotAdapter, 'connect', async (options: PostgresOptions) => {
    assert.deepEqual({ host: options.host, port: options.port, user: options.user, database: options.database, password: options.password },
      { host: '127.0.0.1', port: 15432, user: 'synthetic', database: 'synthetic', password: 'public-synthetic-password' });
    connections.push(options.vaultSlot);
    return PostgresSnapshotAdapter.fromPool(protocol.pool, options.vaultSlot);
  });
  t.after(async () => {
    try { for (const engine of engines) await engine.close(); }
    finally { keychain.clear(); await rm(directory, { recursive: true, force: true }); }
  });
  const engine = () => {
    const created = new Engine({ directory, storage: 'postgres', postgresUrl, keychain }); engines.push(created); return created;
  };
  return { directory, protocol, keychain, connections, engine };
}

function assertCommittedDeletion(protocol: ReturnType<typeof protocolPool>, slot: string) {
  assert.equal(protocol.current().has(slot), false, 'Committed authority must be absent before custody removal.');
  const last = protocol.events.at(-1)!;
  const transaction = protocol.events.filter(event => event.transaction === last.transaction);
  assert.deepEqual(transaction.map(event => event.kind), ['BEGIN', 'LOCK', 'DELETE', 'COMMIT', 'RELEASE']);
  assert.equal(transaction.find(event => event.kind === 'DELETE')?.slot, slot);
  assert.equal(transaction.find(event => event.kind === 'COMMIT')?.slot, slot);
}

test('Engine PostgreSQL reopen removes registered custody only after the actual adapter DELETE commits', async t => {
  let f: Awaited<ReturnType<typeof fixture>>, expectedId: string, slot: string;
  f = await fixture(t, vaultId => { assert.equal(vaultId, expectedId); assertCommittedDeletion(f.protocol, slot); });
  const initial = f.engine();
  await initial.request('workspace.create', { name: 'Synthetic PostgreSQL custody', passphrase });
  assert.equal(initial.vault!.storageKind, 'postgres'); expectedId = initial.vault!.vaultId; slot = f.connections[0];
  assert.equal(f.protocol.current().get(slot)?.envelope.id, expectedId);
  assert.deepEqual([...f.keychain.custody.keys()], [expectedId]);
  await initial.request('workspace.lock'); assert.equal(f.keychain.custody.has(expectedId), true);
  const reopened = f.engine(); await reopened.request('workspace.open', { passphrase });
  assert.equal(reopened.vault!.vaultId, expectedId); assert.deepEqual(f.connections, [slot, slot]);
  assert.deepEqual(f.keychain.removals, []);
  const result = await reopened.request('workspace.delete', { confirmation: 'Synthetic PostgreSQL custody' });
  assert.equal(result.deleted, true); assert.deepEqual(f.keychain.removals, [expectedId]);
  assert.equal(f.keychain.custody.size, 0); assert.equal(reopened.vault, null); assert.deepEqual(reopened.services, {});
  await assert.rejects(access(join(f.directory, 'main', 'writer.lock')), { code: 'ENOENT' });
  await assert.rejects(reopened.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
});

test('Engine PostgreSQL delete COMMIT failure rolls back authority and never removes custody, then reopens for retry', async t => {
  const f = await fixture(t), engine = f.engine(), failure = new Error('Synthetic delete COMMIT refused');
  await engine.request('workspace.create', { name: 'Synthetic rollback custody', passphrase });
  const closedVault = engine.vault!, vaultId = closedVault.vaultId, slot = f.connections[0], before = f.protocol.current().get(slot);
  f.protocol.failDeleteCommit(failure);
  await assert.rejects(engine.request('workspace.delete', { confirmation: 'Synthetic rollback custody' }), error => error === failure);
  assert.deepEqual(f.protocol.current().get(slot), before); assert.equal(f.keychain.custody.has(vaultId), true);
  assert.deepEqual(f.keychain.removals, []);
  const transaction = f.protocol.events.filter(event => event.transaction === f.protocol.events.at(-1)!.transaction);
  assert.deepEqual(transaction.map(event => event.kind), ['BEGIN', 'LOCK', 'DELETE', 'COMMIT', 'ROLLBACK', 'RELEASE']);
  assert.throws(() => closedVault.read(), { code: 'VAULT_CLOSED' });
  assert.equal(engine.vault, null); assert.deepEqual(engine.services, {});
  await assert.rejects(access(join(f.directory, 'main', 'writer.lock')), { code: 'ENOENT' });
  f.protocol.failDeleteCommit();
  const reopened = f.engine(); await reopened.request('workspace.open', { passphrase });
  assert.equal(reopened.vault!.vaultId, vaultId);
  await reopened.request('workspace.delete', { confirmation: 'Synthetic rollback custody' });
  assertCommittedDeletion(f.protocol, slot); assert.equal(f.keychain.custody.has(vaultId), false);
  assert.deepEqual(f.keychain.removals, [vaultId]);
});

test('Engine PostgreSQL custody removal failure surfaces after committed deletion and releases the closed authority', async t => {
  const failure = new Error('Synthetic custody removal refused');
  let f: Awaited<ReturnType<typeof fixture>>, slot: string;
  f = await fixture(t, () => { assertCommittedDeletion(f.protocol, slot); throw failure; });
  const engine = f.engine(); await engine.request('workspace.create', { name: 'Synthetic retained custody', passphrase });
  const closedVault = engine.vault!, vaultId = closedVault.vaultId; slot = f.connections[0];
  await assert.rejects(engine.request('workspace.delete', { confirmation: 'Synthetic retained custody' }), error => error === failure);
  assert.equal(f.protocol.current().has(slot), false); assert.equal(f.keychain.custody.has(vaultId), true);
  assert.deepEqual(f.keychain.removals, []); assert.throws(() => closedVault.read(), { code: 'VAULT_CLOSED' });
  assert.equal(engine.vault, null); assert.deepEqual(engine.services, {});
  await assert.rejects(access(join(f.directory, 'main', 'writer.lock')), { code: 'ENOENT' });
  await assert.rejects(engine.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
  assert.equal(f.keychain.custody.has(vaultId), true, 'A rejected hook leaves unresolved external custody explicit.');
});
