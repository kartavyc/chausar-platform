import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { PostgresSnapshotAdapter, type PostgresOptions, type PostgresPool, type PostgresQueryResult } from '../runtime/postgres.ts';
import type { KeychainHook, VaultEnvelope } from '../runtime/vault.ts';

const passphrase = 'Public synthetic Engine protocol passphrase';
const postgresUrl = 'postgresql://synthetic:public-synthetic-password@127.0.0.1:15432/synthetic';
type Row = { creation_id: string; revision: number; envelope: VaultEnvelope };
type Schema = { authority_table: boolean; storage_table: boolean; custody_table: boolean; creation_column: boolean };
type Store = { authority: Map<string, Row>; custody: Map<string, Record<string, unknown>>; schema: Schema; storageId: string | null };
type Event = { transaction: number; kind: 'SCHEMA' | 'DDL' | 'BEGIN' | 'LOCK' | 'GENERATION' | 'SELECT' | 'CUSTODY' |
  'INSERT' | 'UPDATE' | 'DELETE' | 'COMMIT' | 'ROLLBACK' | 'RELEASE'; slot?: string; storageId?: string; creationId?: string; vaultId?: string };
const compactSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const schemaSql = compactSql(`SELECT
  to_regclass('public.chausar_vault_authority') IS NOT NULL AS authority_table,
  to_regclass('public.chausar_workspace_postgres_storage') IS NOT NULL AS storage_table,
  to_regclass('public.chausar_workspace_postgres_custody') IS NOT NULL AS custody_table,
  EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.chausar_vault_authority')
    AND attname = 'creation_id' AND NOT attisdropped) AS creation_column`);
const authoritySql = 'SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE';
const custodySql = 'SELECT phase, creation_id, vault_id, operation_id, storage_id, revision, envelope_digest, envelope, target_identity FROM public.chausar_workspace_postgres_custody WHERE slot = $1 FOR UPDATE';
const generationSql = "SELECT storage_id FROM public.chausar_workspace_postgres_storage WHERE id = 'current' FOR SHARE";
const deletionEvents = ['BEGIN', 'LOCK', 'GENERATION', 'SELECT', 'SELECT', 'CUSTODY', 'SELECT', 'CUSTODY', 'DELETE', 'COMMIT', 'RELEASE'];

/** Synthetic SQL protocol only, following the qualified envelope/profile fixtures.
 * Catalog, generation and creation identities are committed with the row maps.
 * These ordinary workspaces have no target-publication custody; its actual table
 * and row reads are still modelled. Unknown SQL never succeeds by default.
 * This starts no PostgreSQL and substitutes no Vault/Engine/adapter deletion hook. */
function protocolPool() {
  let store: Store = { authority: new Map(), custody: new Map(),
    schema: { authority_table: false, storage_table: false, custody_table: false, creation_column: false }, storageId: null };
  let nextTransaction = 0, active = 0;
  const events: Event[] = [];
  let deleteCommitFailure: Error | undefined;
  const schemaResult = (current: Store): PostgresQueryResult => ({ rows: [{ ...current.schema }], rowCount: 1, command: 'SELECT' });
  const result = (row?: Row): PostgresQueryResult => ({ rows: row
    ? [{ creation_id: row.creation_id, revision: String(row.revision), envelope: structuredClone(row.envelope) }] : [],
    rowCount: row ? 1 : 0, command: 'SELECT' });
  const pool: PostgresPool = {
    async query(rawSql, values) {
      assert.equal(compactSql(rawSql), schemaSql, 'Only the exact read-only catalog probe occurs outside a transaction.');
      assert.equal(values, undefined); events.push({ transaction: 0, kind: 'SCHEMA' });
      return schemaResult(store);
    },
    async connect() {
      const transaction = ++nextTransaction;
      let draft: Store | undefined, deletedSlot: string | undefined, lock: 'schema' | 'slot' | undefined;
      let heldSlot: string | undefined, generationHeld = false;
      return {
        async query(rawSql: string, values: unknown[] = []): Promise<PostgresQueryResult> {
          const sql = compactSql(rawSql);
          if (sql === 'BEGIN') {
            assert.equal(draft, undefined); assert.equal(active, 0, 'Nested actual adapter operations must reuse the held client.');
            draft = structuredClone(store); active++;
            events.push({ transaction, kind: 'BEGIN' }); return { rows: [], command: 'BEGIN' };
          }
          assert.ok(draft, 'Protocol queries require the adapter-owned transaction.');
          if (sql === 'COMMIT') {
            events.push({ transaction, kind: 'COMMIT', ...(deletedSlot ? { slot: deletedSlot } : {}) });
            if (deletedSlot && deleteCommitFailure) throw deleteCommitFailure;
            store = draft; draft = undefined; active--; lock = undefined; generationHeld = false;
            return { rows: [], rowCount: null, command: 'COMMIT' };
          }
          if (sql === 'ROLLBACK') {
            events.push({ transaction, kind: 'ROLLBACK' });
            draft = undefined; active--; lock = undefined; generationHeld = false;
            return { rows: [], rowCount: null, command: 'ROLLBACK' };
          }
          if (sql === 'SELECT pg_advisory_xact_lock(hashtext($1))') {
            assert.equal(values.length, 1); assert.equal(lock, undefined);
            const identity = String(values[0]);
            if (identity === 'chausar-postgres-schema-v1') lock = 'schema';
            else {
              assert.match(identity, /^chausar-vault:[a-f0-9]{64}$/);
              lock = 'slot'; heldSlot = identity.slice('chausar-vault:'.length);
            }
            events.push({ transaction, kind: 'LOCK', ...(heldSlot ? { slot: heldSlot } : {}) });
            return { rows: [], command: 'SELECT' };
          }
          if (lock === 'schema') {
            if (sql === schemaSql) { events.push({ transaction, kind: 'SCHEMA' }); return schemaResult(draft); }
            if (sql === compactSql(`CREATE TABLE IF NOT EXISTS public.chausar_vault_authority (
              slot TEXT PRIMARY KEY, revision BIGINT NOT NULL CHECK (revision >= 0),
              envelope JSONB NOT NULL, creation_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`)) {
              assert.equal(draft.schema.authority_table, false);
              draft.schema.authority_table = true; draft.schema.creation_column = true;
            } else if (sql === 'ALTER TABLE public.chausar_vault_authority ADD COLUMN IF NOT EXISTS creation_id TEXT NOT NULL DEFAULT gen_random_uuid()::text') {
              assert.equal(draft.schema.authority_table, true); assert.equal(draft.schema.creation_column, false);
              for (const row of draft.authority.values()) row.creation_id = randomUUID();
              draft.schema.creation_column = true;
            } else if (sql === compactSql(`CREATE TABLE IF NOT EXISTS public.chausar_workspace_postgres_storage (
              id TEXT PRIMARY KEY CHECK (id = 'current'), storage_id TEXT NOT NULL
            )`)) {
              assert.equal(draft.schema.storage_table, false); draft.schema.storage_table = true;
            } else if (sql === "INSERT INTO public.chausar_workspace_postgres_storage (id, storage_id) VALUES ('current', gen_random_uuid()::text) ON CONFLICT DO NOTHING") {
              assert.equal(draft.schema.storage_table, true); const inserted = draft.storageId === null;
              draft.storageId ??= randomUUID(); events.push({ transaction, kind: 'DDL' });
              return { rows: [], rowCount: inserted ? 1 : 0, command: 'INSERT' };
            } else if (sql === compactSql(`CREATE TABLE IF NOT EXISTS public.chausar_workspace_postgres_custody (
              slot TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, creation_id TEXT NOT NULL UNIQUE,
              storage_id TEXT NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('reserved', 'prepared', 'committed', 'rolled-back')),
              target_identity JSONB NOT NULL, vault_id TEXT, revision BIGINT, envelope_digest TEXT, envelope JSONB,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`)) {
              assert.equal(draft.schema.custody_table, false); draft.schema.custody_table = true;
            } else throw new Error(`Unexpected synthetic schema statement: ${sql}`);
            events.push({ transaction, kind: 'DDL' }); return { rows: [], command: sql.startsWith('ALTER ') ? 'ALTER' : 'CREATE' };
          }
          assert.equal(lock, 'slot', 'Authority/custody SQL must follow exact slot advisory admission.');
          assert.deepEqual(draft.schema, { authority_table: true, storage_table: true, custody_table: true, creation_column: true });
          if (sql === generationSql) {
            assert.ok(draft.storageId); assert.equal(generationHeld, false); generationHeld = true;
            events.push({ transaction, kind: 'GENERATION', storageId: draft.storageId });
            return { rows: [{ storage_id: draft.storageId }], rowCount: 1, command: 'SELECT' };
          }
          assert.equal(generationHeld, true, 'The generation SHARE lock precedes every authority/custody operation.');
          const slot = String(values[0]); assert.equal(slot, heldSlot);
          if (sql === authoritySql) {
            const row = draft.authority.get(slot);
            events.push({ transaction, kind: 'SELECT', slot,
              ...(row ? { creationId: row.creation_id, vaultId: row.envelope.id } : {}) });
            return result(row);
          }
          if (sql === custodySql) {
            assert.equal(draft.schema.custody_table, true);
            const row = draft.custody.get(slot);
            events.push({ transaction, kind: 'CUSTODY', slot });
            return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0, command: 'SELECT' };
          }
          if (sql === 'INSERT INTO public.chausar_vault_authority (slot, revision, envelope) VALUES ($1, $2, $3::jsonb)') {
            assert.equal(values.length, 3); assert.equal(draft.authority.has(slot), false);
            const envelope = JSON.parse(String(values[2])) as VaultEnvelope; assert.equal(envelope.revision, values[1]);
            draft.authority.set(slot, { creation_id: randomUUID(), revision: Number(values[1]), envelope });
            events.push({ transaction, kind: 'INSERT', slot }); return { rows: [], rowCount: 1, command: 'INSERT' };
          }
          if (sql === compactSql(`UPDATE public.chausar_vault_authority SET revision = $2, envelope = $3::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE slot = $1 AND revision = $4 AND creation_id = $5 AND envelope->>'id' = $6 AND envelope = $7::jsonb`)) {
            assert.equal(values.length, 7); const row = draft.authority.get(slot);
            events.push({ transaction, kind: 'UPDATE', slot });
            if (!row || row.revision !== values[3] || row.creation_id !== values[4] || row.envelope.id !== values[5]
              || !isDeepStrictEqual(row.envelope, JSON.parse(String(values[6])))) return { rows: [], rowCount: 0, command: 'UPDATE' };
            const envelope = JSON.parse(String(values[2])) as VaultEnvelope; assert.equal(envelope.revision, values[1]);
            row.revision = Number(values[1]); row.envelope = envelope;
            return { rows: [], rowCount: 1, command: 'UPDATE' };
          }
          if (sql === 'DELETE FROM public.chausar_vault_authority WHERE slot = $1') {
            assert.equal(values.length, 1); deletedSlot = slot; const removed = draft.authority.delete(slot);
            events.push({ transaction, kind: 'DELETE', slot }); return { rows: [], rowCount: removed ? 1 : 0, command: 'DELETE' };
          }
          throw new Error(`Unexpected synthetic protocol statement: ${sql}`);
        },
        release() {
          assert.equal(draft, undefined); assert.equal(lock, undefined); assert.equal(generationHeld, false);
          events.push({ transaction, kind: 'RELEASE' });
        },
      };
    },
    async end() { throw new Error('The managed synthetic pool must not be closed by fromPool.'); },
  };
  return { pool, events, current: () => structuredClone(store.authority), currentCustody: () => structuredClone(store.custody),
    storageGeneration: () => store.storageId, active: () => active,
    failDeleteCommit(error?: Error) { deleteCommitFailure = error; } };
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
  const root = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(root, /^C:[\\/]/i);
  const directory = await mkdtemp(join(root, 'chausar-engine-keychain-postgres-'));
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
    finally {
      keychain.clear();
      const child = relative(root, await realpath(directory));
      assert.ok(child.startsWith('chausar-engine-keychain-postgres-') && !child.startsWith('..') && !isAbsolute(child));
      await rm(directory, { recursive: true, force: true });
    }
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
  assert.deepEqual(transaction.map(event => event.kind), deletionEvents);
  assert.equal(transaction.find(event => event.kind === 'LOCK')?.slot, slot);
  assert.equal(transaction.find(event => event.kind === 'GENERATION')?.storageId, protocol.storageGeneration());
  const observed = transaction.filter(event => event.kind === 'SELECT');
  assert.equal(observed.length, 3); assert.ok(observed[0].creationId);
  assert.ok(observed.every(event => event.slot === slot && event.creationId === observed[0].creationId && event.vaultId === observed[0].vaultId));
  assert.equal(protocol.currentCustody().size, 0, 'Ordinary deletion retains admitted absence of publication custody.');
  assert.equal(protocol.active(), 0, 'Custody removal follows the released outer deletion-admission transaction.');
  assert.equal(transaction.find(event => event.kind === 'DELETE')?.slot, slot);
  assert.equal(transaction.find(event => event.kind === 'COMMIT')?.slot, slot);
}

test('Engine PostgreSQL reopen removes registered custody only after the actual adapter DELETE commits', async t => {
  let f: Awaited<ReturnType<typeof fixture>>, expectedId: string, slot: string;
  f = await fixture(t, vaultId => { assert.equal(vaultId, expectedId); assertCommittedDeletion(f.protocol, slot); });
  const initial = f.engine();
  await initial.request('workspace.create', { name: 'Synthetic PostgreSQL custody', passphrase });
  assert.equal(initial.vault!.storageKind, 'postgres'); expectedId = initial.vault!.vaultId; slot = f.connections[0];
  const opened = f.protocol.current().get(slot)!; assert.equal(opened.envelope.id, expectedId);
  assert.ok(opened.creation_id); const storageId = f.protocol.storageGeneration(); assert.ok(storageId);
  assert.deepEqual([...f.keychain.custody.keys()], [expectedId]);
  await initial.request('workspace.lock'); assert.equal(f.keychain.custody.has(expectedId), true);
  const reopened = f.engine(); await reopened.request('workspace.open', { passphrase });
  assert.equal(reopened.vault!.vaultId, expectedId); assert.deepEqual(f.connections, [slot, slot]);
  assert.equal(f.protocol.current().get(slot)?.creation_id, opened.creation_id);
  assert.equal(f.protocol.storageGeneration(), storageId); assert.equal(f.protocol.currentCustody().size, 0);
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
  const beforeStorage = f.protocol.storageGeneration(), beforeCustody = f.protocol.currentCustody();
  f.protocol.failDeleteCommit(failure);
  await assert.rejects(engine.request('workspace.delete', { confirmation: 'Synthetic rollback custody' }), error => error === failure);
  assert.deepEqual(f.protocol.current().get(slot), before); assert.equal(f.keychain.custody.has(vaultId), true);
  assert.equal(f.protocol.storageGeneration(), beforeStorage); assert.deepEqual(f.protocol.currentCustody(), beforeCustody);
  assert.deepEqual(f.keychain.removals, []);
  const transaction = f.protocol.events.filter(event => event.transaction === f.protocol.events.at(-1)!.transaction);
  assert.deepEqual(transaction.map(event => event.kind), [...deletionEvents.slice(0, -1), 'ROLLBACK', 'RELEASE']);
  assert.equal(transaction.find(event => event.kind === 'GENERATION')?.storageId, beforeStorage);
  assert.ok(transaction.filter(event => event.kind === 'SELECT').every(event => event.creationId === before?.creation_id));
  assert.equal(f.protocol.active(), 0);
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
